import { loadRegistry } from "./registry";
import { openDb, getLatestTvl, getTvlHistory } from "./db";
import { getPoolStats, serverConnection } from "./pool";
import { getValidatorYield } from "./yield";
import type { TvlPoint, TvlResponse } from "./types";

let cache: { at: number; value: TvlResponse } | null = null;

/** Current TVL per asset and in total: the worker's latest hourly sample when it exists, otherwise live pool stats. */
export async function buildTvlResponse(): Promise<TvlResponse> {
  if (cache && Date.now() - cache.at < 60_000) return cache.value;
  const registry = loadRegistry();
  const live = registry.lsts.filter((l) => l.status !== "draft" && l.stakePool);
  const db = openDb();
  const latest = db ? getLatestTvl(db) : [];
  db?.close();
  const solPrice = (await getValidatorYield(registry)).solPriceUsd || null;
  const byAsset: TvlResponse["byAsset"] = [];
  let updatedAt: number | null = null;
  let source: TvlResponse["source"] = "history";
  const connection = serverConnection();
  for (const l of live) {
    const sample = latest.find((t) => t.lst === l.symbol);
    let lamports = sample ? BigInt(sample.totalLamports) : 0n;
    if (sample) updatedAt = Math.max(updatedAt ?? 0, sample.ts);
    else {
      source = "live";
      const s = await getPoolStats(connection, l, null);
      lamports = BigInt(s?.totalLamports ?? 0);
    }
    const sol = Number(lamports) / 1e9;
    byAsset.push({ symbol: l.symbol, assetSymbol: l.asset.symbol, sol, usd: solPrice ? sol * solPrice : null });
  }
  const totalSol = byAsset.reduce((a, b) => a + b.sol, 0);
  const value: TvlResponse = { totalSol, totalUsd: solPrice ? totalSol * solPrice : null, byAsset, updatedAt, source };
  cache = { at: Date.now(), value };
  return value;
}

export interface TvlSeries { symbol: string; points: { ts: number; sol: number }[] }

/** Per-LST series plus a summed total, for the chart. Samples are hourly; days limits the window. */
export function tvlSeries(points: TvlPoint[], symbols: string[]): { total: { ts: number; sol: number }[]; per: TvlSeries[] } {
  const per: TvlSeries[] = symbols.map((s) => ({ symbol: s, points: points.filter((p) => p.lst === s).map((p) => ({ ts: p.ts, sol: Number(BigInt(p.totalLamports)) / 1e9 })) }));
  // Total at each sample time: the latest known value of every LST at that moment.
  const times = Array.from(new Set(points.map((p) => p.ts))).sort((a, b) => a - b);
  const last = new Map<string, number>();
  const idx = new Map(per.map((s) => [s.symbol, 0]));
  const total = times.map((ts) => {
    for (const s of per) {
      let i = idx.get(s.symbol)!;
      while (i < s.points.length && s.points[i].ts <= ts) {
        last.set(s.symbol, s.points[i].sol);
        i++;
      }
      idx.set(s.symbol, i);
    }
    return { ts, sol: Array.from(last.values()).reduce((a, b) => a + b, 0) };
  });
  return { total, per };
}

export function loadTvlHistory(since: number): TvlPoint[] {
  const db = openDb();
  if (!db) return [];
  const rows = getTvlHistory(db, undefined, since);
  db.close();
  return rows;
}
