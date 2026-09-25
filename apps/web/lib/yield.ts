import { getValidatorYield as coreGetValidatorYield, computeLstYield as coreComputeLstYield, getPrices as coreGetPrices, projectYield as coreProjectYield, type ValidatorYield as CoreValidatorYield } from "@stipend/core";
import type { Registry, ValidatorYield, LstYield, ProjectionRow } from "./types";

let yieldCache: { at: number; value: ValidatorYield } | null = null;
let priceCache: { at: number; value: Record<string, number> } | null = null;

const FALLBACK: ValidatorYield = {
  totalApy: 5.15, inflationApy: 5.04, mevApy: 0.11, inflationRate: 0.0365, initial: 0.08, taper: 0.15, terminal: 0.015, participation: 0.74, commission: 0,
  solPriceUsd: 0, epochsPerYear: 146, currentEpoch: null, epochEndsAt: null, source: "fallback",
};

export async function getValidatorYield(registry: Registry): Promise<ValidatorYield> {
  if (yieldCache && Date.now() - yieldCache.at < 5 * 60_000) return yieldCache.value;
  let value: ValidatorYield = { ...FALLBACK };
  try {
    const v = await coreGetValidatorYield(registry);
    value = { ...value, totalApy: v.totalApy, inflationApy: v.inflationApy, mevApy: v.mevApy, inflationRate: v.inflationRate, initial: v.initial, taper: v.taper, terminal: v.terminal, participation: v.participation, commission: v.commission, solPriceUsd: v.solPrice, epochsPerYear: v.epochsPerYear, source: v.source };
  } catch {
    /* keep fallback numbers, flagged by source */
  }
  try {
    const rpc = process.env.RPC_URL ?? "https://api.mainnet-beta.solana.com";
    const res = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getEpochInfo" }), cache: "no-store" });
    const j = (await res.json()) as { result?: { epoch: number; slotIndex: number; slotsInEpoch: number } };
    if (j.result) {
      value.currentEpoch = j.result.epoch;
      value.epochEndsAt = Math.floor(Date.now() / 1000) + Math.round((j.result.slotsInEpoch - j.result.slotIndex) * 0.4);
    }
  } catch {
    /* epoch unknown */
  }
  yieldCache = { at: Date.now(), value };
  return value;
}

export async function getPrices(mints: string[]): Promise<Record<string, number>> {
  const want = Array.from(new Set(mints.filter(Boolean)));
  if (want.length === 0) return {};
  if (priceCache && Date.now() - priceCache.at < 60_000) return priceCache.value;
  let value = priceCache?.value ?? {};
  try {
    value = { ...value, ...(await coreGetPrices(want)) };
  } catch {
    /* keep stale prices */
  }
  priceCache = { at: Date.now(), value };
  return value;
}

function toCore(v: ValidatorYield): CoreValidatorYield {
  return { inflationRate: v.inflationRate, initial: v.initial, taper: v.taper, terminal: v.terminal, participation: v.participation, commission: v.commission, inflationApy: v.inflationApy, mevApy: v.mevApy, totalApy: v.totalApy, solPrice: v.solPriceUsd, epochsPerYear: v.epochsPerYear, source: v.source };
}

/**
 * The site's yield for one LST. Projected from the validator yield until the pool has paid an epoch; after that the
 * asset figure is what was actually paid per 100 SOL over the trailing window, annualised (basis "paid").
 */
export function computeLstYield(v: ValidatorYield, platformFeeBps: number, assetPriceUsd: number | null, realised: { assetPer100SolYear: number; days: number; epochs: number } | null = null): LstYield {
  const y = coreComputeLstYield(toCore(v), platformFeeBps, assetPriceUsd ?? 0);
  const hasPrice = assetPriceUsd != null && assetPriceUsd > 0;
  const paid = realised && realised.epochs > 0 ? realised : null;
  return {
    netApy: y.netApyPct,
    assetPriceUsd: hasPrice ? assetPriceUsd : null,
    assetPer100SolYear: paid ? paid.assetPer100SolYear : hasPrice ? y.assetPer100SolPerYear : null,
    usdPer100SolYear: paid && hasPrice ? paid.assetPer100SolYear * assetPriceUsd : y.usdPer100SolPerYear,
    basis: paid ? "paid" : "estimate",
    realised: paid,
  };
}

export function projectYield(v: ValidatorYield, platformFeeBps: number, opts: { solAmount: number; years: number; assetPriceUsd: number; solPriceUsd?: number; participation?: number }): ProjectionRow[] {
  return coreProjectYield(toCore(v), platformFeeBps, opts);
}
