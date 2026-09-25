import { PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  getPoolStats, buildWithdrawSol, buildMoveFeeTokensToAta, snapshotHolders, swap, getPrices, SOL_MINT, ata, tokenProgramId, tokenBalance, buildDirectPayout,
  computeLeafHash, buildMerkleTree, toHex, toNumArray, createMerkleDistribution, closeMerkleDistribution, fetchDistribution, fetchClaims, kitSignerFromKeypair,
  tokenAccountRent, isOffCurve, launchPolicy, rentPolicy,
  type LstEntry,
} from "@stipend/core";
import { makeCtx, pickLsts, sendTx, sol, units, now, type Ctx } from "../lib/ctx.js";
import { fill, quoteFill } from "@stipend/core";
import { ensureLaunchTables } from "../lib/launchdb.js";
import { updatePool } from "./admin.js";

const FEE_RESERVE_LAMPORTS = 50_000_000n; // keep 0.05 SOL in the worker for tx fees

type EpochRow = { lst: string; epoch: number; status: string; snapshot_id: number | null; swap_id: number | null; distribution_id: number | null; redeemed_lamports: string | null; platform_fee_lamports: string | null; budget_lamports: string | null; carried_lamports: string | null; fee_tokens: string | null };

function getEpochRow(ctx: Ctx, lst: string, epoch: number): EpochRow | undefined {
  return ctx.db.prepare("SELECT * FROM epochs WHERE lst = ? AND epoch = ?").get(lst, epoch) as EpochRow | undefined;
}
function setEpoch(ctx: Ctx, lst: string, epoch: number, patch: Record<string, unknown>) {
  if (ctx.dryRun) return;
  const keys = Object.keys(patch);
  ctx.db.prepare(`UPDATE epochs SET ${keys.map((k) => `${k} = @${k}`).join(", ")} WHERE lst = @lst AND epoch = @epoch`).run({ ...patch, lst, epoch });
}
function ledgerGet(ctx: Ctx, lst: string, owner: string) {
  const r = ctx.db.prepare("SELECT owed, claimed, paid FROM ledger WHERE lst = ? AND owner = ?").get(lst, owner) as { owed: string; claimed: string; paid: string } | undefined;
  return { owed: BigInt(r?.owed ?? 0), claimed: BigInt(r?.claimed ?? 0), paid: BigInt(r?.paid ?? 0) };
}
function ledgerSet(ctx: Ctx, lst: string, owner: string, v: { owed: bigint; claimed: bigint; paid: bigint }, epoch: number) {
  if (ctx.dryRun) return;
  ctx.db.prepare(`INSERT INTO ledger (lst, owner, owed, claimed, paid, updated_epoch) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(lst, owner) DO UPDATE SET owed = excluded.owed, claimed = excluded.claimed, paid = excluded.paid, updated_epoch = excluded.updated_epoch`)
    .run(lst, owner, v.owed.toString(), v.claimed.toString(), v.paid.toString(), epoch);
}

/** Step 2: redeem the epoch fee (pool tokens in the manager fee account) for SOL from the reserve into the worker wallet. */
export async function redeemFees(ctx: Ctx, lst: LstEntry, epoch: number): Promise<{ poolTokens: bigint; lamports: bigint }> {
  const s = await getPoolStats(ctx.conn, lst);
  const manager = ctx.keys.manager();
  const worker = ctx.keys.worker();
  if (s.manager !== manager.publicKey.toBase58()) throw new Error(`${lst.symbol}: keys/manager.json ${manager.publicKey.toBase58()} is not the pool manager ${s.manager}`);
  if (s.managerFeeTokens === 0n) { ctx.log(`${lst.symbol}: no fee tokens to redeem`); return { poolTokens: 0n, lamports: 0n }; }
  // lamports per pool token (1:1 for a 100% fee pool, but stay general) and what the reserve can actually pay
  const lamportsFor = (t: bigint) => (s.poolTokenSupply === 0n ? t : (t * s.totalLamports) / s.poolTokenSupply);
  const reserveAvail = s.reserveLamports > s.reserveRentExempt ? s.reserveLamports - s.reserveRentExempt : 0n;
  let tokens = s.managerFeeTokens;
  if (lamportsFor(tokens) > reserveAvail) {
    tokens = s.poolTokenSupply === 0n ? reserveAvail : (reserveAvail * s.poolTokenSupply) / s.totalLamports;
    ctx.log(`${lst.symbol}: reserve can only cover ${sol(reserveAvail)} of ${sol(lamportsFor(s.managerFeeTokens))}; redeeming ${sol(tokens)} pool tokens, rest carried in the fee account`);
  }
  if (tokens <= 0n) return { poolTokens: 0n, lamports: 0n };
  const mint = new PublicKey(s.mint);
  const move = buildMoveFeeTokensToAta(mint, new PublicKey(s.managerFeeAccount), manager.publicKey, s.managerFeeTokens);
  const before = BigInt(await ctx.conn.getBalance(worker.publicKey));
  const w = await buildWithdrawSol(ctx.conn, lst, manager.publicKey, tokens, worker.publicKey, move.ata);
  const sig = await sendTx(ctx, [...move.instructions, ...w.instructions], [manager, ...w.signers], `${lst.symbol} redeem ${sol(tokens)} fee tokens`);
  const after = ctx.dryRun ? before + lamportsFor(tokens) : BigInt(await ctx.conn.getBalance(worker.publicKey));
  const lamports = after > before ? after - before : 0n;
  if (!ctx.dryRun) ctx.db.prepare("INSERT INTO fee_redemptions (lst, epoch, pool_tokens, lamports, signature, ts) VALUES (?, ?, ?, ?, ?, ?)").run(lst.symbol, epoch, tokens.toString(), lamports.toString(), sig, now());
  return { poolTokens: tokens, lamports };
}

/** Step 7 (merkle): settle every open distribution of this LST: record on-chain claims, close, bump ledger.claimed. Returns false if one is not closable yet. */
export async function settleDistributions(ctx: Ctx, lst: LstEntry): Promise<boolean> {
  const open = ctx.db.prepare("SELECT id, address, epoch, clawback_ts FROM distributions WHERE lst = ? AND status = 'open' ORDER BY epoch").all(lst.symbol) as { id: number; address: string; epoch: number; clawback_ts: number }[];
  const mint = new PublicKey(lst.asset.mint);
  const prog = tokenProgramId(lst.asset.tokenProgram);
  for (const d of open) {
    const dist = new PublicKey(d.address);
    const state = await fetchDistribution(ctx.conn, dist);
    const leaves = ctx.db.prepare("SELECT owner, claimed_before FROM leaves WHERE distribution_id = ?").all(d.id) as { owner: string; claimed_before: string }[];
    if (state.kind === "open") {
      if (now() < d.clawback_ts) { ctx.log(`${lst.symbol}: distribution ${d.address} (epoch ${d.epoch}) not closable until ${new Date(d.clawback_ts * 1000).toISOString()}`); return false; }
      const claims = await fetchClaims(ctx.conn, dist, leaves.map((l) => l.owner));
      for (const l of leaves) {
        const c = claims.get(l.owner) ?? 0n;
        if (c === 0n) continue;
        const led = ledgerGet(ctx, lst.symbol, l.owner);
        const claimedNow = BigInt(l.claimed_before) + c;
        if (claimedNow > led.claimed) ledgerSet(ctx, lst.symbol, l.owner, { ...led, claimed: claimedNow }, d.epoch);
        if (!ctx.dryRun) ctx.db.prepare("INSERT OR REPLACE INTO claims_seen (distribution_id, owner, claimed_amount, seen_at) VALUES (?, ?, ?, ?)").run(d.id, l.owner, c.toString(), now());
      }
      ctx.log(`${lst.symbol}: distribution ${d.address}: ${claims.size} claimants, ${sumBig([...claims.values()])} claimed; closing`);
      if (ctx.dryRun) { ctx.log(`[dry-run] would close ${d.address}`); continue; }
      const sig = await closeMerkleDistribution(ctx.kit, await kitSignerFromKeypair(ctx.keys.worker()), { distribution: dist, mint, tokenProgram: prog });
      ctx.db.prepare("UPDATE distributions SET status = 'closed', closed_sig = ? WHERE id = ?").run(sig, d.id);
      ctx.log(`${lst.symbol}: closed ${d.address}: ${sig}`);
    } else {
      // closed on-chain but not in DB (crash between close and commit): claims are gone, trust claims_seen only
      ctx.log(`${lst.symbol}: distribution ${d.address} already ${state.kind} on-chain; marking closed`);
      if (!ctx.dryRun) ctx.db.prepare("UPDATE distributions SET status = 'closed' WHERE id = ?").run(d.id);
    }
  }
  return true;
}

const sumBig = (xs: bigint[]) => xs.reduce((a, b) => a + b, 0n);

/** Merkle delivery: new cumulative distribution with leaf = owed - claimed for everyone with a positive delta. */
async function publishDistribution(ctx: Ctx, lst: LstEntry, epoch: number): Promise<number | null> {
  const rows = ctx.db.prepare("SELECT owner, owed, claimed FROM ledger WHERE lst = ? AND CAST(owed AS INTEGER) > CAST(claimed AS INTEGER)").all(lst.symbol) as { owner: string; owed: string; claimed: string }[];
  const entries = rows.map((r) => ({ owner: r.owner, amount: BigInt(r.owed) - BigInt(r.claimed), claimedBefore: BigInt(r.claimed) })).filter((e) => e.amount > 0n);
  if (entries.length === 0) { ctx.log(`${lst.symbol}: nothing owed, no distribution`); return null; }
  const total = sumBig(entries.map((e) => e.amount));
  const leaves = entries.map((e) => computeLeafHash(e.owner, e.amount));
  const tree = buildMerkleTree(leaves);
  const mint = new PublicKey(lst.asset.mint);
  const prog = tokenProgramId(lst.asset.tokenProgram);
  const worker = ctx.keys.worker();
  const have = await tokenBalance(ctx.conn, ata(mint, worker.publicKey, prog), prog);
  ctx.log(`${lst.symbol}: distribution for ${entries.length} holders, total ${units(total, lst.asset.decimals)} ${lst.asset.symbol}, root ${toHex(tree.root)}, worker holds ${units(have, lst.asset.decimals)}`);
  if (have < total) throw new Error(`${lst.symbol}: worker ${lst.asset.symbol} balance ${have} < distribution total ${total}; top up the worker ATA or investigate`);
  const clawbackTs = now() + Math.round(ctx.reg.distribution.clawbackHours * 3600);
  if (ctx.dryRun) { ctx.log(`[dry-run] would create distribution (clawback ${new Date(clawbackTs * 1000).toISOString()})`); return null; }
  const created = await createMerkleDistribution(ctx.kit, await kitSignerFromKeypair(worker), { mint, tokenProgram: prog, root: tree.root, totalAmount: total, clawbackTs });
  const insert = ctx.db.transaction(() => {
    const r = ctx.db.prepare(`INSERT INTO distributions (lst, epoch, address, authority, seeds, mint, root, total_amount, leaves, clawback_ts, created_sig, status, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`)
      .run(lst.symbol, epoch, created.distribution.toBase58(), worker.publicKey.toBase58(), created.seeds.toBase58(), lst.asset.mint, toHex(tree.root), total.toString(), entries.length, clawbackTs, created.signature, now());
    const id = Number(r.lastInsertRowid);
    const ins = ctx.db.prepare("INSERT INTO leaves (distribution_id, owner, amount, proof, claimed_before) VALUES (?, ?, ?, ?, ?)");
    entries.forEach((e, i) => ins.run(id, e.owner, e.amount.toString(), JSON.stringify(tree.proofs[i].map(toNumArray)), e.claimedBefore.toString()));
    return id;
  });
  const id = insert();
  ctx.log(`${lst.symbol}: distribution ${created.distribution.toBase58()} created: ${created.signature}`);
  return id;
}

/**
 * Direct delivery: transfer owed - paid to each holder once it clears minPayoutUsd.
 * Rent rules (registry.rent): the platform funds a holder's FIRST asset token account once per (lst, wallet), within a per-epoch
 * budget (rentBudgetBpsOfFee of this epoch's platform fee, largest balances first). A wallet whose funded account has since been
 * closed gets a closure strike and is only recreated from its own accrual: the rent is deducted as asset units at this epoch's fill
 * price. Program-owned / off-curve holders are never funded (they accrue). Rent is read live from RPC every epoch.
 */
async function directPayouts(ctx: Ctx, lst: LstEntry, epoch: number) {
  ensureLaunchTables(ctx.db);
  const rows = ctx.db.prepare("SELECT owner, owed, paid FROM ledger WHERE lst = ? AND CAST(owed AS INTEGER) > CAST(paid AS INTEGER)").all(lst.symbol) as { owner: string; owed: string; paid: string }[];
  const priceMint = lst.asset.priceMint ?? lst.asset.mint; // test assets are priced off the mainnet mint they mirror
  const prices = await getPrices([priceMint, SOL_MINT]);
  const price = prices[priceMint] ?? 0;
  const solPrice = prices[SOL_MINT] ?? 0;
  const minUnits = price > 0 ? BigInt(Math.ceil((ctx.reg.distribution.minPayoutUsd / price) * 10 ** lst.asset.decimals)) : 0n;
  const mint = new PublicKey(lst.asset.mint);
  const prog = tokenProgramId(lst.asset.tokenProgram);
  const worker = ctx.keys.worker();
  const from = ata(mint, worker.publicKey, prog);
  const rent = await tokenAccountRent(ctx.conn, prog);
  // rent expressed in asset units at this epoch's prices (what a holder pays from accrual for a recreation)
  const rentUnits = price > 0 && solPrice > 0 ? BigInt(Math.ceil(((Number(rent) / LAMPORTS_PER_SOL) * solPrice / price) * 10 ** lst.asset.decimals)) : 0n;
  const policy = rentPolicy(ctx.reg);
  const epochRow = getEpochRow(ctx, lst.symbol, epoch);
  const platformFee = BigInt(epochRow?.platform_fee_lamports ?? 0);
  let rentBudget = policy.platformFundsFirstAccount ? (platformFee * BigInt(policy.rentBudgetBpsOfFee)) / 10_000n : 0n;
  const snapshotId = epochRow?.snapshot_id ?? null;
  const balanceOf = new Map<string, bigint>();
  if (snapshotId) for (const r of ctx.db.prepare("SELECT owner, balance FROM snapshot_balances WHERE snapshot_id = ?").all(snapshotId) as { owner: string; balance: string }[]) balanceOf.set(r.owner, BigInt(r.balance));
  const fundedRow = ctx.db.prepare("SELECT account, closures, first_funded_epoch FROM funded_accounts WHERE lst = ? AND owner = ?");
  const due = rows.map((r) => ({ owner: r.owner, amount: BigInt(r.owed) - BigInt(r.paid) })).filter((r) => r.amount >= minUnits && r.amount > 0n)
    .sort((a, b) => (balanceOf.get(b.owner) ?? 0n) > (balanceOf.get(a.owner) ?? 0n) ? 1 : -1); // largest LST balance first: the rent budget goes to them first
  ctx.log(`${lst.symbol}: ${due.length}/${rows.length} holders above the ${ctx.reg.distribution.minPayoutUsd} USD payout floor (${units(minUnits, lst.asset.decimals)} ${lst.asset.symbol} @ $${price}); rent ${sol(rent)} SOL = ${units(rentUnits, lst.asset.decimals)} ${lst.asset.symbol}; rent budget ${sol(rentBudget)} SOL`);
  const batch = 5;
  let spentRent = 0n, funded = 0, recreated = 0, deferred = 0, skippedPda = 0, skippedFrozen = 0;
  for (let i = 0; i < due.length; i += batch) {
    const chunk = due.slice(i, i + batch);
    const ixs = [];
    const paid: { owner: string; amount: bigint; rentDeducted: bigint; fundedBy: "platform" | "holder" | null; dest: string }[] = [];
    for (const d of chunk) {
      const owner = new PublicKey(d.owner);
      if (isOffCurve(owner)) { skippedPda++; continue; } // program-owned holder (AMM pool, vault): accrue, never pay
      const dest = ata(mint, owner, prog);
      const destInfo = await ctx.conn.getAccountInfo(dest);
      const exists = !!destInfo;
      if (destInfo && destInfo.data.length >= 109 && destInfo.data[108] === 2) { skippedFrozen++; continue; } // issuer froze this account: accrue, never fail the batch
      let createAta = false, fundedBy: "platform" | "holder" | null = null, rentDeducted = 0n, amount = d.amount;
      if (!exists) {
        const prev = fundedRow.get(lst.symbol, d.owner) as { account: string; closures: number; first_funded_epoch: number } | undefined;
        if (!prev && policy.platformFundsFirstAccount && rentBudget >= rent) {
          createAta = true; fundedBy = "platform"; rentBudget -= rent; spentRent += rent; funded++;
        } else if (!prev && policy.platformFundsFirstAccount) {
          deferred++; continue; // budget exhausted this epoch; accrues, funded next epoch
        } else {
          // closed a funded account before (or platform funding is off): the holder pays, from accrual, once it covers the rent
          if (amount <= rentUnits || rentUnits === 0n) { deferred++; continue; }
          createAta = true; fundedBy = "holder"; rentDeducted = rentUnits; amount -= rentUnits; recreated++;
          if (prev && !ctx.dryRun) ctx.db.prepare("UPDATE funded_accounts SET closures = closures + 1 WHERE lst = ? AND owner = ?").run(lst.symbol, d.owner);
        }
      }
      ixs.push(...buildDirectPayout({ mint, decimals: lst.asset.decimals, program: prog, from, owner: worker.publicKey, to: owner, amount, payer: worker.publicKey, createAta }));
      paid.push({ owner: d.owner, amount, rentDeducted, fundedBy, dest: dest.toBase58() });
    }
    if (ixs.length === 0) continue;
    const sig = await sendTx(ctx, ixs, [worker], `${lst.symbol} payout x${paid.length}`);
    if (ctx.dryRun) continue;
    const tx = ctx.db.transaction(() => {
      for (const d of paid) {
        const led = ledgerGet(ctx, lst.symbol, d.owner);
        // rent deducted from accrual counts as paid (the holder consumed it), so owed - paid stays exact
        ledgerSet(ctx, lst.symbol, d.owner, { ...led, paid: led.paid + d.amount + d.rentDeducted }, epoch);
        ctx.db.prepare("INSERT INTO payouts (lst, epoch, owner, amount, signature, ts) VALUES (?, ?, ?, ?, ?, ?)").run(lst.symbol, epoch, d.owner, d.amount.toString(), sig, now());
        if (d.fundedBy) {
          ctx.db.prepare(`INSERT INTO funded_accounts (lst, owner, account, first_funded_epoch, funded_by, lamports, last_seen_epoch, asset_units_deducted) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(lst, owner) DO UPDATE SET account = excluded.account, last_seen_epoch = excluded.last_seen_epoch, asset_units_deducted = CAST(CAST(funded_accounts.asset_units_deducted AS INTEGER) + CAST(excluded.asset_units_deducted AS INTEGER) AS TEXT)`)
            .run(lst.symbol, d.owner, d.dest, epoch, d.fundedBy, rent.toString(), epoch, d.rentDeducted.toString());
          ctx.db.prepare("INSERT INTO rent_ledger (lst, epoch, owner, lamports, funded_by, asset_units, ts) VALUES (?, ?, ?, ?, ?, ?, ?)").run(lst.symbol, epoch, d.owner, rent.toString(), d.fundedBy, d.rentDeducted.toString(), now());
        } else {
          ctx.db.prepare("UPDATE funded_accounts SET last_seen_epoch = ? WHERE lst = ? AND owner = ?").run(epoch, lst.symbol, d.owner);
        }
      }
    });
    tx();
  }
  ctx.log(`${lst.symbol}: payouts done; accounts funded by platform ${funded} (${sol(spentRent)} SOL), recreated from accrual ${recreated}, deferred ${deferred}, program-owned skipped ${skippedPda}, frozen skipped ${skippedFrozen}`);
  // whatever rent budget was not spent goes to the treasury now
  const leftover = rentBudget;
  if (leftover > 0n && ctx.reg.treasury && ctx.reg.treasury !== worker.publicKey.toBase58() && policy.platformFundsFirstAccount) {
    await sendTx(ctx, [SystemProgram.transfer({ fromPubkey: worker.publicKey, toPubkey: new PublicKey(ctx.reg.treasury), lamports: leftover })], [worker], `${lst.symbol} unspent rent budget ${sol(leftover)} SOL -> treasury`);
  }
}

export async function runEpochFor(ctx: Ctx, lst: LstEntry, force = false, demo = false) {
  const chainEpoch = (await ctx.conn.getEpochInfo()).epoch;
  // demo epochs (non-mainnet): one synthetic epoch per registry.demo.intervalMinutes, numbered from unix time so they never collide with real epochs
  const demoCfg = ctx.reg.demo;
  const epoch = demo && demoCfg?.enabled ? Math.floor(now() / (demoCfg.intervalMinutes * 60)) : chainEpoch;
  const row = getEpochRow(ctx, lst.symbol, epoch);
  if (row?.status === "done" && !force) { ctx.log(`${lst.symbol}: epoch ${epoch} already done`); return; }
  ctx.log(`=== ${lst.symbol} epoch ${epoch} (${lst.delivery}) ${ctx.dryRun ? "[dry-run]" : ""}`);
  if (!row && !ctx.dryRun) ctx.db.prepare("INSERT INTO epochs (lst, epoch, status, started_at, notes) VALUES (?, ?, 'running', ?, ?)").run(lst.symbol, epoch, now(), demo ? "demo" : null);
  const worker = ctx.keys.worker();
  const mint = new PublicKey(lst.asset.mint);
  const prog = tokenProgramId(lst.asset.tokenProgram);

  // 1. pool update
  if (await updatePool(ctx, lst)) ctx.log(`${lst.symbol}: pool updated for epoch ${epoch}`);

  // 2-3. fee redemption + platform fee (once per epoch)
  let budget: bigint;
  if (row?.budget_lamports) {
    budget = BigInt(row.budget_lamports);
    ctx.log(`${lst.symbol}: resuming with budget ${sol(budget)} SOL`);
  } else {
    const prev = ctx.db.prepare("SELECT carried_lamports FROM epochs WHERE lst = ? AND epoch < ? ORDER BY epoch DESC LIMIT 1").get(lst.symbol, epoch) as { carried_lamports: string | null } | undefined;
    const carried = BigInt(prev?.carried_lamports ?? 0);
    const red = await redeemFees(ctx, lst, epoch);
    if (demo && demoCfg?.enabled) {
      // synthetic reward: TVL x apy / epochsPerYear, paid from the worker's own (airdropped) SOL so testers see a payout every interval
      const s = await getPoolStats(ctx.conn, lst);
      const topUp = (s.totalLamports * BigInt(Math.round(demoCfg.apyPct * 100))) / 10_000n / 146n;
      const bal = BigInt(await ctx.conn.getBalance(worker.publicKey));
      const usable = bal > FEE_RESERVE_LAMPORTS + topUp ? topUp : 0n;
      if (usable === 0n) ctx.log(`${lst.symbol}: demo top-up ${sol(topUp)} SOL skipped, worker balance ${sol(bal)}`);
      else ctx.log(`${lst.symbol}: demo epoch ${epoch}: synthetic reward ${sol(usable)} SOL on ${sol(s.totalLamports)} TVL at ${demoCfg.apyPct}%`);
      red.lamports += usable;
    }
    const platformFee = (red.lamports * BigInt(ctx.reg.fees.platformFeeBps)) / 10_000n;
    const creatorBps = lst.creator ? BigInt(lst.creatorFeeBps ?? launchPolicy(ctx.reg).creatorFeeBps) : 0n;
    const treasuryFee = platformFee - (platformFee * creatorBps) / 10_000n;
    // rent the platform will fund this epoch is taken out of the treasury's share first (rent budget = rentBudgetBpsOfFee of the fee), see directPayouts
    const rentBudget = (platformFee * BigInt(rentPolicy(ctx.reg).rentBudgetBpsOfFee)) / 10_000n;
    const treasuryNow = treasuryFee > rentBudget ? treasuryFee - rentBudget : 0n;
    if (treasuryNow > 0n && ctx.reg.treasury && ctx.reg.treasury !== worker.publicKey.toBase58()) {
      await sendTx(ctx, [SystemProgram.transfer({ fromPubkey: worker.publicKey, toPubkey: new PublicKey(ctx.reg.treasury), lamports: treasuryNow })], [worker], `${lst.symbol} platform fee ${sol(treasuryNow)} SOL (rent budget ${sol(rentBudget)} held back)`);
    }
    setEpoch(ctx, lst.symbol, epoch, { notes: `rentBudget=${rentBudget.toString()}` });
    // creator share: a slice of the platform fee, paid in SOL to the launcher of a self-service pool
    if (lst.creator && platformFee > 0n) {
      const bps = BigInt(lst.creatorFeeBps ?? launchPolicy(ctx.reg).creatorFeeBps);
      const creatorCut = (platformFee * bps) / 10_000n;
      if (creatorCut > 0n) {
        const sig = await sendTx(ctx, [SystemProgram.transfer({ fromPubkey: worker.publicKey, toPubkey: new PublicKey(lst.creator), lamports: creatorCut })], [worker], `${lst.symbol} creator share ${sol(creatorCut)} SOL -> ${lst.creator}`);
        if (!ctx.dryRun) { ensureLaunchTables(ctx.db); ctx.db.prepare("INSERT INTO creator_payouts (lst, epoch, creator, lamports, signature, ts) VALUES (?, ?, ?, ?, ?, ?)").run(lst.symbol, epoch, lst.creator, creatorCut.toString(), sig, now()); }
      }
    }
    budget = red.lamports - platformFee + carried;
    const bal = BigInt(await ctx.conn.getBalance(worker.publicKey));
    if (!ctx.dryRun && budget > bal - FEE_RESERVE_LAMPORTS) { ctx.log(`${lst.symbol}: budget ${sol(budget)} exceeds worker balance ${sol(bal)} minus fee reserve; clamping`); budget = bal > FEE_RESERVE_LAMPORTS ? bal - FEE_RESERVE_LAMPORTS : 0n; }
    ctx.log(`${lst.symbol}: redeemed ${sol(red.lamports)} SOL, platform fee ${sol(platformFee)}, carried ${sol(carried)}, budget ${sol(budget)}`);
    setEpoch(ctx, lst.symbol, epoch, { fee_tokens: red.poolTokens.toString(), redeemed_lamports: red.lamports.toString(), platform_fee_lamports: platformFee.toString(), budget_lamports: budget.toString() });
  }

  // 4. snapshot (once per epoch)
  let snapshotId = row?.snapshot_id ?? null;
  let balances: Map<string, bigint>;
  let total: bigint;
  if (snapshotId) {
    const rows = ctx.db.prepare("SELECT owner, balance FROM snapshot_balances WHERE snapshot_id = ?").all(snapshotId) as { owner: string; balance: string }[];
    balances = new Map(rows.map((r) => [r.owner, BigInt(r.balance)]));
    total = sumBig([...balances.values()]);
  } else {
    const exclude = new Set([...ctx.reg.snapshot.excludeOwners, ctx.keys.manager().publicKey.toBase58(), worker.publicKey.toBase58(), ctx.reg.treasury].filter(Boolean));
    const snap = await snapshotHolders(ctx.conn, new PublicKey(lst.mint), exclude);
    balances = snap.balances; total = snap.total;
    ctx.log(`${lst.symbol}: snapshot slot ${snap.slot}: ${balances.size} holders, ${sol(total)} ${lst.symbol} (${snap.accounts} token accounts)`);
    if (!ctx.dryRun) {
      const tx = ctx.db.transaction(() => {
        const r = ctx.db.prepare("INSERT INTO snapshots (lst, epoch, slot, total, holders, ts) VALUES (?, ?, ?, ?, ?, ?)").run(lst.symbol, epoch, snap.slot, total.toString(), balances.size, now());
        const id = Number(r.lastInsertRowid);
        const ins = ctx.db.prepare("INSERT INTO snapshot_balances (snapshot_id, owner, balance) VALUES (?, ?, ?)");
        for (const [o, b] of balances) ins.run(id, o, b.toString());
        return id;
      });
      snapshotId = tx();
      setEpoch(ctx, lst.symbol, epoch, { snapshot_id: snapshotId });
    }
  }

  // 5. swap (once per epoch)
  let received = 0n;
  if (row?.swap_id) {
    const s = ctx.db.prepare("SELECT out_amount FROM swaps WHERE id = ?").get(row.swap_id) as { out_amount: string };
    received = BigInt(s.out_amount);
  } else if (total === 0n) {
    ctx.log(`${lst.symbol}: no holders; carrying ${sol(budget)} SOL`);
    setEpoch(ctx, lst.symbol, epoch, { carried_lamports: budget.toString(), status: "done", finished_at: now(), notes: "no holders" });
    return;
  } else if (budget < BigInt(ctx.reg.distribution.minSwapLamports)) {
    ctx.log(`${lst.symbol}: budget ${sol(budget)} below minSwap ${sol(ctx.reg.distribution.minSwapLamports)}; carrying`);
    setEpoch(ctx, lst.symbol, epoch, { carried_lamports: budget.toString(), status: "done", finished_at: now(), notes: "carried: below min swap" });
    return;
  } else if (ctx.dryRun) {
    const q = await quoteFill(ctx.conn, lst, budget);
    received = q.outAmount;
    ctx.log(`[dry-run] ${q.mode} quote ${sol(budget)} SOL -> ${units(received, lst.asset.decimals)} ${lst.asset.symbol}`);
  } else {
    const before = await tokenBalance(ctx.conn, ata(mint, worker.publicKey, prog), prog);
    const r = await fill(ctx.conn, worker, lst, budget, { treasury: ctx.reg.treasury ? new PublicKey(ctx.reg.treasury) : undefined });
    const after = await tokenBalance(ctx.conn, ata(mint, worker.publicKey, prog), prog);
    received = after > before ? after - before : r.outAmount;
    const ins = ctx.db.prepare("INSERT INTO swaps (lst, epoch, input_mint, output_mint, in_amount, out_amount, signature, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(lst.symbol, epoch, SOL_MINT, lst.asset.mint, budget.toString(), received.toString(), r.signature, now());
    setEpoch(ctx, lst.symbol, epoch, { swap_id: Number(ins.lastInsertRowid), carried_lamports: "0" });
    ctx.log(`${lst.symbol}: ${r.mode} fill ${sol(budget)} SOL -> ${units(received, lst.asset.decimals)} ${lst.asset.symbol}: ${r.signature}`);
  }

  // 6. credit (once per epoch, keyed by status)
  if (row?.status !== "credited" && row?.status !== "settled" && !row?.distribution_id) {
    let creditedTotal = 0n;
    const tx = ctx.db.transaction(() => {
      for (const [owner, bal] of balances) {
        const share = (received * bal) / total;
        if (share === 0n) continue;
        const led = ledgerGet(ctx, lst.symbol, owner);
        ledgerSet(ctx, lst.symbol, owner, { ...led, owed: led.owed + share }, epoch);
        creditedTotal += share;
      }
    });
    tx();
    ctx.log(`${lst.symbol}: credited ${units(creditedTotal, lst.asset.decimals)} ${lst.asset.symbol} to ${balances.size} holders (dust ${units(received - creditedTotal, lst.asset.decimals)} stays in the float)`);
    setEpoch(ctx, lst.symbol, epoch, { status: "credited" });
  }

  // 7-8. deliver
  if (lst.delivery === "merkle") {
    const ok = await settleDistributions(ctx, lst);
    if (!ok) { ctx.log(`${lst.symbol}: previous distribution not closable yet; run 'epoch settle' later (cron retries)`); setEpoch(ctx, lst.symbol, epoch, { status: "credited", notes: "waiting for clawback" }); return; }
    const id = await publishDistribution(ctx, lst, epoch);
    setEpoch(ctx, lst.symbol, epoch, { distribution_id: id, status: "done", finished_at: now() });
  } else {
    await directPayouts(ctx, lst, epoch);
    setEpoch(ctx, lst.symbol, epoch, { status: "done", finished_at: now(), ...(demo ? { notes: "demo" } : {}) });
  }
  ctx.log(`${lst.symbol}: epoch ${epoch} done`);
}

export async function epochRun(args: { lst?: string; dryRun?: boolean; force?: boolean; demo?: boolean }) {
  const ctx = makeCtx({ dryRun: args.dryRun });
  const lsts = pickLsts(ctx, args.lst);
  if (lsts.length === 0) { console.log("no live LSTs"); return; }
  for (const l of lsts) {
    try { await runEpochFor(ctx, l, args.force, args.demo); } catch (e) { ctx.log(`${l.symbol}: FAILED: ${(e as Error).stack ?? e}`); if (args.lst) throw e; }
  }
}

/** Resume epochs stuck waiting on clawback: settle + publish. */
export async function epochSettle(args: { lst?: string; dryRun?: boolean }) {
  const ctx = makeCtx({ dryRun: args.dryRun });
  for (const l of pickLsts(ctx, args.lst).filter((l) => l.delivery === "merkle")) {
    const pending = ctx.db.prepare("SELECT epoch FROM epochs WHERE lst = ? AND status = 'credited' ORDER BY epoch DESC LIMIT 1").get(l.symbol) as { epoch: number } | undefined;
    const ok = await settleDistributions(ctx, l);
    if (!ok) continue;
    if (pending) {
      const id = await publishDistribution(ctx, l, pending.epoch);
      setEpoch(ctx, l.symbol, pending.epoch, { distribution_id: id, status: "done", finished_at: now() });
      ctx.log(`${l.symbol}: epoch ${pending.epoch} settled`);
    }
  }
}

export const LAMPORTS = LAMPORTS_PER_SOL;
