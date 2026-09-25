// Browser-side twin of core's projectYield (packages/core/src/yield.ts) so the calculator updates without a round trip.
// Keep the two in step: same taper rule, same per-epoch compounding, principal never compounds.
import type { ValidatorYield, ProjectionRow } from "./types";

export function apyFromApr(apr: number, epochsPerYear: number): number {
  return Math.pow(1 + apr / epochsPerYear, epochsPerYear) - 1;
}

export function projectYieldClient(v: ValidatorYield, platformFeeBps: number, opts: { solAmount: number; years: number; assetPriceUsd: number; solPriceUsd?: number; participation?: number }): ProjectionRow[] {
  const fee = platformFeeBps / 10_000;
  const solPrice = opts.solPriceUsd ?? v.solPriceUsd;
  const participation = opts.participation ?? v.participation;
  const rows: ProjectionRow[] = [];
  let cumUnits = 0;
  let cumUsd = 0;
  for (let y = 0; y < opts.years; y++) {
    const inflationRate = Math.max(v.terminal, v.inflationRate * Math.pow(1 - v.taper, y));
    const apr = (inflationRate * (1 - v.commission)) / participation;
    const gross = apyFromApr(apr, v.epochsPerYear) * 100 + v.mevApy;
    const net = gross * (1 - fee);
    const solYield = opts.solAmount * (net / 100);
    const usd = solYield * solPrice;
    const units = opts.assetPriceUsd > 0 ? usd / opts.assetPriceUsd : 0;
    cumUnits += units;
    cumUsd += usd;
    rows.push({ year: y + 1, inflationRate, netApyPct: net, solYield, assetUnits: units, usd, cumulativeAssetUnits: cumUnits, cumulativeUsd: cumUsd });
  }
  return rows;
}
