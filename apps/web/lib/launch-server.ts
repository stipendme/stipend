// Server-only: self-service LST launch. Holds the backend keys, validates the asset, builds and co-signs the launch
// transactions, and advances a per-launch state machine stored in the worker DB.
import "server-only";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import {
  openDb as coreOpenDb, dbPath as coreDbPath, findRepoRoot, loadRegistry as coreLoadRegistry, saveRegistry, launchPolicy, buildLaunchTransactions, launchCosts, serializePartial,
  fetchMintInfo, tokenProgramName, transferFeeFor, getPoolStats, makeConnection, takeVanityKey, type Registry, type LstEntry, type AssetInfo, type LaunchTx, type Db,
} from "@stipend/core";
import { ExtensionType, getTransferHook } from "@solana/spl-token";

const LAUNCH_SCHEMA = `
CREATE TABLE IF NOT EXISTS launches (
  id TEXT PRIMARY KEY, symbol TEXT NOT NULL, asset_mint TEXT NOT NULL, creator TEXT NOT NULL,
  pool TEXT NOT NULL, mint TEXT NOT NULL, validator_list TEXT NOT NULL, reserve TEXT NOT NULL,
  keys_json TEXT NOT NULL, params_json TEXT NOT NULL,
  step INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending', signatures TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);`;

function registryPath(): string {
  const env = process.env.REGISTRY_PATH?.trim();
  return env ? path.resolve(process.cwd(), env) : (process.env.STIPEND_REGISTRY ?? path.join(findRepoRoot(), "config", "registry.json"));
}
export function loadRegistry(): Registry { return coreLoadRegistry(registryPath()); }
function openLaunchDb(): Db {
  const env = process.env.DB_PATH?.trim();
  const db = coreOpenDb(coreDbPath(env ? path.resolve(process.cwd(), env) : undefined));
  db.exec(LAUNCH_SCHEMA);
  return db;
}
function keyFrom(envName: string, file: string): Keypair | null {
  const p = process.env[envName] ?? path.join(process.env.STIPEND_KEYS_DIR ?? path.join(findRepoRoot(), "keys"), file);
  if (!fs.existsSync(p)) return null;
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));
}
export function backendKeys(): { manager: Keypair; staker: Keypair } | null {
  const manager = keyFrom("STIPEND_MANAGER_KEY", "manager.json"), staker = keyFrom("STIPEND_STAKER_KEY", "staker.json");
  return manager && staker ? { manager, staker } : null;
}
export function connection(): Connection { return makeConnection(process.env.RPC_URL); }

export class LaunchError extends Error { constructor(public status: number, message: string) { super(message); } }

// ---------- asset menu ----------
export interface LaunchAsset { mint: string; symbol: string; name: string; group: "stocks" | "metals" | "majors" | "other"; logo?: string; liquidityUsd?: number; ticker: string; taken?: string }

const CATEGORY: Record<string, string> = { stocks: "stock", metals: "metal", majors: "crypto", other: "crypto" };

async function tokensXyz(list: string): Promise<LaunchAsset[]> {
  const key = process.env.TOKENS_XYZ_KEY;
  if (!key) return [];
  const out: LaunchAsset[] = [];
  let offset = 0;
  for (let page = 0; page < 6; page++) {
    const r = await fetch(`https://tokens.xyz/api/v1/assets/curated?list=${list}&groupBy=asset&limit=100&offset=${offset}`, { headers: { "x-api-key": key }, next: { revalidate: 3600 } } as RequestInit);
    if (!r.ok) break;
    const j = (await r.json()) as { assets: { assetId: string; symbol: string; name: string; imageUrl?: string; advisories?: unknown[]; primaryVariant?: { mint: string; symbol: string; name: string; market?: { liquidity?: number; logoURI?: string } } }[]; pagination?: { hasMore?: boolean; nextOffset?: number } };
    for (const a of j.assets ?? []) {
      const v = a.primaryVariant; if (!v?.mint) continue;
      if ((a.advisories?.length ?? 0) > 0) continue;
      out.push({ mint: v.mint, symbol: v.symbol, name: v.name || a.name, group: list as LaunchAsset["group"], logo: v.market?.logoURI ?? a.imageUrl, liquidityUsd: v.market?.liquidity, ticker: a.symbol });
    }
    if (!j.pagination?.hasMore) break;
    offset = j.pagination.nextOffset ?? offset + 100;
  }
  return out;
}

export async function launchAssets(reg: Registry): Promise<LaunchAsset[]> {
  const pol = launchPolicy(reg);
  const lists = await Promise.all(pol.allowedLists.map((l) => tokensXyz(l).catch(() => [] as LaunchAsset[])));
  const seen = new Map<string, LaunchAsset>();
  for (const a of lists.flat()) if (!seen.has(a.mint)) seen.set(a.mint, a);
  // registry assets that are not on the curated lists still show (they were verified at sync time)
  for (const l of reg.lsts) if (!seen.has(l.asset.mint)) seen.set(l.asset.mint, { mint: l.asset.mint, symbol: l.asset.symbol, name: l.asset.name, group: "other", logo: l.asset.logo, ticker: l.asset.symbol.replace(/x$/i, "") });
  const taken = new Map(reg.lsts.filter((l) => l.stakePool).map((l) => [l.asset.mint, l.symbol]));
  return [...seen.values()].map((a) => ({ ...a, taken: taken.get(a.mint) }));
}

async function jupiterVerified(mint: string): Promise<{ symbol: string; name: string; icon?: string; liquidity?: number; verified: boolean } | null> {
  const r = await fetch(`https://lite-api.jup.ag/tokens/v2/search?query=${mint}`);
  if (!r.ok) return null;
  const j = (await r.json()) as { id: string; symbol: string; name: string; icon?: string; liquidity?: number; isVerified?: boolean; tags?: string[] }[];
  const t = j.find((x) => x.id === mint);
  return t ? { symbol: t.symbol, name: t.name, icon: t.icon, liquidity: t.liquidity, verified: !!(t.isVerified || t.tags?.includes("verified")) } : null;
}

// ---------- validation ----------
export async function validateLaunch(reg: Registry, input: { assetMint: string; symbol: string; creator: string }): Promise<{ asset: AssetInfo; name: string; symbol: string; creator: PublicKey; transferFeeBps: number }> {
  const pol = launchPolicy(reg);
  if (!pol.enabled) throw new LaunchError(503, "Launches are paused");
  let creator: PublicKey; try { creator = new PublicKey(input.creator); } catch { throw new LaunchError(400, "Bad creator wallet"); }
  const symbol = input.symbol.trim();
  if (!/^[a-z0-9]{2,8}SOL$/i.test(symbol)) throw new LaunchError(400, "Symbol must be 2-8 letters or digits followed by SOL, e.g. nvdaSOL");
  if (reg.lsts.some((l) => l.symbol.toLowerCase() === symbol.toLowerCase() && l.stakePool)) throw new LaunchError(409, `${symbol} already exists`);
  let mint: PublicKey; try { mint = new PublicKey(input.assetMint); } catch { throw new LaunchError(400, "Bad asset mint"); }
  const existing = reg.lsts.find((l) => l.asset.mint === mint.toBase58() && l.stakePool);
  if (existing) throw new LaunchError(409, `${existing.symbol} already pays this asset; one LST per asset`);
  const conn = connection();
  let info: Awaited<ReturnType<typeof fetchMintInfo>>;
  try { info = await fetchMintInfo(conn, mint); } catch { throw new LaunchError(400, "That address is not a token mint"); }
  if (info.hasTransferHook) {
    const hook = getTransferHook(info.mint);
    if (hook && hook.programId && !hook.programId.equals(PublicKey.default)) throw new LaunchError(400, "This token has an active transfer hook program. Not eligible.");
  }
  const transferFeeBps = Number(transferFeeFor(info, 10_000n, 0)); // bps-equivalent on 10k units
  if (reg.network !== "mainnet-beta") {
    // test networks: only registry draft assets (test mints created by ops) are launchable; no curated/Jupiter checks apply
    const draft = reg.lsts.find((l) => l.asset.mint === mint.toBase58() && !l.stakePool);
    if (!draft) throw new LaunchError(400, "On a test network only the pre-created test assets can be launched");
    return { asset: draft.asset, name: `${reg.brand.name} ${draft.asset.name} SOL`.slice(0, 32), symbol, creator, transferFeeBps };
  }
  // eligibility: curated list, else Jupiter verified with enough liquidity
  const curated = (await launchAssets(reg)).find((a) => a.mint === mint.toBase58() && a.group !== "other");
  // Issuer-controlled assets on the curated lists (xStocks, Backed, Ondo) carry a freeze authority by design; the worker skips
  // frozen recipient accounts and lets them accrue. Outside the curated lists a freeze authority is a rug lever: reject.
  if (info.mint.freezeAuthority && !curated) throw new LaunchError(400, "This token has a freeze authority and is not on a curated list. Not eligible.");
  let assetSymbol = curated?.symbol, assetName = curated?.name, logo = curated?.logo, category = curated ? CATEGORY[curated.group] : "crypto";
  if (!curated) {
    const jup = await jupiterVerified(mint.toBase58());
    if (!jup || !jup.verified) throw new LaunchError(400, "Token is not on the curated lists or Jupiter's verified list");
    if ((jup.liquidity ?? 0) < pol.minJupLiquidityUsd) throw new LaunchError(400, `Token liquidity is below $${pol.minJupLiquidityUsd.toLocaleString()}`);
    assetSymbol = jup.symbol; assetName = jup.name; logo = jup.icon;
  }
  const asset: AssetInfo = { symbol: assetSymbol!, name: assetName!, mint: mint.toBase58(), decimals: info.mint.decimals, tokenProgram: tokenProgramName(info.program), logo, category };
  const name = `${reg.brand.name} ${assetName} SOL`.slice(0, 32);
  return { asset, name, symbol, creator, transferFeeBps };
}

// ---------- launches state machine ----------
export interface LaunchRow { id: string; symbol: string; asset_mint: string; creator: string; pool: string; mint: string; validator_list: string; reserve: string; keys_json: string; params_json: string; step: number; status: string; signatures: string; created_at: number; updated_at: number }
interface StoredParams { name: string; symbol: string; uri: string; asset: AssetInfo; transferFeeBps: number; maxValidators: number; seedLamports: string; vanityPattern?: string }

function keysFromRow(row: LaunchRow) {
  const k = JSON.parse(row.keys_json) as Record<"mint" | "pool" | "validatorList" | "reserve", number[]>;
  return { mint: Keypair.fromSecretKey(Uint8Array.from(k.mint)), pool: Keypair.fromSecretKey(Uint8Array.from(k.pool)), validatorList: Keypair.fromSecretKey(Uint8Array.from(k.validatorList)), reserve: Keypair.fromSecretKey(Uint8Array.from(k.reserve)) };
}

async function takeMintKey(symbol: string): Promise<{ keypair: Keypair; pattern?: string }> {
  // vanity bank (packages/core/src/vanity.ts): a key whose address starts with the ticker (and/or ends with the brand suffix) when one is banked
  try {
    const ticker = symbol.replace(/SOL$/i, "");
    const hit = takeVanityKey({ ticker, usedFor: symbol });
    if (hit) return { keypair: hit.keypair, pattern: hit.pattern };
  } catch { /* no bank on this machine */ }
  return { keypair: Keypair.generate() };
}

export interface PreparedLaunch { id: string; steps: { step: string; label: string; needsUser: boolean }[]; addresses: Record<string, string>; costs: Record<string, string>; symbol: string; asset: AssetInfo; vanityPattern?: string }

export async function prepareLaunch(input: { assetMint: string; symbol: string; creator: string }): Promise<PreparedLaunch> {
  const keys = backendKeys(); if (!keys) throw new LaunchError(503, "Launch disabled: backend keys are not configured on this server");
  const reg = loadRegistry();
  const v = await validateLaunch(reg, input);
  const pol = launchPolicy(reg);
  const { keypair: mintKp, pattern } = await takeMintKey(v.symbol);
  const lk = { mint: mintKp, pool: Keypair.generate(), validatorList: Keypair.generate(), reserve: Keypair.generate() };
  const conn = connection();
  const params: StoredParams = { name: v.name, symbol: v.symbol, uri: `https://${reg.brand.domain}/meta/${v.symbol}.json`, asset: v.asset, transferFeeBps: v.transferFeeBps, maxValidators: pol.maxValidators, seedLamports: String(pol.seedLamports), vanityPattern: pattern };
  const built = await buildLaunchTransactions(conn, { addValidator: reg.network !== "devnet", createMetadata: reg.network !== "devnet", payer: v.creator, manager: keys.manager.publicKey, staker: keys.staker.publicKey, keys: lk, fees: reg.fees, maxValidators: pol.maxValidators, validatorVote: new PublicKey(reg.validator.voteAccount), name: v.name, symbol: v.symbol, uri: params.uri, seedLamports: BigInt(pol.seedLamports) });
  const db = openLaunchDb();
  const id = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`INSERT INTO launches (id, symbol, asset_mint, creator, pool, mint, validator_list, reserve, keys_json, params_json, step, status, signatures, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'pending', '[]', ?, ?)`)
    .run(id, v.symbol, v.asset.mint, v.creator.toBase58(), built.addresses.pool, built.addresses.mint, built.addresses.validatorList, built.addresses.reserve,
      JSON.stringify({ mint: Array.from(lk.mint.secretKey), pool: Array.from(lk.pool.secretKey), validatorList: Array.from(lk.validatorList.secretKey), reserve: Array.from(lk.reserve.secretKey) }), JSON.stringify(params), now, now);
  db.close();
  const costs = Object.fromEntries(Object.entries(built.costs).map(([k, val]) => [k, String(val)]));
  return { id, steps: built.txs.map((t) => ({ step: t.step, label: t.label, needsUser: true })), addresses: { ...built.addresses }, costs, symbol: v.symbol, asset: v.asset, vanityPattern: pattern };
}

function getRow(db: Db, id: string): LaunchRow {
  const row = db.prepare("SELECT * FROM launches WHERE id = ?").get(id) as LaunchRow | undefined;
  if (!row) throw new LaunchError(404, "Unknown launch");
  return row;
}

async function rebuild(row: LaunchRow, reg: Registry, keys: { manager: Keypair; staker: Keypair }): Promise<{ txs: LaunchTx[]; addresses: Record<string, string> }> {
  const p = JSON.parse(row.params_json) as StoredParams;
  const built = await buildLaunchTransactions(connection(), { addValidator: reg.network !== "devnet", createMetadata: reg.network !== "devnet", payer: new PublicKey(row.creator), manager: keys.manager.publicKey, staker: keys.staker.publicKey, keys: keysFromRow(row), fees: reg.fees, maxValidators: p.maxValidators, validatorVote: new PublicKey(reg.validator.voteAccount), name: p.name, symbol: p.symbol, uri: p.uri, seedLamports: BigInt(p.seedLamports) });
  return { txs: built.txs, addresses: { ...built.addresses } };
}

/** The current step's transaction, freshly blockhashed and signed by the backend; the user signs and submits. */
export async function currentStepTx(id: string): Promise<{ id: string; step: number; total: number; label: string; tx: string; lastValidBlockHeight: number; done: boolean; signatures: string[] }> {
  const keys = backendKeys(); if (!keys) throw new LaunchError(503, "Launch disabled");
  const db = openLaunchDb();
  try {
    const row = getRow(db, id);
    const sigs = JSON.parse(row.signatures) as string[];
    const reg = loadRegistry();
    const { txs } = await rebuild(row, reg, keys);
    if (row.step >= txs.length) return { id, step: row.step, total: txs.length, label: "Done", tx: "", lastValidBlockHeight: 0, done: true, signatures: sigs };
    const t = txs[row.step];
    const conn = connection();
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
    t.tx.recentBlockhash = blockhash;
    const signers = [...t.backendSigners, ...(t.needsManager ? [keys.manager] : []), ...(t.needsStaker ? [keys.staker] : [])];
    if (signers.length) t.tx.partialSign(...signers);
    return { id, step: row.step, total: txs.length, label: t.label, tx: serializePartial(t.tx), lastValidBlockHeight, done: false, signatures: sigs };
  } finally { db.close(); }
}

/** Send the user-signed transaction for the current step, confirm, advance. Idempotent: a step already on chain is skipped. */
/** Every remaining step, each with the same fresh blockhash and the backend signatures, so the wallet can sign them all in one prompt. */
export async function remainingStepsTx(id: string): Promise<{ id: string; step: number; total: number; done: boolean; signatures: string[]; lastValidBlockHeight: number; txs: { step: number; label: string; tx: string }[] }> {
  const keys = backendKeys(); if (!keys) throw new LaunchError(503, "Launch disabled");
  const db = openLaunchDb();
  try {
    const row = getRow(db, id);
    const sigs = JSON.parse(row.signatures) as string[];
    const reg = loadRegistry();
    const { txs } = await rebuild(row, reg, keys);
    if (row.step >= txs.length) return { id, step: row.step, total: txs.length, done: true, signatures: sigs, lastValidBlockHeight: 0, txs: [] };
    const { blockhash, lastValidBlockHeight } = await connection().getLatestBlockhash("confirmed");
    const out = txs.slice(row.step).map((t, i) => {
      t.tx.recentBlockhash = blockhash;
      const signers = [...t.backendSigners, ...(t.needsManager ? [keys.manager] : []), ...(t.needsStaker ? [keys.staker] : [])];
      if (signers.length) t.tx.partialSign(...signers);
      return { step: row.step + i, label: t.label, tx: serializePartial(t.tx) };
    });
    return { id, step: row.step, total: txs.length, done: false, signatures: sigs, lastValidBlockHeight, txs: out };
  } finally { db.close(); }
}

export async function submitStep(id: string, signedB64: string): Promise<{ step: number; total: number; signature: string; done: boolean; addresses?: Record<string, string>; signatures: string[] }> {
  const keys = backendKeys(); if (!keys) throw new LaunchError(503, "Launch disabled");
  const db = openLaunchDb();
  try {
    const row = getRow(db, id);
    const reg = loadRegistry();
    const { txs, addresses } = await rebuild(row, reg, keys);
    if (row.step >= txs.length) return { step: row.step, total: txs.length, signature: "", done: true, addresses, signatures: JSON.parse(row.signatures) };
    const conn = connection();
    const tx = Transaction.from(Buffer.from(signedB64, "base64"));
    // the wire tx must be exactly the step we expect (same instructions), signed by the creator
    const expected = txs[row.step];
    const same = tx.instructions.length === expected.tx.instructions.length && tx.instructions.every((ix, i) => ix.programId.equals(expected.tx.instructions[i].programId) && Buffer.compare(ix.data, expected.tx.instructions[i].data) === 0);
    if (!same) throw new LaunchError(400, "Transaction does not match the current launch step");
    if (!tx.feePayer?.equals(new PublicKey(row.creator))) throw new LaunchError(400, "Fee payer must be the creator wallet");
    let signature: string;
    try {
      signature = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
      const bh = await conn.getLatestBlockhash("confirmed");
      await conn.confirmTransaction({ signature, blockhash: tx.recentBlockhash!, lastValidBlockHeight: bh.lastValidBlockHeight }, "confirmed");
    } catch (e) {
      const msg = String((e as Error).message ?? e);
      if (/blockhash|expired|block height exceeded/i.test(msg)) throw new LaunchError(409, "That approval took too long and the transaction expired. Fetching a fresh one.");
      throw new LaunchError(502, `Transaction failed: ${msg.slice(0, 300)}`);
    }
    const sigs = [...(JSON.parse(row.signatures) as string[]), signature];
    const next = row.step + 1;
    const done = next >= txs.length;
    db.prepare("UPDATE launches SET step = ?, signatures = ?, status = ?, updated_at = ? WHERE id = ?").run(next, JSON.stringify(sigs), done ? "done" : "pending", Math.floor(Date.now() / 1000), id);
    if (done) await finalizeLaunch(row, reg, sigs);
    return { step: next, total: txs.length, signature, done, addresses: done ? addresses : undefined, signatures: sigs };
  } finally { db.close(); }
}

async function finalizeLaunch(row: LaunchRow, reg: Registry, sigs: string[]) {
  const p = JSON.parse(row.params_json) as StoredParams;
  const pol = launchPolicy(reg);
  const stats = await getPoolStats(connection(), { stakePool: row.pool });
  const entry: LstEntry = {
    symbol: p.symbol, name: p.name, blurb: `Hold ${p.symbol}, get paid ${p.asset.symbol} every epoch.`, asset: p.asset,
    stakePool: stats.address, mint: stats.mint, validatorList: stats.validatorList, reserve: stats.reserve, managerFeeAccount: stats.managerFeeAccount,
    createdEpoch: stats.currentEpoch, status: "live", delivery: "direct", creator: row.creator, creatorFeeBps: pol.creatorFeeBps, launchedAt: Math.floor(Date.now() / 1000), launchTx: sigs,
  };
  const fresh = loadRegistry();
  const i = fresh.lsts.findIndex((l) => l.symbol.toLowerCase() === p.symbol.toLowerCase());
  if (i >= 0) fresh.lsts[i] = { ...fresh.lsts[i], ...entry }; else fresh.lsts.push(entry);
  saveRegistry(fresh, registryPath());
}

export function launchStatus(id: string) {
  const db = openLaunchDb();
  try { const r = getRow(db, id); return { id: r.id, symbol: r.symbol, step: r.step, status: r.status, signatures: JSON.parse(r.signatures) as string[], pool: r.pool, mint: r.mint }; } finally { db.close(); }
}

export async function launchQuote(reg: Registry) {
  const pol = launchPolicy(reg);
  const c = await launchCosts(connection(), pol.maxValidators, BigInt(pol.seedLamports));
  return { enabled: pol.enabled && !!backendKeys(), creatorFeeBps: pol.creatorFeeBps, platformFeeBps: reg.fees.platformFeeBps, costs: Object.fromEntries(Object.entries(c).map(([k, v]) => [k, String(v)])) };
}
