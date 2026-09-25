import type { Registry } from "./registry.js";

/**
 * Validator yield, built from first principles rather than a third-party APY estimate:
 *  - inflation rate: live from RPC getInflationRate (the Compass profile's "current" lags; on 2026-09-13 RPC said 3.65%, the profile 4.5%)
 *  - staking participation, MEV APY, commission, SOL price, epochs/year: Compass staking-calculator profile
 *  gross APR = inflation × (1 − commission) / participation; APY compounds per epoch; MEV is added on top.
 */
export interface ValidatorYield {
  /** live inflation rate, fraction (0.0365) */
  inflationRate: number;
  /** governor: initial rate (0.08), the yearly reduction as a fraction of the rate (0.15), terminal rate (0.015) */
  initial: number;
  taper: number;
  terminal: number;
  participation: number;
  commission: number;
  /** percent */
  inflationApy: number;
  mevApy: number;
  totalApy: number;
  solPrice: number;
  epochsPerYear: number;
  source: string;
}

interface Profile {
  validator?: { commission?: number; mev_apy?: number };
  sol_price?: number;
  epochs_per_year?: number;
  inflation?: { current?: number; taper?: number; terminal?: number };
  staking_participation?: { rate?: number };
}

async function rpcCall<T>(rpcUrl: string, method: string): Promise<T | null> {
  try {
    const r = await fetch(rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method }) });
    const j = (await r.json()) as { result?: T };
    return j.result ?? null;
  } catch { return null; }
}

export interface Inflation {
  /** current validator inflation rate, fraction */
  rate: number;
  initial: number;
  /** yearly reduction as a fraction of the current rate (0.15 = the rate is multiplied by 0.85 each year) */
  taper: number;
  terminal: number;
  epoch: number | null;
  source: "rpc" | "fallback";
}

let inflationCache: { at: number; value: Inflation } | null = null;

/** Live inflation from getInflationGovernor + getInflationRate, cached 10 minutes. */
export async function getInflation(rpcUrl = process.env.RPC_URL ?? "https://api.mainnet-beta.solana.com"): Promise<Inflation> {
  if (inflationCache && Date.now() - inflationCache.at < 10 * 60_000) return inflationCache.value;
  const [gov, rate] = await Promise.all([
    rpcCall<{ initial: number; taper: number; terminal: number }>(rpcUrl, "getInflationGovernor"),
    rpcCall<{ validator?: number; total?: number; epoch?: number }>(rpcUrl, "getInflationRate"),
  ]);
  const v = rate?.validator ?? rate?.total;
  const value: Inflation = {
    rate: typeof v === "number" && v > 0 ? v : 0.0365,
    initial: gov?.initial ?? 0.08, taper: gov?.taper ?? 0.15, terminal: gov?.terminal ?? 0.015,
    epoch: rate?.epoch ?? null,
    source: gov && typeof v === "number" ? "rpc" : "fallback",
  };
  inflationCache = { at: Date.now(), value };
  return value;
}

/** The scheduled path of the inflation rate: rate × (1 − taper)^year, floored at terminal. Year 0 = now. */
export function taperSeries(inf: Pick<Inflation, "rate" | "taper" | "terminal">, years: number): number[] {
  return Array.from({ length: years + 1 }, (_, y) => Math.max(inf.terminal, inf.rate * Math.pow(1 - inf.taper, y)));
}

export function apyFromApr(apr: number, epochsPerYear: number): number {
  return Math.pow(1 + apr / epochsPerYear, epochsPerYear) - 1;
}

export async function getValidatorYield(reg: Registry, rpcUrl = process.env.RPC_URL ?? "https://api.mainnet-beta.solana.com"): Promise<ValidatorYield> {
  const r = await fetch(reg.validator.yieldApi, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`yield api ${r.status}`);
  const j = (await r.json()) as Profile;
  const participation = Number(j.staking_participation?.rate ?? 0.74);
  const commission = Number(j.validator?.commission ?? 0) / 100;
  const epochsPerYear = Number(j.epochs_per_year ?? 146);
  const inf = await getInflation(rpcUrl);
  const live = inf.source === "rpc" ? inf.rate : null;
  const inflationRate = live ?? Number(j.inflation?.current ?? 0.0365);
  const apr = (inflationRate * (1 - commission)) / participation;
  const inflationApy = apyFromApr(apr, epochsPerYear) * 100;
  const mevApy = Number(j.validator?.mev_apy ?? 0);
  return {
    inflationRate, initial: inf.initial, taper: inf.source === "rpc" ? inf.taper : Number(j.inflation?.taper ?? 0.15), terminal: inf.source === "rpc" ? inf.terminal : Number(j.inflation?.terminal ?? 0.015), participation, commission,
    inflationApy, mevApy, totalApy: inflationApy + mevApy,
    solPrice: Number(j.sol_price ?? 0), epochsPerYear, source: live ? "rpc getInflationRate + solanacompass" : "solanacompass",
  };
}

export interface LstYield {
  /** net APY in SOL terms after the platform fee, percent. This is the only yield number the site shows. */
  netApyPct: number;
  grossApyPct: number;
  platformFeePct: number;
  assetPer100SolPerYear: number;
  assetPer100SolPerEpoch: number;
  usdPer100SolPerYear: number;
  epochsPerYear: number;
}

export function computeLstYield(v: ValidatorYield, platformFeeBps: number, assetPriceUsd: number): LstYield {
  const fee = platformFeeBps / 10_000;
  const net = v.totalApy * (1 - fee);
  const usdPerYear = (net / 100) * 100 * v.solPrice;
  const perYear = assetPriceUsd > 0 ? usdPerYear / assetPriceUsd : 0;
  return { netApyPct: net, grossApyPct: v.totalApy, platformFeePct: fee * 100, assetPer100SolPerYear: perYear, assetPer100SolPerEpoch: perYear / v.epochsPerYear, usdPer100SolPerYear: usdPerYear, epochsPerYear: v.epochsPerYear };
}

/** One row per year of a projection: the inflation rate is reduced by `taper` of itself each year (3.65% → 3.10% → 2.64% …) towards the terminal rate; prices held at the inputs. */
export interface ProjectionYear { year: number; inflationRate: number; netApyPct: number; solYield: number; assetUnits: number; usd: number; cumulativeAssetUnits: number; cumulativeUsd: number }

export function projectYield(v: ValidatorYield, platformFeeBps: number, opts: { solAmount: number; years: number; assetPriceUsd: number; solPriceUsd?: number; participation?: number }): ProjectionYear[] {
  const fee = platformFeeBps / 10_000;
  const solPrice = opts.solPriceUsd ?? v.solPrice;
  const participation = opts.participation ?? v.participation;
  const rows: ProjectionYear[] = [];
  let cumUnits = 0, cumUsd = 0;
  for (let y = 0; y < opts.years; y++) {
    const inflationRate = Math.max(v.terminal, v.inflationRate * Math.pow(1 - v.taper, y));
    const apr = (inflationRate * (1 - v.commission)) / participation;
    const gross = apyFromApr(apr, v.epochsPerYear) * 100 + v.mevApy;
    const net = gross * (1 - fee);
    const solYield = opts.solAmount * (net / 100); // principal never compounds: the LST stays 1:1 and yield leaves as the asset
    const usd = solYield * solPrice;
    const units = opts.assetPriceUsd > 0 ? usd / opts.assetPriceUsd : 0;
    cumUnits += units; cumUsd += usd;
    rows.push({ year: y + 1, inflationRate, netApyPct: net, solYield, assetUnits: units, usd, cumulativeAssetUnits: cumUnits, cumulativeUsd: cumUsd });
  }
  return rows;
}
