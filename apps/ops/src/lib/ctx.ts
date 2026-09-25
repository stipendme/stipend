import { existsSync, appendFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, Signer, ComputeBudgetProgram, LAMPORTS_PER_SOL, sendAndConfirmTransaction } from "@solana/web3.js";
import { loadRegistry, saveRegistry, findRepoRoot, makeConnection, makeKitRpc, openDb, loadKeypair, type Registry, type Db, type LstEntry } from "@stipend/core";

export interface Ctx {
  root: string; reg: Registry; conn: Connection; kit: ReturnType<typeof makeKitRpc>; db: Db; dryRun: boolean;
  keys: { worker: () => Keypair; manager: () => Keypair; staker: () => Keypair };
  log: (...a: unknown[]) => void;
}

function keyLoader(root: string, name: string, env: string) {
  let cached: Keypair | undefined;
  return () => {
    if (cached) return cached;
    const p = process.env[env] ?? join(root, "keys", `${name}.json`);
    if (!existsSync(p)) throw new Error(`missing keypair ${p} (set ${env})`);
    cached = loadKeypair(p);
    return cached;
  };
}

export function makeCtx(opts: { dryRun?: boolean } = {}): Ctx {
  const root = findRepoRoot();
  const reg = loadRegistry();
  const logPath = join(root, "data", "ops.log");
  mkdirSync(dirname(logPath), { recursive: true });
  const log = (...a: unknown[]) => {
    const line = `${new Date().toISOString()} ${a.map((x) => (typeof x === "string" ? x : JSON.stringify(x, (_k, v) => (typeof v === "bigint" ? v.toString() : v)))).join(" ")}`;
    console.log(line);
    try { appendFileSync(logPath, line + "\n"); } catch { /* ignore */ }
  };
  return {
    root, reg, conn: makeConnection(), kit: makeKitRpc(), db: openDb(), dryRun: !!opts.dryRun,
    keys: { worker: keyLoader(root, "worker", "STIPEND_WORKER_KEY"), manager: keyLoader(root, "manager", "STIPEND_MANAGER_KEY"), staker: keyLoader(root, "staker", "STIPEND_STAKER_KEY") },
    log,
  };
}

export function saveReg(ctx: Ctx) { saveRegistry(ctx.reg); }

export function pickLsts(ctx: Ctx, symbol?: string, includeDraft = false): LstEntry[] {
  const all = symbol ? ctx.reg.lsts.filter((l) => l.symbol.toLowerCase() === symbol.toLowerCase()) : ctx.reg.lsts;
  if (symbol && all.length === 0) throw new Error(`LST ${symbol} not in registry`);
  return all.filter((l) => includeDraft || l.status === "live");
}

export const PRIORITY_FEE = Number(process.env.PRIORITY_FEE_MICROLAMPORTS ?? 50_000);

/** Sign + send a legacy tx with the given signers (first signer pays). Chunks are the caller's job. */
export async function sendTx(ctx: Ctx, ixs: TransactionInstruction[], signers: Signer[], label: string): Promise<string> {
  if (ixs.length === 0) return "";
  if (ctx.dryRun) {
    ctx.log(`[dry-run] would send ${label}: ${ixs.length} ix, signers ${signers.map((s) => s.publicKey.toBase58()).join(",")}`);
    return "dry-run";
  }
  const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_FEE }), ...ixs);
  tx.feePayer = signers[0].publicKey;
  const sig = await sendAndConfirmTransaction(ctx.conn, tx, signers, { commitment: "confirmed", maxRetries: 5 });
  ctx.log(`${label}: ${sig}`);
  return sig;
}

export const sol = (l: bigint | number) => (Number(l) / LAMPORTS_PER_SOL).toFixed(4);
export const units = (n: bigint | string, decimals: number) => {
  const v = BigInt(n); const d = 10n ** BigInt(decimals);
  return `${v / d}.${(v % d).toString().padStart(decimals, "0").slice(0, Math.min(decimals, 6))}`;
};
export const pk = (s: string) => new PublicKey(s);
export const now = () => Math.floor(Date.now() / 1000);

export function table(rows: Record<string, unknown>[]) {
  if (rows.length === 0) { console.log("(none)"); return; }
  const cols = Object.keys(rows[0]);
  const str = (v: unknown) => (typeof v === "bigint" ? v.toString() : v === undefined || v === null ? "" : String(v));
  const w = cols.map((c) => Math.max(c.length, ...rows.map((r) => str(r[c]).length)));
  console.log(cols.map((c, i) => c.padEnd(w[i])).join("  "));
  for (const r of rows) console.log(cols.map((c, i) => str(r[c]).padEnd(w[i])).join("  "));
}
