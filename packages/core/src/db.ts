import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { findRepoRoot } from "./repo.js";

export type Db = Database.Database;

export function dbPath(path?: string): string {
  return path ?? process.env.STIPEND_DB ?? join(findRepoRoot(), "data", "stipend.db");
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS epochs (
  lst TEXT NOT NULL, epoch INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'running',
  started_at INTEGER NOT NULL, finished_at INTEGER,
  fee_tokens TEXT, redeemed_lamports TEXT, platform_fee_lamports TEXT, budget_lamports TEXT, carried_lamports TEXT,
  snapshot_id INTEGER, swap_id INTEGER, distribution_id INTEGER, notes TEXT,
  PRIMARY KEY (lst, epoch));
CREATE TABLE IF NOT EXISTS fee_redemptions (id INTEGER PRIMARY KEY, lst TEXT NOT NULL, epoch INTEGER NOT NULL, pool_tokens TEXT NOT NULL, lamports TEXT NOT NULL, signature TEXT, ts INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS snapshots (id INTEGER PRIMARY KEY, lst TEXT NOT NULL, epoch INTEGER NOT NULL, slot INTEGER NOT NULL, total TEXT NOT NULL, holders INTEGER NOT NULL, ts INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS snapshot_balances (snapshot_id INTEGER NOT NULL, owner TEXT NOT NULL, balance TEXT NOT NULL, PRIMARY KEY (snapshot_id, owner));
CREATE TABLE IF NOT EXISTS swaps (id INTEGER PRIMARY KEY, lst TEXT NOT NULL, epoch INTEGER NOT NULL, input_mint TEXT NOT NULL, output_mint TEXT NOT NULL, in_amount TEXT NOT NULL, out_amount TEXT NOT NULL, signature TEXT, ts INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS distributions (
  id INTEGER PRIMARY KEY, lst TEXT NOT NULL, epoch INTEGER NOT NULL, address TEXT NOT NULL UNIQUE, authority TEXT NOT NULL, seeds TEXT NOT NULL, mint TEXT NOT NULL,
  root TEXT NOT NULL, total_amount TEXT NOT NULL, leaves INTEGER NOT NULL, clawback_ts INTEGER NOT NULL, created_sig TEXT, closed_sig TEXT, status TEXT NOT NULL DEFAULT 'open', ts INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS leaves (distribution_id INTEGER NOT NULL, owner TEXT NOT NULL, amount TEXT NOT NULL, proof TEXT NOT NULL, claimed_before TEXT NOT NULL DEFAULT '0', PRIMARY KEY (distribution_id, owner));
CREATE INDEX IF NOT EXISTS leaves_owner ON leaves(owner);
CREATE TABLE IF NOT EXISTS ledger (lst TEXT NOT NULL, owner TEXT NOT NULL, owed TEXT NOT NULL DEFAULT '0', claimed TEXT NOT NULL DEFAULT '0', paid TEXT NOT NULL DEFAULT '0', updated_epoch INTEGER, PRIMARY KEY (lst, owner));
CREATE TABLE IF NOT EXISTS claims_seen (distribution_id INTEGER NOT NULL, owner TEXT NOT NULL, claimed_amount TEXT NOT NULL, seen_at INTEGER NOT NULL, PRIMARY KEY (distribution_id, owner));
CREATE TABLE IF NOT EXISTS payouts (id INTEGER PRIMARY KEY, lst TEXT NOT NULL, epoch INTEGER NOT NULL, owner TEXT NOT NULL, amount TEXT NOT NULL, signature TEXT, ts INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS payouts_owner ON payouts(owner);
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tvl_history (id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, lst TEXT NOT NULL, total_lamports TEXT NOT NULL, supply TEXT NOT NULL, holders INTEGER, sol_price_usd REAL);
CREATE INDEX IF NOT EXISTS tvl_history_lst_ts ON tvl_history(lst, ts);
`;

export function openDb(path?: string): Db {
  const p = dbPath(path);
  mkdirSync(dirname(p), { recursive: true });
  const db = new Database(p);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.exec(SCHEMA);
  return db;
}

export interface ClaimableRow {
  lstSymbol: string; assetSymbol: string; assetMint: string; assetDecimals: number; tokenProgram: "spl-token" | "token-2022";
  distribution: string; authority: string; seeds: string; mint: string; totalAmount: string; proof: number[][]; epoch: number; clawbackTs: number;
  /** filled by the API after checking the chain; undefined = unknown */
  claimedOnChain?: string;
}

/** Latest open distribution leaf per LST for a wallet. Needs the registry to fill asset fields, so callers pass a resolver. */
export function getClaimable(db: Db, wallet: string, lookup: (lst: string) => { assetSymbol: string; assetMint: string; assetDecimals: number; tokenProgram: "spl-token" | "token-2022" } | undefined): ClaimableRow[] {
  const rows = db.prepare(`
    SELECT d.lst, d.address, d.authority, d.seeds, d.mint, d.epoch, d.clawback_ts, l.amount, l.proof
    FROM leaves l JOIN distributions d ON d.id = l.distribution_id
    WHERE l.owner = ? AND d.status = 'open' ORDER BY d.epoch DESC`).all(wallet) as { lst: string; address: string; authority: string; seeds: string; mint: string; epoch: number; clawback_ts: number; amount: string; proof: string }[];
  const seen = new Set<string>();
  const out: ClaimableRow[] = [];
  for (const r of rows) {
    if (seen.has(r.lst)) continue; // only the newest open distribution per LST carries the cumulative delta
    seen.add(r.lst);
    const a = lookup(r.lst);
    if (!a) continue;
    out.push({ lstSymbol: r.lst, assetSymbol: a.assetSymbol, assetMint: a.assetMint, assetDecimals: a.assetDecimals, tokenProgram: a.tokenProgram, distribution: r.address, authority: r.authority, seeds: r.seeds, mint: r.mint, totalAmount: r.amount, proof: JSON.parse(r.proof), epoch: r.epoch, clawbackTs: r.clawback_ts });
  }
  return out;
}

/** Closed distributions where this wallet claimed (so a MerkleClaim PDA with rent likely exists). */
export function getClosedDistributionsWithClaims(db: Db, wallet: string): { lstSymbol: string; distribution: string; epoch: number; claimedAmount: string }[] {
  return (db.prepare(`
    SELECT d.lst AS lstSymbol, d.address AS distribution, d.epoch, c.claimed_amount AS claimedAmount
    FROM claims_seen c JOIN distributions d ON d.id = c.distribution_id
    WHERE c.owner = ? AND d.status = 'closed' AND CAST(c.claimed_amount AS INTEGER) > 0 ORDER BY d.epoch DESC`).all(wallet) as { lstSymbol: string; distribution: string; epoch: number; claimedAmount: string }[]);
}

export interface DistributionHistoryRow {
  epoch: number; status: string; distribution?: string; totalAmount?: string; leaves?: number; budgetLamports?: string; redeemedLamports?: string; platformFeeLamports?: string;
  swapOut?: string; swapIn?: string; swapSig?: string; snapshotHolders?: number; snapshotTotal?: string; startedAt: number; finishedAt?: number; notes?: string;
}

export function getDistributionHistory(db: Db, lstSymbol: string, limit = 30): DistributionHistoryRow[] {
  return (db.prepare(`
    SELECT e.epoch, e.status, e.started_at AS startedAt, e.finished_at AS finishedAt, e.notes, e.budget_lamports AS budgetLamports, e.redeemed_lamports AS redeemedLamports, e.platform_fee_lamports AS platformFeeLamports,
      d.address AS distribution, d.total_amount AS totalAmount, d.leaves, s.out_amount AS swapOut, s.in_amount AS swapIn, s.signature AS swapSig, n.holders AS snapshotHolders, n.total AS snapshotTotal
    FROM epochs e LEFT JOIN distributions d ON d.id = e.distribution_id LEFT JOIN swaps s ON s.id = e.swap_id LEFT JOIN snapshots n ON n.id = e.snapshot_id
    WHERE e.lst = ? ORDER BY e.epoch DESC LIMIT ?`).all(lstSymbol, limit) as DistributionHistoryRow[]);
}

export function getLedger(db: Db, lstSymbol: string, wallet: string): { owed: string; claimed: string; paid: string; updatedEpoch: number | null } | undefined {
  return db.prepare(`SELECT owed, claimed, paid, updated_epoch AS updatedEpoch FROM ledger WHERE lst = ? AND owner = ?`).get(lstSymbol, wallet) as { owed: string; claimed: string; paid: string; updatedEpoch: number | null } | undefined;
}

export function getPayouts(db: Db, wallet: string, limit = 50): { lstSymbol: string; epoch: number; amount: string; signature: string | null; ts: number }[] {
  return db.prepare(`SELECT lst AS lstSymbol, epoch, amount, signature, ts FROM payouts WHERE owner = ? ORDER BY ts DESC LIMIT ?`).all(wallet, limit) as { lstSymbol: string; epoch: number; amount: string; signature: string | null; ts: number }[];
}

/** Aggregate stats per LST for the site. */
export function getLstTotals(db: Db, lstSymbol: string): { epochsRun: number; totalDistributed: string; totalRedeemedLamports: string; lastEpoch: number | null; holdersLast: number | null } {
  const r = db.prepare(`
    SELECT COUNT(*) AS epochsRun, MAX(e.epoch) AS lastEpoch,
      COALESCE((SELECT SUM(CAST(out_amount AS INTEGER)) FROM swaps WHERE lst = e.lst), 0) AS totalDistributed,
      COALESCE(SUM(CAST(e.redeemed_lamports AS INTEGER)), 0) AS totalRedeemedLamports,
      (SELECT holders FROM snapshots WHERE lst = e.lst ORDER BY epoch DESC LIMIT 1) AS holdersLast
    FROM epochs e WHERE e.lst = ? AND e.status = 'done'`).get(lstSymbol) as { epochsRun: number; lastEpoch: number | null; totalDistributed: number; totalRedeemedLamports: number; holdersLast: number | null };
  return { epochsRun: r.epochsRun, totalDistributed: String(r.totalDistributed), totalRedeemedLamports: String(r.totalRedeemedLamports), lastEpoch: r.lastEpoch, holdersLast: r.holdersLast };
}

/** One TVL sample per LST. Written hourly by the ops cron and after each epoch run. */
export interface TvlSample { ts: number; lst: string; totalLamports: string; supply: string; holders: number | null; solPriceUsd: number | null }

export function recordTvl(db: Db, s: TvlSample): void {
  db.prepare(`INSERT INTO tvl_history (ts, lst, total_lamports, supply, holders, sol_price_usd) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(s.ts, s.lst, s.totalLamports, s.supply, s.holders, s.solPriceUsd);
}

/** Samples ascending by time. `since` is a unix timestamp; omit for everything. */
export function getTvlHistory(db: Db, lst?: string, since?: number): TvlSample[] {
  const rows = (lst
    ? db.prepare(`SELECT ts, lst, total_lamports AS totalLamports, supply, holders, sol_price_usd AS solPriceUsd FROM tvl_history WHERE lst = ? AND ts >= ? ORDER BY ts`).all(lst, since ?? 0)
    : db.prepare(`SELECT ts, lst, total_lamports AS totalLamports, supply, holders, sol_price_usd AS solPriceUsd FROM tvl_history WHERE ts >= ? ORDER BY ts`).all(since ?? 0)) as TvlSample[];
  return rows;
}

/** Latest sample per LST. */
export function getLatestTvl(db: Db): TvlSample[] {
  return db.prepare(`SELECT ts, lst, total_lamports AS totalLamports, supply, holders, sol_price_usd AS solPriceUsd FROM tvl_history t WHERE ts = (SELECT MAX(ts) FROM tvl_history WHERE lst = t.lst)`).all() as TvlSample[];
}

/**
 * Realised yield for an LST over a trailing window, from what was actually bought and who held the token:
 * for each finished epoch in the window, asset bought ÷ LST snapshotted = asset per LST that epoch; the sum over the
 * window is annualised per epoch (average per paid epoch × epochs per year), which stays sane when only one or two epochs
 * have paid; `days` reports how much of the window is covered. Null until at least one epoch has paid.
 */
export function getRealisedYield(db: Db, lstSymbol: string, windowDays = 30, now = Math.floor(Date.now() / 1000), epochsPerYear = 146): { assetPer100SolYear: number; assetPer100SolWindow: number; days: number; epochs: number; since: number } | null {
  const since = now - windowDays * 86_400;
  const rows = db.prepare(`
    SELECT e.epoch, e.started_at AS startedAt, e.finished_at AS finishedAt, s.out_amount AS outAmount, n.total AS snapTotal
    FROM epochs e JOIN swaps s ON s.id = e.swap_id JOIN snapshots n ON n.id = e.snapshot_id
    WHERE e.lst = ? AND e.status = 'done' AND e.started_at >= ? ORDER BY e.epoch`).all(lstSymbol, since) as { epoch: number; startedAt: number; finishedAt: number | null; outAmount: string; snapTotal: string }[];
  if (rows.length === 0) return null;
  let perLamport = 0; // asset base units per lamport of LST, summed over the window
  for (const r of rows) {
    const total = Number(BigInt(r.snapTotal));
    if (total <= 0) continue;
    perLamport += Number(BigInt(r.outAmount)) / total;
  }
  // The window covered: from the first epoch's start (or the window start, whichever is later) to now; never under one day.
  const first = Math.max(rows[0].startedAt, since);
  const days = Math.max(1, (now - first) / 86_400);
  const per100SolWindow = perLamport * 100 * 1e9; // base units of asset per 100 SOL over the window
  const paidEpochs = rows.filter((r) => Number(BigInt(r.snapTotal)) > 0).length || 1;
  return { assetPer100SolYear: (per100SolWindow / paidEpochs) * epochsPerYear, assetPer100SolWindow: per100SolWindow, days, epochs: rows.length, since };
}
