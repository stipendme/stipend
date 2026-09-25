import fs from "node:fs";
import path from "node:path";
import {
  openDb as coreOpenDb,
  dbPath as coreDbPath,
  getClaimable as coreGetClaimable,
  getClosedDistributionsWithClaims as coreGetClosed,
  getDistributionHistory as coreGetHistory,
  getLedger as coreGetLedger,
  getPayouts as coreGetPayouts,
  getLstTotals as coreGetLstTotals,
  getRealisedYield as coreGetRealisedYield,
  getTvlHistory as coreGetTvlHistory,
  getLatestTvl as coreGetLatestTvl,
  type Db,
} from "@stipend/core";
import type { ClaimableRow, ClosedClaimRow, DistributionRow, EpochRun, LedgerRow, LstTotals, PayoutRow, Registry, StatsEpochRow, StatsLstRow, TvlPoint } from "./types";

export type { Db };

/** DB_PATH (web) overrides STIPEND_DB (core) which defaults to <repo>/data/stipend.db. */
export function dbPath(): string {
  const env = process.env.DB_PATH?.trim();
  return coreDbPath(env ? path.resolve(process.cwd(), env) : undefined);
}

/** Opens the worker's database read-only-ish; returns null when the worker has never run (no file). */
export function openDb(): Db | null {
  const p = dbPath();
  if (!fs.existsSync(p)) return null;
  try {
    return coreOpenDb(p);
  } catch {
    return null;
  }
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/** MerkleClaim PDA is 18 bytes: (128 + 18) * 6960 lamports. */
export const CLAIM_RENT_LAMPORTS = "1016160";

export function getClaimable(db: Db, registry: Registry, wallet: string): ClaimableRow[] {
  return safe(
    () =>
      coreGetClaimable(db, wallet, (sym) => {
        const l = registry.lsts.find((x) => x.symbol === sym);
        return l ? { assetSymbol: l.asset.symbol, assetMint: l.asset.mint, assetDecimals: l.asset.decimals, tokenProgram: l.asset.tokenProgram } : undefined;
      }).map(({ clawbackTs: _c, claimedOnChain: _o, ...row }) => row),
    [],
  );
}

export function getClosedDistributionsWithClaims(db: Db, wallet: string): ClosedClaimRow[] {
  return safe(() => coreGetClosed(db, wallet).map((r) => ({ lstSymbol: r.lstSymbol, distribution: r.distribution, epoch: r.epoch, rentLamports: CLAIM_RENT_LAMPORTS })), []);
}

export function getDistributionHistory(db: Db, lstSymbol: string, limit = 30): DistributionRow[] {
  return safe(
    () =>
      coreGetHistory(db, lstSymbol, limit).map((r) => ({
        epoch: r.epoch,
        status: r.status,
        distribution: r.distribution ?? null,
        startedAt: r.startedAt,
        finishedAt: r.finishedAt ?? null,
        solRedeemed: r.redeemedLamports ?? "0",
        platformFee: r.platformFeeLamports ?? "0",
        swappedIn: r.swapIn ?? "0",
        assetOut: r.swapOut ?? "0",
        swapSig: r.swapSig ?? null,
        holders: r.snapshotHolders ?? null,
        totalAmount: r.totalAmount ?? null,
        notes: r.notes ?? null,
      })),
    [],
  );
}

export function getLedger(db: Db, registry: Registry, wallet: string): LedgerRow[] {
  return registry.lsts.flatMap((l) => {
    const r = safe(() => coreGetLedger(db, l.symbol, wallet), undefined);
    return r ? [{ lstSymbol: l.symbol, owed: r.owed, claimed: r.claimed, paid: r.paid }] : [];
  });
}

export function getPayouts(db: Db, wallet: string, limit = 50): PayoutRow[] {
  return safe(() => coreGetPayouts(db, wallet, limit), []);
}

export function getLstTotals(db: Db, lstSymbol: string): LstTotals | null {
  return safe(() => {
    const t = coreGetLstTotals(db, lstSymbol);
    return { epochsRun: t.epochsRun, totalDistributed: t.totalDistributed, totalRedeemedLamports: t.totalRedeemedLamports, lastEpoch: t.lastEpoch, holdersLast: t.holdersLast } as LstTotals & { holdersLast: number | null };
  }, null);
}

export function getRecentEpochRuns(db: Db, limit = 20): EpochRun[] {
  return safe(() => {
    const rows = db
      .prepare(`SELECT epoch, lst, started_at, finished_at, status, notes FROM epochs ORDER BY started_at DESC LIMIT ?`)
      .all(limit) as Array<Record<string, string | number | null>>;
    return rows.map((r) => ({
      epoch: Number(r.epoch),
      lstSymbol: String(r.lst),
      startedAt: Number(r.started_at),
      finishedAt: r.finished_at == null ? null : Number(r.finished_at),
      status: String(r.status),
      notes: r.notes == null ? null : String(r.notes),
    }));
  }, []);
}

/** Site-wide numbers for the callouts and /stats. Amounts are asset base units per LST; the caller prices them. */
export function getSiteAggregates(db: Db): { epochsProcessed: number; paidByLst: Record<string, string>; holdersByLst: Record<string, number> } {
  return safe(() => {
    const epochsProcessed = (db.prepare(`SELECT COUNT(*) AS n FROM epochs WHERE status = 'done'`).get() as { n: number }).n;
    const paid = db.prepare(`SELECT lst, SUM(CAST(amount AS INTEGER)) AS total FROM payouts GROUP BY lst`).all() as { lst: string; total: number }[];
    const holders = db.prepare(`SELECT lst, holders FROM snapshots s WHERE epoch = (SELECT MAX(epoch) FROM snapshots WHERE lst = s.lst)`).all() as { lst: string; holders: number }[];
    return {
      epochsProcessed,
      paidByLst: Object.fromEntries(paid.map((r) => [r.lst, String(r.total ?? 0)])),
      holdersByLst: Object.fromEntries(holders.map((r) => [r.lst, r.holders])),
    };
  }, { epochsProcessed: 0, paidByLst: {}, holdersByLst: {} });
}

/** Every processed epoch across all LSTs, newest first, with payout counts. */
export function getStatsEpochRows(db: Db, registry: Registry, limit = 200): StatsEpochRow[] {
  return safe(() => {
    const rows = db
      .prepare(
        `SELECT e.lst, e.epoch, e.status, e.started_at AS startedAt, e.finished_at AS finishedAt, e.notes,
           e.redeemed_lamports AS redeemedLamports, e.platform_fee_lamports AS platformFeeLamports,
           s.in_amount AS swapIn, s.out_amount AS swapOut, s.signature AS swapSig, n.holders AS snapshotHolders, d.address AS distribution, d.total_amount AS totalAmount,
           (SELECT COUNT(DISTINCT owner) FROM payouts p WHERE p.lst = e.lst AND p.epoch = e.epoch) AS holdersPaid,
           (SELECT COUNT(DISTINCT signature) FROM payouts p WHERE p.lst = e.lst AND p.epoch = e.epoch) AS payoutTxs
         FROM epochs e LEFT JOIN swaps s ON s.id = e.swap_id LEFT JOIN snapshots n ON n.id = e.snapshot_id LEFT JOIN distributions d ON d.id = e.distribution_id
         ORDER BY e.epoch DESC, e.lst LIMIT ?`,
      )
      .all(limit) as Array<Record<string, string | number | null>>;
    return rows.flatMap((r) => {
      const lst = registry.lsts.find((l) => l.symbol === r.lst);
      if (!lst) return [];
      return [
        {
          lstSymbol: lst.symbol,
          assetSymbol: lst.asset.symbol,
          assetDecimals: lst.asset.decimals,
          epoch: Number(r.epoch),
          status: String(r.status),
          distribution: r.distribution == null ? null : String(r.distribution),
          startedAt: Number(r.startedAt),
          finishedAt: r.finishedAt == null ? null : Number(r.finishedAt),
          solRedeemed: String(r.redeemedLamports ?? "0"),
          platformFee: String(r.platformFeeLamports ?? "0"),
          swappedIn: String(r.swapIn ?? "0"),
          assetOut: String(r.swapOut ?? "0"),
          swapSig: r.swapSig == null ? null : String(r.swapSig),
          holders: r.snapshotHolders == null ? null : Number(r.snapshotHolders),
          totalAmount: r.totalAmount == null ? null : String(r.totalAmount),
          notes: r.notes == null ? null : String(r.notes),
          holdersPaid: Number(r.holdersPaid ?? 0),
          payoutTxs: Number(r.payoutTxs ?? 0),
        },
      ];
    });
  }, []);
}

export function getStatsLstRows(db: Db, registry: Registry): StatsLstRow[] {
  return registry.lsts.flatMap((l) => {
    const t = safe(() => coreGetLstTotals(db, l.symbol), null);
    if (!t) return [];
    return [{ lstSymbol: l.symbol, assetSymbol: l.asset.symbol, assetDecimals: l.asset.decimals, epochsRun: t.epochsRun, totalRedeemedLamports: t.totalRedeemedLamports, totalDistributed: t.totalDistributed, holdersLast: t.holdersLast, lastEpoch: t.lastEpoch }];
  });
}

/** Trailing 30-day realised payouts per 100 SOL, annualised, in asset units (not base units). Null until an epoch has paid. */
export function getRealisedYield(db: Db, lstSymbol: string, assetDecimals: number, windowDays = 30): { assetPer100SolYear: number; days: number; epochs: number } | null {
  return safe(() => {
    const r = coreGetRealisedYield(db, lstSymbol, windowDays);
    return r ? { assetPer100SolYear: r.assetPer100SolYear / 10 ** assetDecimals, days: r.days, epochs: r.epochs } : null;
  }, null);
}

export function getTvlHistory(db: Db, lst?: string, since?: number): TvlPoint[] {
  return safe(() => coreGetTvlHistory(db, lst, since), []);
}

export function getLatestTvl(db: Db): TvlPoint[] {
  return safe(() => coreGetLatestTvl(db), []);
}
