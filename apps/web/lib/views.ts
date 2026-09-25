import { loadRegistry } from "./registry";
import { getPoolStats, serverConnection } from "./pool";
import { computeLstYield, getPrices, getValidatorYield } from "./yield";
import { openDb, getLstTotals, getSiteAggregates, getRealisedYield, getLatestTvl } from "./db";
import type { LstsResponse, LstView, SiteTotals } from "./types";

/** Jupiter (mainnet lite-api) prices the real asset. Test networks mirror a mainnet mint via asset.priceMint. */
const priceMintOf = (a: { mint: string; priceMint?: string }) => a.priceMint ?? a.mint;

let cache: { at: number; value: LstsResponse } | null = null;

export async function buildLstsResponse(): Promise<LstsResponse> {
  if (cache && Date.now() - cache.at < 60_000) return cache.value;
  const registry = loadRegistry();
  const connection = serverConnection();
  const db = openDb();
  const [validator, prices] = await Promise.all([getValidatorYield(registry), getPrices(registry.lsts.map((l) => priceMintOf(l.asset)))]);
  const lsts: LstView[] = await Promise.all(
    registry.lsts.map(async (entry) => {
      const totals = db ? (getLstTotals(db, entry.symbol) as (ReturnType<typeof getLstTotals> & { holdersLast?: number | null }) | null) : null;
      return {
        entry,
        stats: entry.status === "draft" ? null : await getPoolStats(connection, entry, totals?.holdersLast ?? null),
        yield: computeLstYield(validator, registry.fees.platformFeeBps, prices[priceMintOf(entry.asset)] ?? null, db ? getRealisedYield(db, entry.symbol, entry.asset.decimals) : null),
        totals: totals ? { epochsRun: totals.epochsRun, totalDistributed: totals.totalDistributed, totalRedeemedLamports: totals.totalRedeemedLamports, lastEpoch: totals.lastEpoch } : null,
      };
    }),
  );
  const agg = db ? getSiteAggregates(db) : { epochsProcessed: 0, paidByLst: {}, holdersByLst: {} };
  const latestTvl = db ? getLatestTvl(db) : [];
  db?.close();
  let paidOutUsd = 0;
  let anyPaid = false;
  for (const l of lsts) {
    const units = agg.paidByLst[l.entry.symbol];
    const price = prices[priceMintOf(l.entry.asset)];
    if (units && price) {
      paidOutUsd += (Number(BigInt(units)) / 10 ** l.entry.asset.decimals) * price;
      anyPaid = true;
    }
  }
  const holderCounts = lsts.map((l) => agg.holdersByLst[l.entry.symbol] ?? l.stats?.holders ?? null).filter((n): n is number => n != null);
  // Staked: the latest hourly sample when the worker has one, else live pool stats.
  const sampled = latestTvl.filter((t) => registry.lsts.some((l) => l.symbol === t.lst && l.status !== "draft"));
  const stakedLamports = sampled.length > 0 ? sampled.reduce((a, t) => a + BigInt(t.totalLamports), 0n) : lsts.reduce((a, l) => a + BigInt(l.stats?.totalLamports ?? 0), 0n);
  const totals: SiteTotals = {
    stakedLamports: stakedLamports.toString(),
    paidOutUsd: anyPaid ? paidOutUsd : null,
    holders: holderCounts.length ? holderCounts.reduce((a, b) => a + b, 0) : null,
    epochsProcessed: agg.epochsProcessed,
  };
  const value: LstsResponse = {
    brand: registry.brand,
    validator,
    platformFeeBps: registry.fees.platformFeeBps,
    fees: registry.fees,
    reserve: registry.reserve,
    programs: registry.programs,
    validatorVote: registry.validator.voteAccount,
    lsts,
    totals,
    generatedAt: Date.now(),
  };
  cache = { at: Date.now(), value };
  return value;
}
