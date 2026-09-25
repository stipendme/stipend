import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getPoolStats, buildUpdatePool, buildIncreaseValidatorStake, buildDecreaseValidatorStake, reserveTarget, rpcUrl, tokenBalance, ata, tokenProgramId, type LstEntry, type PoolStats } from "@stipend/core";
import { makeCtx, pickLsts, sendTx, sol, table, units, saveReg, type Ctx } from "../lib/ctx.js";

export async function updatePool(ctx: Ctx, lst: LstEntry, force = false): Promise<boolean> {
  const stats = await getPoolStats(ctx.conn, lst);
  if (!stats.needsUpdate && !force) return false;
  const payer = ctx.keys.worker();
  const { updateList, final } = await buildUpdatePool(ctx.conn, lst);
  for (const ix of updateList) await sendTx(ctx, [ix], [payer], `${lst.symbol} update-validator-list`);
  await sendTx(ctx, final, [payer], `${lst.symbol} update-stake-pool-balance`);
  return true;
}

export async function adminStatus(args: { lst?: string }) {
  const ctx = makeCtx();
  const lsts = pickLsts(ctx, args.lst, true).filter((l) => l.stakePool);
  if (lsts.length === 0) { console.log("no LSTs with a stake pool in the registry (run assets sync + create-lst)"); return; }
  const rows = [];
  for (const l of lsts) {
    const s = await getPoolStats(ctx.conn, l);
    const target = reserveTarget(s, ctx.reg.reserve);
    rows.push({
      lst: l.symbol, status: l.status, delivery: l.delivery, totalSOL: sol(s.totalLamports), supply: sol(s.poolTokenSupply), reserve: sol(s.reserveLamports), active: sol(s.activeStakeLamports), transient: sol(s.transientLamports),
      feeTokens: sol(s.managerFeeTokens), lastUpd: s.lastUpdateEpoch, epoch: s.currentEpoch, needsUpdate: s.needsUpdate, reserveTarget: sol(target), shortfall: s.reserveLamports < target ? sol(target - s.reserveLamports) : "0",
      epochFee: `${s.fees.epoch.numerator}/${s.fees.epoch.denominator}`, solWFee: `${s.fees.solWithdrawal.numerator}/${s.fees.solWithdrawal.denominator}`, validators: s.validators.map((v) => `${v.vote.slice(0, 4)}…:${sol(v.active)}`).join(" "),
    });
  }
  table(rows);
}

export async function adminUpdate(args: { lst?: string; dryRun?: boolean }) {
  const ctx = makeCtx({ dryRun: args.dryRun });
  for (const l of pickLsts(ctx, args.lst, true).filter((l) => l.stakePool)) {
    const did = await updatePool(ctx, l, true);
    ctx.log(`${l.symbol}: ${did ? "updated" : "already current"}`);
  }
}

/** Keep reserve at target; delegate the excess to the validator, or pull stake back when short. */
export async function adminRebalance(args: { lst?: string; dryRun?: boolean }) {
  const ctx = makeCtx({ dryRun: args.dryRun });
  const staker = ctx.keys.staker();
  const vote = new PublicKey(ctx.reg.validator.voteAccount);
  for (const l of pickLsts(ctx, args.lst, true).filter((l) => l.stakePool)) {
    await updatePool(ctx, l);
    const s = await getPoolStats(ctx.conn, l);
    const target = reserveTarget(s, ctx.reg.reserve);
    if (!s.validators.some((v) => v.vote === vote.toBase58())) { ctx.log(`${l.symbol}: validator ${vote.toBase58()} not in the pool; nothing to rebalance`); continue; }
    const minDelta = BigInt(LAMPORTS_PER_SOL); // stake pool needs >= 1 SOL moves
    if (s.reserveLamports > target + minDelta) {
      const amt = s.reserveLamports - target;
      ctx.log(`${l.symbol}: reserve ${sol(s.reserveLamports)} > target ${sol(target)}; increasing validator stake by ${sol(amt)}`);
      await sendTx(ctx, await buildIncreaseValidatorStake(ctx.conn, l, vote, amt), [staker], `${l.symbol} increase-validator-stake`);
    } else if (s.reserveLamports + minDelta < target) {
      const want = target - s.reserveLamports;
      const amt = want < s.activeStakeLamports ? want : s.activeStakeLamports;
      if (amt < minDelta) { ctx.log(`${l.symbol}: short ${sol(want)} but nothing active to pull`); continue; }
      ctx.log(`${l.symbol}: reserve ${sol(s.reserveLamports)} < target ${sol(target)}; decreasing validator stake by ${sol(amt)} (lands next epoch)`);
      await sendTx(ctx, await buildDecreaseValidatorStake(ctx.conn, l, vote, amt), [staker], `${l.symbol} decrease-validator-stake`);
    } else ctx.log(`${l.symbol}: reserve ${sol(s.reserveLamports)} within band of target ${sol(target)}`);
  }
}

export async function adminSetFee(args: { lst?: string; kind?: string; num?: string; den?: string; dryRun?: boolean }) {
  const ctx = makeCtx({ dryRun: args.dryRun });
  if (!args.lst || !args.kind || !args.num || !args.den) throw new Error("--lst --kind epoch|sol-withdrawal|stake-withdrawal|sol-deposit|stake-deposit --num N --den D");
  const [l] = pickLsts(ctx, args.lst, true);
  const managerPath = process.env.STIPEND_MANAGER_KEY ?? join(ctx.root, "keys", "manager.json");
  const cli = ["--url", rpcUrl(), "--fee-payer", managerPath, "--manager", managerPath, "set-fee", l.stakePool, args.kind, args.num, args.den];
  ctx.log(`spl-stake-pool ${cli.join(" ")}`);
  if (ctx.dryRun) return;
  execFileSync("spl-stake-pool", cli, { stdio: "inherit" });
  ctx.log("fee change queued; epoch and withdrawal fee changes take effect next epoch");
}

export async function adminLive(args: { lst?: string; pause?: boolean }) {
  const ctx = makeCtx();
  const [l] = pickLsts(ctx, args.lst, true);
  if (!l.stakePool) throw new Error(`${l.symbol} has no stake pool yet`);
  l.status = args.pause ? "paused" : "live";
  saveReg(ctx);
  ctx.log(`${l.symbol} is now ${l.status}`);
}

export async function adminTreasury() {
  const ctx = makeCtx();
  const worker = ctx.keys.worker().publicKey;
  const treasury = ctx.reg.treasury ? new PublicKey(ctx.reg.treasury) : undefined;
  const rows: Record<string, unknown>[] = [];
  for (const [name, owner] of [["worker", worker], ["treasury", treasury]] as const) {
    if (!owner) continue;
    const row: Record<string, unknown> = { wallet: name, address: owner.toBase58(), SOL: sol(await ctx.conn.getBalance(owner)) };
    for (const l of ctx.reg.lsts) {
      const prog = tokenProgramId(l.asset.tokenProgram);
      row[l.asset.symbol] = units(await tokenBalance(ctx.conn, ata(new PublicKey(l.asset.mint), owner, prog), prog), l.asset.decimals);
    }
    rows.push(row);
  }
  table(rows);
}

export type { PoolStats };
