import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join, isAbsolute, relative } from "node:path";
import { Keypair, PublicKey } from "@solana/web3.js";
import { getPoolStats, buildAddValidator, buildCreatePoolTokenMetadata, buildDepositSol, rpcUrl, loadKeypair, type LstEntry } from "@stipend/core";
import { makeCtx, saveReg, sendTx, sol } from "../lib/ctx.js";

function ensureKeypair(path: string, dryRun: boolean): Keypair {
  if (existsSync(path)) return loadKeypair(path);
  const kp = Keypair.generate();
  if (!dryRun) writeFileSync(path, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600 });
  return kp;
}

/**
 * create-lst --symbol nvdaSOL --asset NVDAx --mint-keypair keys/nvdasol-mint.json [--dry-run]
 * 1. spl-stake-pool create-pool (CLI 0.6.4) with the vanity mint keypair, manager = keys/manager.json, fees from registry
 * 2. add-validator (staker) via JS
 * 3. create pool token metadata (manager pays) via JS
 * 4. write the registry entry (status draft; flip to live with `admin live --lst`)
 */
export async function createLst(args: { symbol?: string; asset?: string; mintKeypair?: string; dryRun?: boolean; maxValidators?: string; via?: "cli" | "ts" }) {
  if (args.via === "ts") return createLstTs(args);
  const ctx = makeCtx({ dryRun: args.dryRun });
  if (!args.symbol || !args.mintKeypair) throw new Error("--symbol and --mint-keypair are required");
  const draft = ctx.reg.lsts.find((l) => l.symbol.toLowerCase() === args.symbol!.toLowerCase());
  if (!draft) throw new Error(`run 'assets sync' first; ${args.symbol} is not a draft in the registry`);
  if (draft.stakePool) throw new Error(`${draft.symbol} already has stake pool ${draft.stakePool}`);
  if (args.asset && draft.asset.symbol.toLowerCase() !== args.asset.toLowerCase()) throw new Error(`draft ${draft.symbol} pays ${draft.asset.symbol}, not ${args.asset}`);

  const mintPath = isAbsolute(args.mintKeypair) ? args.mintKeypair : join(ctx.root, args.mintKeypair);
  if (!existsSync(mintPath)) throw new Error(`mint keypair ${mintPath} not found (solana-keygen grind --starts-with nvda:1)`);
  const mintKp = loadKeypair(mintPath);
  const base = draft.symbol.toLowerCase();
  const keysDir = process.env.STIPEND_KEYS_DIR ?? join(ctx.root, "keys");
  const poolKp = ensureKeypair(join(keysDir, `${base}-pool.json`), ctx.dryRun);
  const listKp = ensureKeypair(join(keysDir, `${base}-validator-list.json`), ctx.dryRun);
  const reserveKp = ensureKeypair(join(keysDir, `${base}-reserve.json`), ctx.dryRun);
  const managerPath = process.env.STIPEND_MANAGER_KEY ?? join(ctx.root, "keys", "manager.json");
  const stakerPath = process.env.STIPEND_STAKER_KEY ?? join(ctx.root, "keys", "staker.json");
  const f = ctx.reg.fees;

  const cli = [
    "--url", rpcUrl(), "--fee-payer", managerPath, "--manager", managerPath, "--staker", stakerPath,
    "create-pool",
    "--epoch-fee-numerator", String(f.epochFee.numerator), "--epoch-fee-denominator", String(f.epochFee.denominator),
    "--withdrawal-fee-numerator", String(f.stakeWithdrawalFee.numerator), "--withdrawal-fee-denominator", String(f.stakeWithdrawalFee.denominator),
    "--deposit-fee-numerator", String(f.stakeDepositFee.numerator), "--deposit-fee-denominator", String(f.stakeDepositFee.denominator),
    "--referral-fee", "0", "--max-validators", args.maxValidators ?? "4", "--unsafe-fees",
    "--mint-keypair", mintPath, "--pool-keypair", join(keysDir, `${base}-pool.json`),
    "--validator-list-keypair", join(keysDir, `${base}-validator-list.json`), "--reserve-keypair", join(keysDir, `${base}-reserve.json`),
  ];
  ctx.log(`create-pool: spl-stake-pool ${cli.map((a) => (a.includes(" ") ? JSON.stringify(a) : a)).join(" ")}`);
  ctx.log(`mint ${mintKp.publicKey.toBase58()} pool ${poolKp.publicKey.toBase58()} validatorList ${listKp.publicKey.toBase58()} reserve ${reserveKp.publicKey.toBase58()}`);
  ctx.log(`then: set-fee ${poolKp.publicKey.toBase58()} sol-withdrawal ${f.solWithdrawalFee.numerator} ${f.solWithdrawalFee.denominator} (create-pool only takes one withdrawal fee, applied to stake withdrawals)`);
  if (ctx.dryRun) { ctx.log("[dry-run] nothing sent"); return; }

  if (!existsSync(managerPath) || !existsSync(stakerPath)) throw new Error("keys/manager.json and keys/staker.json are required");
  execFileSync("spl-stake-pool", cli, { stdio: "inherit" });
  // create-pool's --withdrawal-fee only sets the stake withdrawal fee; set the SOL withdrawal fee explicitly (manager signs).
  execFileSync("spl-stake-pool", ["--url", rpcUrl(), "--fee-payer", managerPath, "--manager", managerPath, "set-fee", poolKp.publicKey.toBase58(), "sol-withdrawal", String(f.solWithdrawalFee.numerator), String(f.solWithdrawalFee.denominator)], { stdio: "inherit" });
  if (f.solDepositFee.numerator > 0) execFileSync("spl-stake-pool", ["--url", rpcUrl(), "--fee-payer", managerPath, "--manager", managerPath, "set-fee", poolKp.publicKey.toBase58(), "sol-deposit", String(f.solDepositFee.numerator), String(f.solDepositFee.denominator)], { stdio: "inherit" });

  const lst: Pick<LstEntry, "stakePool"> = { stakePool: poolKp.publicKey.toBase58() };
  const staker = ctx.keys.staker();
  const manager = ctx.keys.manager();
  // add-validator moves the stake minimum delegation (1 SOL on mainnet) from the reserve into the validator's stake account
  // and the reserve must stay rent-exempt, so the manager seeds the reserve first with a deposit. The CLI makes the
  // manager's own token account the fee account, so the 1.01 LST this mints is redeemed with the first epoch's fee and
  // paid to holders as a small launch bonus. Verified on a fork (docs/OPS.md); accepted rather than worked around.
  const rpcMin = BigInt(await ctx.conn.getStakeMinimumDelegation().then((r) => r.value).catch(() => 0));
  const minDelegation = rpcMin > 1_000_000_000n ? rpcMin : 1_000_000_000n; // the program enforces 1 SOL even where the RPC reports less (forks)
  const seed = minDelegation + 10_000_000n; // + 0.01 SOL buffer
  const dep = await buildDepositSol(ctx.conn, lst, manager.publicKey, seed);
  await sendTx(ctx, dep.instructions, [manager, ...dep.signers], `manager deposits ${sol(seed)} SOL to seed the reserve for add-validator`);
  await sendTx(ctx, await buildAddValidator(ctx.conn, lst, new PublicKey(ctx.reg.validator.voteAccount)), [staker], "add-validator");
  const uri = `https://${ctx.reg.brand.domain}/meta/${draft.symbol}.json`;
  await sendTx(ctx, await buildCreatePoolTokenMetadata(ctx.conn, lst, manager.publicKey, draft.name, draft.symbol, uri), [manager], "create-token-metadata");

  const stats = await getPoolStats(ctx.conn, lst);
  draft.stakePool = stats.address; draft.mint = stats.mint; draft.validatorList = stats.validatorList; draft.reserve = stats.reserve; draft.managerFeeAccount = stats.managerFeeAccount;
  draft.mintKeypair = isAbsolute(args.mintKeypair!) ? relative(ctx.root, args.mintKeypair!) : args.mintKeypair; draft.createdEpoch = stats.currentEpoch; draft.status = "draft";
  saveReg(ctx);
  ctx.log(`registry updated for ${draft.symbol}. Fund the reserve, run 'admin status --lst ${draft.symbol}', then 'admin live --lst ${draft.symbol}'.`);
}


/** Same result as the CLI path, but every transaction is built by core/launch.ts (the builders the self-service launch uses) and the manager pays. */
export async function createLstTs(args: { symbol?: string; mintKeypair?: string; dryRun?: boolean; maxValidators?: string; payer?: Keypair; creator?: string }) {
  const { buildLaunchTransactions, serializePartial, launchPolicy } = await import("@stipend/core");
  const ctx = makeCtx({ dryRun: args.dryRun });
  if (!args.symbol || !args.mintKeypair) throw new Error("--symbol and --mint-keypair are required");
  const draft = ctx.reg.lsts.find((l) => l.symbol.toLowerCase() === args.symbol!.toLowerCase());
  if (!draft) throw new Error(`run 'assets sync' first; ${args.symbol} is not a draft in the registry`);
  if (draft.stakePool) throw new Error(`${draft.symbol} already has stake pool ${draft.stakePool}`);
  const mintPath = isAbsolute(args.mintKeypair) ? args.mintKeypair : join(ctx.root, args.mintKeypair);
  if (!existsSync(mintPath)) throw new Error(`mint keypair ${mintPath} not found`);
  const keysDir = process.env.STIPEND_KEYS_DIR ?? join(ctx.root, "keys");
  const base = draft.symbol.toLowerCase();
  const keys = { mint: loadKeypair(mintPath), pool: ensureKeypair(join(keysDir, `${base}-pool.json`), false), validatorList: ensureKeypair(join(keysDir, `${base}-validator-list.json`), false), reserve: ensureKeypair(join(keysDir, `${base}-reserve.json`), false) };
  const manager = ctx.keys.manager(), staker = ctx.keys.staker();
  const payer = args.payer ?? manager;
  const pol = launchPolicy(ctx.reg);
  const { txs, addresses, costs } = await buildLaunchTransactions(ctx.conn, {
    payer: payer.publicKey, manager: manager.publicKey, staker: staker.publicKey, keys, fees: ctx.reg.fees, maxValidators: Number(args.maxValidators ?? pol.maxValidators),
    validatorVote: new PublicKey(ctx.reg.validator.voteAccount), name: draft.name, symbol: draft.symbol, uri: `https://${ctx.reg.brand.domain}/meta/${draft.symbol}.json`, seedLamports: BigInt(pol.seedLamports), addValidator: process.env.STIPEND_SKIP_VALIDATOR !== "1", createMetadata: process.env.STIPEND_SKIP_METADATA !== "1",
  });
  ctx.log(`launch ${draft.symbol} via ts: pool ${addresses.pool} mint ${addresses.mint} list ${addresses.validatorList} reserve ${addresses.reserve}; total cost ${sol(costs.totalLamports)} SOL incl. ${sol(costs.seedLamports)} seed`);
  const sigs: string[] = [];
  // resume: a launch that died mid-way (or a devnet retry) skips steps whose effect is already on chain
  const METAPLEX = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
  const stepDone = async (step: string): Promise<boolean> => {
    try {
      switch (step) {
        case "accounts": return !!(await ctx.conn.getAccountInfo(new PublicKey(addresses.mint)));
        case "initialize": { const a = await ctx.conn.getAccountInfo(new PublicKey(addresses.pool)); return !!a && a.data.length > 0 && a.data[0] === 1; }
        case "seed": { const { getAssociatedTokenAddressSync } = await import("@solana/spl-token"); const b = await ctx.conn.getTokenAccountBalance(getAssociatedTokenAddressSync(new PublicKey(addresses.mint), payer.publicKey)).catch(() => null); return !!b && BigInt(b.value.amount) >= BigInt(pol.seedLamports); }
        case "configure": {
          const s = await getPoolStats(ctx.conn, { stakePool: addresses.pool });
          if (process.env.STIPEND_SKIP_VALIDATOR === "1") return s.fees.solWithdrawal.numerator === ctx.reg.fees.solWithdrawalFee.numerator && s.fees.solWithdrawal.denominator === ctx.reg.fees.solWithdrawalFee.denominator;
          return s.validators.some((v) => v.vote === ctx.reg.validator.voteAccount);
        }
        case "metadata": { const [pda] = PublicKey.findProgramAddressSync([Buffer.from("metadata"), METAPLEX.toBuffer(), new PublicKey(addresses.mint).toBuffer()], METAPLEX); return !!(await ctx.conn.getAccountInfo(pda)); }
        default: return false;
      }
    } catch { return false; }
  };
  for (const t of txs) {
    if (!ctx.dryRun && (await stepDone(t.step))) { ctx.log(`${draft.symbol} launch/${t.step}: already on chain, skipping`); sigs.push("resumed"); continue; }
    if (ctx.dryRun) { ctx.log(`[dry-run] ${t.step}: ${t.tx.instructions.length} ix, backend signers ${t.backendSigners.map((k) => k.publicKey.toBase58()).join(",")}${t.needsManager ? " +manager" : ""}${t.needsStaker ? " +staker" : ""}; ${serializePartial(t.tx).length} b64 bytes`); continue; }
    const signers = [payer, ...t.backendSigners, ...(t.needsManager ? [manager] : []), ...(t.needsStaker ? [staker] : [])].filter((k, i, a) => a.findIndex((x) => x.publicKey.equals(k.publicKey)) === i);
    sigs.push(await sendTx(ctx, t.tx.instructions, signers, `${draft.symbol} launch/${t.step}`));
  }
  if (ctx.dryRun) return;
  const stats = await getPoolStats(ctx.conn, { stakePool: addresses.pool });
  draft.stakePool = stats.address; draft.mint = stats.mint; draft.validatorList = stats.validatorList; draft.reserve = stats.reserve; draft.managerFeeAccount = stats.managerFeeAccount;
  draft.mintKeypair = isAbsolute(args.mintKeypair!) ? relative(ctx.root, args.mintKeypair!) : args.mintKeypair; draft.createdEpoch = stats.currentEpoch; draft.status = "draft"; draft.launchTx = sigs; draft.launchedAt = Math.floor(Date.now() / 1000);
  if (args.creator) { draft.creator = args.creator; draft.creatorFeeBps = pol.creatorFeeBps; }
  saveReg(ctx);
  ctx.log(`registry updated for ${draft.symbol} (via ts). 'admin live --lst ${draft.symbol}' when ready.`);
  return { addresses, sigs };
}
