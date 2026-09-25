/**
 * Vanity mint keypair bank. Keys are ground ahead of time (tools/vanity, `ops vanity grind`) and consumed once at
 * LST creation. A mint keypair signs only the mint's create-account/initialize; after Initialize the mint authority is
 * the stake pool's withdraw authority PDA, so a used key is worthless. Files: <dir>/<pattern>-<pubkey>.json (solana
 * byte-array format) and <dir>/index.json.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { Keypair } from "@solana/web3.js";
import { findRepoRoot } from "./repo.js";

export type VanityKind = "both" | "prefix" | "suffix";

export interface VanityEntry {
  pubkey: string;
  /** e.g. "NVDA...stip" */
  pattern: string;
  prefix: string;
  suffix: string;
  /** ticker the prefix was ground for; "" for suffix-only reserve keys */
  ticker: string;
  kind: VanityKind;
  file: string;
  groundAt: string;
  used: boolean;
  usedAt?: string;
  usedFor?: string;
}

export interface VanityIndex { entries: VanityEntry[] }

export function vanityDir(): string {
  return process.env.STIPEND_VANITY_DIR ?? join(findRepoRoot(), "keys", "vanity");
}

export function readVanityIndex(dir = vanityDir()): VanityIndex {
  const p = join(dir, "index.json");
  if (!existsSync(p)) return { entries: [] };
  return JSON.parse(readFileSync(p, "utf8")) as VanityIndex;
}

/** Atomic write: temp file + rename. */
export function writeVanityIndex(idx: VanityIndex, dir = vanityDir()): void {
  mkdirSync(dir, { recursive: true });
  const p = join(dir, "index.json");
  const tmp = `${p}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(idx, null, 1) + "\n");
  renameSync(tmp, p);
}

const RANK: Record<VanityKind, number> = { both: 0, prefix: 1, suffix: 2 };

function matchesTicker(e: VanityEntry, ticker?: string): boolean {
  if (!ticker) return e.kind === "suffix";
  return e.ticker.toLowerCase() === ticker.toLowerCase();
}

/** Best available unused key for a ticker: both > prefix > suffix-only reserve. Marks it used. */
export function takeVanityKey(opts: { ticker?: string; preferBoth?: boolean; usedFor?: string; dryRun?: boolean } = {}): { keypair: Keypair; pattern: string; entry: VanityEntry } | null {
  const dir = vanityDir();
  const idx = readVanityIndex(dir);
  const candidates = idx.entries.filter((e) => !e.used && (matchesTicker(e, opts.ticker) || e.kind === "suffix"));
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const at = matchesTicker(a, opts.ticker) ? 0 : 1, bt = matchesTicker(b, opts.ticker) ? 0 : 1;
    if (at !== bt) return at - bt;
    return RANK[a.kind] - RANK[b.kind];
  });
  const entry = candidates[0];
  if (opts.preferBoth === true && entry.kind !== "both") return null;
  const file = join(dir, entry.file);
  if (!existsSync(file)) throw new Error(`vanity key file missing: ${file}`);
  const keypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(file, "utf8")) as number[]));
  if (keypair.publicKey.toBase58() !== entry.pubkey) throw new Error(`vanity index mismatch for ${entry.file}`);
  if (!opts.dryRun) {
    entry.used = true; entry.usedAt = new Date().toISOString(); entry.usedFor = opts.usedFor;
    writeVanityIndex(idx, dir);
  }
  return { keypair, pattern: entry.pattern, entry };
}

export function listVanityBank(): { entries: VanityEntry[]; summary: Record<VanityKind, { free: number; used: number }> } {
  const idx = readVanityIndex();
  const summary: Record<VanityKind, { free: number; used: number }> = { both: { free: 0, used: 0 }, prefix: { free: 0, used: 0 }, suffix: { free: 0, used: 0 } };
  for (const e of idx.entries) summary[e.kind][e.used ? "used" : "free"]++;
  return { entries: idx.entries, summary };
}

/** Add a ground key to the bank (never overwrites an existing pubkey). Returns false if already present. */
export function addVanityKey(secret: number[], meta: Omit<VanityEntry, "pubkey" | "file" | "used" | "groundAt">, dir = vanityDir()): VanityEntry | null {
  const kp = Keypair.fromSecretKey(Uint8Array.from(secret));
  const pubkey = kp.publicKey.toBase58();
  const idx = readVanityIndex(dir);
  if (idx.entries.some((e) => e.pubkey === pubkey)) return null;
  const file = `${meta.pattern.replace(/[^A-Za-z0-9._-]/g, "_")}-${pubkey}.json`;
  mkdirSync(dir, { recursive: true });
  const p = join(dir, file);
  if (existsSync(p)) return null;
  writeFileSync(p, JSON.stringify(Array.from(secret)), { mode: 0o600 });
  const entry: VanityEntry = { ...meta, pubkey, file, used: false, groundAt: new Date().toISOString() };
  idx.entries.push(entry);
  writeVanityIndex(idx, dir);
  return entry;
}
