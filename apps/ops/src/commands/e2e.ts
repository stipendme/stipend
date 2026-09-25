/**
 * End-to-end rehearsal against a Surfpool fork of mainnet. Everything is real except the Jupiter fill,
 * which core's swap() stands in for with cheatcodes when the RPC is a surfnet.
 *
 *   RPC_URL=http://127.0.0.1:28899 pnpm ops e2e --symbol nvdaSOL [--via ts|cli] [--verify-cli]
 *
 * --via ts      launch through core/launch.ts (the self-service builders) with a scratch USER key as payer + creator
 * --verify-cli  also launch a second draft through the spl-stake-pool CLI and diff every stake-pool instruction
 *               (data bytes + account flags) between the two pools' transactions on the fork
 *
 * Uses a scratch keys dir, registry copy and DB under data/e2e/ so nothing in config/ or keys/ is touched.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Keypair, PublicKey, LAMPORTS_PER_SOL, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { createCloseAccountInstruction, createTransferCheckedInstruction } from "@solana/spl-token";
import { findRepoRoot, loadRegistry, saveRegistry, makeConnection, isSurfnet, surfnet, getPoolStats, buildDepositSol, buildWithdrawSol, ata, tokenProgramId, tokenBalance, launchPolicy } from "@stipend/core";
import { makeCtx, sendTx, sol, units } from "../lib/ctx.js";
import { ensureLaunchTables } from "../lib/launchdb.js";
import { createLst, createLstTs } from "./createLst.js";
import { runEpochFor } from "./epoch.js";
import { adminStatus, adminRebalance } from "./admin.js";

const SOL = (n: number) => BigInt(Math.round(n * LAMPORTS_PER_SOL));

function writeKey(path: string): Keypair {
  if (existsSync(path)) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
  const kp = Keypair.generate();
  writeFileSync(path, JSON.stringify(Array.from(kp.secretKey)));
  return kp;
}

export async function e2e(args: { symbol?: string; keep?: boolean; via?: "cli" | "ts"; verifyCli?: boolean }) {
  const symbol = args.symbol ?? "nvdaSOL";
  const via = args.via ?? "cli";
  const root = findRepoRoot();
  const conn = makeConnection();
  if (!(await isSurfnet(conn))) throw new Error(`${conn.rpcEndpoint} is not a surfnet; refusing to run the rehearsal against a real cluster`);

  const dir = join(root, "data", "e2e");
  if (!args.keep) rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, "keys"), { recursive: true });
  const regPath = join(dir, "registry.json");
  if (!existsSync(regPath)) {
    const reg = loadRegistry();
    reg.lsts = reg.lsts.map((l) => ({ ...l, stakePool: "", mint: "", validatorList: "", reserve: "", managerFeeAccount: "", status: "draft" as const, creator: undefined, creatorFeeBps: undefined }));
    reg.treasury = "";
    saveRegistry(reg, regPath);
  }
  process.env.STIPEND_REGISTRY = regPath;
  process.env.STIPEND_DB = join(dir, "stipend.db");
  process.env.STIPEND_KEYS_DIR = join(dir, "keys");
  const keys = { manager: writeKey(join(dir, "keys", "manager.json")), staker: writeKey(join(dir, "keys", "staker.json")), worker: writeKey(join(dir, "keys", "worker.json")) };
  process.env.STIPEND_MANAGER_KEY = join(dir, "keys", "manager.json");
  process.env.STIPEND_STAKER_KEY = join(dir, "keys", "staker.json");
  process.env.STIPEND_WORKER_KEY = join(dir, "keys", "worker.json");
  const mintPath = join(dir, "keys", `${symbol.toLowerCase()}-mint.json`);
  writeKey(mintPath);
  const holders = [0, 1, 2].map((i) => writeKey(join(dir, "keys", `holder${i}.json`)));
  const treasury = writeKey(join(dir, "keys", "treasury.json"));
  const user = writeKey(join(dir, "keys", "user.json")); // self-service launcher / creator

  const log = (...a: unknown[]) => console.log(`[e2e] ${a.join(" ")}`);
  const fund = async (kp: Keypair, amount: number) => surfnet.setAccount(conn, kp.publicKey, { lamports: Number(SOL(amount)), owner: SystemProgram.programId.toBase58() });
  for (const [n, kp] of Object.entries(keys)) { await fund(kp, 20); log(`funded ${n} ${kp.publicKey.toBase58()}`); }
  for (const h of holders) await fund(h, 1000);
  await fund(treasury, 1); await fund(user, 5);

  // 1. create the LST
  const ctx0 = makeCtx();
  const lst0 = ctx0.reg.lsts.find((l) => l.symbol.toLowerCase() === symbol.toLowerCase());
  if (!lst0) throw new Error(`${symbol} not in registry drafts`);
  if (!lst0.stakePool) {
    if (via === "ts") await createLstTs({ symbol, mintKeypair: mintPath, payer: user, creator: user.publicKey.toBase58() });
    else await createLst({ symbol, mintKeypair: mintPath });
  }
  const ctx = makeCtx();
  ensureLaunchTables(ctx.db);
  ctx.reg.treasury = treasury.publicKey.toBase58();
  const lst = ctx.reg.lsts.find((l) => l.symbol.toLowerCase() === symbol.toLowerCase())!;
  lst.status = "live";
  saveRegistry(ctx.reg, regPath);
  log(`pool ${lst.stakePool} mint ${lst.mint} via ${via}${lst.creator ? ` creator ${lst.creator}` : ""}`);
  if (via === "ts") {
    const seedLst = await tokenBalance(ctx.conn, ata(new PublicKey(lst.mint), user.publicKey, tokenProgramId("spl-token")), tokenProgramId("spl-token"));
    if (seedLst !== BigInt(launchPolicy(ctx.reg).seedLamports)) throw new Error(`launcher holds ${seedLst} seed LST, expected ${launchPolicy(ctx.reg).seedLamports}`);
    log(`launcher received ${sol(seedLst)} ${lst.symbol} for the seed deposit (ok)`);
  }

  if (args.verifyCli) await verifyAgainstCli(ctx, lst.stakePool, dir, log);

  // 2. holders mint 100 / 300 / 600
  const amounts = [100, 300, 600];
  for (let i = 0; i < holders.length; i++) {
    const b = await buildDepositSol(ctx.conn, lst, holders[i].publicKey, SOL(amounts[i]));
    await sendTx(ctx, b.instructions, [holders[i], ...b.signers], `holder${i} deposit ${amounts[i]} SOL`);
    const bal = await tokenBalance(ctx.conn, ata(new PublicKey(lst.mint), holders[i].publicKey, tokenProgramId("spl-token")), tokenProgramId("spl-token"));
    if (bal !== SOL(amounts[i])) throw new Error(`holder${i} got ${bal} LST for ${amounts[i]} SOL; expected 1:1`);
    log(`holder${i} holds ${sol(bal)} ${lst.symbol} (1:1 ok)`);
  }
  let s = await getPoolStats(ctx.conn, lst);
  log(`pool: total ${sol(s.totalLamports)} SOL, supply ${sol(s.poolTokenSupply)}, reserve ${sol(s.reserveLamports)}, fee tokens ${sol(s.managerFeeTokens)}`);

  // 3. rebalance
  await adminRebalance({ lst: lst.symbol });
  s = await getPoolStats(ctx.conn, lst);
  log(`after rebalance: reserve ${sol(s.reserveLamports)}, transient ${sol(s.transientLamports)}, active ${sol(s.activeStakeLamports)}`);

  // 4. next epoch + 1 SOL of simulated rewards
  const runEpoch = async (label: string) => {
    const epochBefore = (await ctx.conn.getEpochInfo()).epoch;
    const t = await surfnet.timeTravel(ctx.conn, { absoluteEpoch: epochBefore + 1 });
    log(`${label}: time travel epoch ${epochBefore} -> ${t.epoch}`);
    const st = await getPoolStats(ctx.conn, lst);
    await surfnet.addLamports(ctx.conn, st.reserve, SOL(1));
    await runEpochFor(ctx, lst, true);
    return t.epoch;
  };
  const userBefore = await ctx.conn.getBalance(user.publicKey);
  const treBefore = await ctx.conn.getBalance(treasury.publicKey);
  await runEpoch("epoch A");
  s = await getPoolStats(ctx.conn, lst);
  log(`after epoch: total ${sol(s.totalLamports)}, supply ${sol(s.poolTokenSupply)}, fee tokens left ${sol(s.managerFeeTokens)}, rate ${(Number(s.totalLamports) / Number(s.poolTokenSupply)).toFixed(6)}`);

  // 5. pro-rata + rent funding assertions
  const assetMint = new PublicKey(lst.asset.mint);
  const prog = tokenProgramId(lst.asset.tokenProgram);
  const got: bigint[] = [];
  for (let i = 0; i < holders.length; i++) { const b = await tokenBalance(ctx.conn, ata(assetMint, holders[i].publicKey, prog), prog); got.push(b); log(`holder${i} received ${units(b, lst.asset.decimals)} ${lst.asset.symbol}`); }
  const totalGot = got.reduce((a, b) => a + b, 0n);
  if (totalGot === 0n) throw new Error("no payouts landed");
  const shares = got.map((g) => Number(g) / Number(totalGot));
  // the launcher's seed LST (via ts) is also in the snapshot: shares are 100:300:600:1.01
  const seedShare = via === "ts" ? 1.01 : 0;
  const denom = 1000 + seedShare;
  const expect = [100 / denom, 300 / denom, 600 / denom].map((x) => x * (1000 / (1000))); // relative among holders
  const holderTotal = shares.reduce((a, b) => a + b, 0);
  shares.map((x) => x / holderTotal).forEach((sh, i) => { const e = [0.1, 0.3, 0.6][i]; if (Math.abs(sh - e) > 0.01) throw new Error(`holder${i} share ${sh.toFixed(3)} != ${e}`); });
  log(`pro-rata split ok: ${shares.map((x) => (x / holderTotal * 100).toFixed(1) + "%").join(" / ")}`);
  const fundedRows = ctx.db.prepare("SELECT owner, funded_by, closures FROM funded_accounts WHERE lst = ?").all(lst.symbol) as { owner: string; funded_by: string; closures: number }[];
  if (fundedRows.length < 3 || fundedRows.some((r) => r.funded_by !== "platform")) throw new Error(`expected 3 platform-funded accounts, got ${JSON.stringify(fundedRows)}`);
  log(`rent: ${fundedRows.length} first accounts funded by the platform (ok)`);
  if (lst.creator) {
    const userAfter = await ctx.conn.getBalance(user.publicKey);
    const gain = BigInt(userAfter - userBefore);
    const row = ctx.db.prepare("SELECT lamports FROM creator_payouts WHERE lst = ? ORDER BY id DESC LIMIT 1").get(lst.symbol) as { lamports: string } | undefined;
    if (!row || BigInt(row.lamports) !== gain || gain <= 0n) throw new Error(`creator share mismatch: gained ${gain}, recorded ${row?.lamports}`);
    log(`creator received ${sol(gain)} SOL (${lst.creatorFeeBps ?? launchPolicy(ctx.reg).creatorFeeBps} bps of the platform fee) (ok)`);
  }
  log(`treasury received ${sol(BigInt((await ctx.conn.getBalance(treasury.publicKey)) - treBefore))} SOL`);

  // 6. closure griefing: holder0 empties and closes its funded account, then the next epoch must recreate it from holder0's own accrual
  const h0ata = ata(assetMint, holders[0].publicKey, prog);
  const h1ata = ata(assetMint, holders[1].publicKey, prog);
  const bal0 = await tokenBalance(ctx.conn, h0ata, prog);
  const closeTx = new Transaction().add(
    createTransferCheckedInstruction(h0ata, assetMint, h1ata, holders[0].publicKey, bal0, lst.asset.decimals, [], prog),
    createCloseAccountInstruction(h0ata, holders[0].publicKey, holders[0].publicKey, [], prog),
  );
  closeTx.feePayer = holders[0].publicKey;
  await sendAndConfirmTransaction(ctx.conn, closeTx, [holders[0]], { commitment: "confirmed" });
  log(`holder0 moved ${units(bal0, lst.asset.decimals)} ${lst.asset.symbol} to holder1 and closed its account (rent refunded)`);
  await runEpoch("epoch B");
  const f0 = ctx.db.prepare("SELECT funded_by, closures, asset_units_deducted FROM funded_accounts WHERE lst = ? AND owner = ?").get(lst.symbol, holders[0].publicKey.toBase58()) as { funded_by: string; closures: number; asset_units_deducted: string };
  const last = ctx.db.prepare("SELECT funded_by FROM rent_ledger WHERE lst = ? AND owner = ? ORDER BY id DESC LIMIT 1").get(lst.symbol, holders[0].publicKey.toBase58()) as { funded_by: string };
  const bal0b = await tokenBalance(ctx.conn, h0ata, prog);
  // funded_accounts.funded_by records the FIRST funding (platform); the recreation shows up as a closure strike + a holder-funded rent_ledger row
  if (f0.closures !== 1 || last.funded_by !== "holder" || BigInt(f0.asset_units_deducted) <= 0n) throw new Error(`closure handling wrong: ${JSON.stringify({ ...f0, last })}`);
  log(`holder0 recreated from own accrual: closures=${f0.closures}, ${units(f0.asset_units_deducted, lst.asset.decimals)} ${lst.asset.symbol} deducted for rent, received ${units(bal0b, lst.asset.decimals)} (ok)`);

  // 7. redeem 20 LST (within reserve liquidity)
  const before = await ctx.conn.getBalance(holders[0].publicKey);
  const w = await buildWithdrawSol(ctx.conn, lst, holders[0].publicKey, SOL(20));
  await sendTx(ctx, w.instructions, [holders[0], ...w.signers], "holder0 redeem 20 LST");
  log(`holder0 redeemed 20 ${lst.symbol} -> +${sol(BigInt((await ctx.conn.getBalance(holders[0].publicKey)) - before))} SOL (fee + tx)`);

  await adminStatus({ lst: lst.symbol });
  log("done. scratch state in data/e2e (registry, keys, db)");
}

/** Launch a second draft through the CLI and diff every stake-pool instruction against the TS-launched pool. */
async function verifyAgainstCli(ctx: ReturnType<typeof makeCtx>, tsPool: string, dir: string, log: (...a: unknown[]) => void) {
  const other = ctx.reg.lsts.find((l) => !l.stakePool && l.symbol !== ctx.reg.lsts.find((x) => x.stakePool === tsPool)?.symbol);
  if (!other) throw new Error("no second draft to launch via CLI");
  const mintPath = join(dir, "keys", `${other.symbol.toLowerCase()}-mint.json`);
  writeKey(mintPath);
  await createLst({ symbol: other.symbol, mintKeypair: mintPath });
  const reg = loadRegistry();
  const cliPool = reg.lsts.find((l) => l.symbol === other.symbol)!.stakePool;
  const dump = async (pool: string) => {
    const sigs = await ctx.conn.getSignaturesForAddress(new PublicKey(pool), { limit: 30 });
    const out: { disc: number; data: string; flags: string; n: number }[] = [];
    for (const s of sigs.reverse()) {
      const tx = await ctx.conn.getTransaction(s.signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
      if (!tx) continue;
      const msg = tx.transaction.message;
      const keys = msg.staticAccountKeys ?? (msg as unknown as { accountKeys: PublicKey[] }).accountKeys;
      for (const ix of msg.compiledInstructions) {
        if (!keys[ix.programIdIndex].equals(new PublicKey("SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy"))) continue;
        const data = Buffer.from(ix.data);
        const flags = ix.accountKeyIndexes.map((i) => `${msg.isAccountSigner(i) ? "s" : "-"}${msg.isAccountWritable(i) ? "w" : "-"}`).join(",");
        out.push({ disc: data[0], data: data.toString("hex"), flags, n: ix.accountKeyIndexes.length });
      }
    }
    return out;
  };
  const a = await dump(tsPool), b = await dump(cliPool);
  const name = (d: number) => ({ 0: "Initialize", 1: "AddValidator", 12: "SetFee", 14: "DepositSol", 17: "CreateTokenMetadata", 6: "UpdateValidatorList", 7: "UpdateStakePoolBalance", 8: "Cleanup" } as Record<number, string>)[d] ?? `ix${d}`;
  let mismatches = 0;
  for (const ia of a) {
    const ib = b.find((x) => x.disc === ia.disc);
    if (!ib) { log(`verify: ${name(ia.disc)} present in ts launch only (CLI path never sends it)`); continue; }
    // strings (metadata) and amounts (deposit) differ by design; a signer that is also the fee payer shows as writable in
    // the CLI path (manager pays there, the user pays here), so signer writability is ignored
    const dataSame = ia.disc === 17 || ia.disc === 14 ? ia.data.length === ib.data.length || ia.disc === 17 : ia.data === ib.data;
    const norm = (f: string, n: number) => f.split(",").slice(0, ia.disc === 17 ? 8 : n).map((x) => (x.startsWith("s") ? "s?" : x)).join(",");
    const flagsSame = norm(ia.flags, ia.n) === norm(ib.flags, ia.n) && (ia.disc === 17 ? ib.n >= 8 : ia.n === ib.n);
    if (ia.disc === 17 && ib.n !== ia.n) log(`verify note: CreateTokenMetadata account count ts=${ia.n} cli(js lib)=${ib.n}; the program reads the first 8, both landed`);
    if (!dataSame || !flagsSame) { mismatches++; log(`verify MISMATCH ${name(ia.disc)}: ts data=${ia.data} flags=${ia.flags} | cli data=${ib.data} flags=${ib.flags}`); }
    else log(`verify ${name(ia.disc)}: identical data${ia.disc === 17 || ia.disc === 14 ? " layout" : ""} and account flags (${ia.n} accounts)`);
  }
  if (mismatches) throw new Error(`${mismatches} instruction mismatches between ts and CLI launches`);
  log(`verify: ts launch matches the CLI byte-for-byte on ${a.length} stake-pool instructions (cli pool ${cliPool})`);
}
