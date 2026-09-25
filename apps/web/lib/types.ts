// Shared DTOs between route handlers and client components. Registry types come from @stipend/core (type-only import,
// erased at build time so the browser bundle never touches core).
export type { Registry, LstEntry, AssetInfo, Fee } from "@stipend/core";

export interface PoolStats {
  totalLamports: string;
  poolTokenSupply: string;
  reserveLamports: string;
  /** rent-exempt floor already removed */
  reserveAvailableLamports: string;
  activeStakeLamports: string;
  transientStakeLamports: string;
  lastUpdateEpoch: number;
  needsUpdate: boolean;
  /** pool tokens sitting in the manager fee account, i.e. yield not yet redeemed by the worker */
  pendingFeeTokens: string;
  holders: number | null;
  staker: string;
  manager: string;
}

/** Validator yield from first principles (core/yield.ts): live inflation ÷ participation, compounded per epoch, plus MEV. */
export interface ValidatorYield {
  totalApy: number; // percent
  inflationApy: number;
  mevApy: number;
  inflationRate: number; // fraction, live from RPC
  initial: number; // governor initial rate (0.08)
  taper: number; // yearly reduction as a fraction of the rate (0.15)
  terminal: number;
  participation: number;
  commission: number;
  solPriceUsd: number;
  epochsPerYear: number;
  currentEpoch: number | null;
  epochEndsAt: number | null; // unix seconds
  source: string;
}

export interface LstYield {
  /** percent after the platform fee: the only yield number the site shows */
  netApy: number;
  assetPriceUsd: number | null;
  /** asset units per 100 SOL per year, null if no price. Projected when `realised` is null, otherwise the realised figure. */
  assetPer100SolYear: number | null;
  usdPer100SolYear: number;
  /** "estimate" until the pool has paid an epoch; then "paid" and the figure above is backwards-looking */
  basis: "estimate" | "paid";
  /** trailing realised payouts, present once at least one epoch has paid */
  realised: { assetPer100SolYear: number; days: number; epochs: number } | null;
}

export interface LstTotals {
  epochsRun: number;
  totalDistributed: string;
  totalRedeemedLamports: string;
  lastEpoch: number | null;
}

export interface LstView {
  entry: import("@stipend/core").LstEntry;
  stats: PoolStats | null;
  yield: LstYield;
  totals: LstTotals | null;
}

/** Site-wide callouts. Strings are exact integers; null means nothing has happened yet. */
export interface SiteTotals {
  stakedLamports: string;
  paidOutUsd: number | null;
  holders: number | null;
  epochsProcessed: number;
}

export interface TvlPoint {
  ts: number;
  lst: string;
  totalLamports: string;
  supply: string;
  holders: number | null;
  solPriceUsd: number | null;
}

/** /api/tvl */
export interface TvlResponse {
  totalSol: number;
  totalUsd: number | null;
  byAsset: { symbol: string; assetSymbol: string; sol: number; usd: number | null }[];
  updatedAt: number | null;
  source: "history" | "live";
}

export interface LstsResponse {
  brand: import("@stipend/core").Registry["brand"];
  validator: ValidatorYield;
  platformFeeBps: number;
  fees: import("@stipend/core").Registry["fees"];
  reserve: import("@stipend/core").Registry["reserve"];
  programs: import("@stipend/core").Registry["programs"];
  validatorVote: string;
  lsts: LstView[];
  totals: SiteTotals;
  generatedAt: number;
}

export interface ClaimableRow {
  lstSymbol: string;
  assetSymbol: string;
  assetMint: string;
  assetDecimals: number;
  tokenProgram: "spl-token" | "token-2022";
  distribution: string;
  authority: string;
  seeds: string;
  mint: string;
  totalAmount: string;
  proof: number[][];
  epoch: number;
}

export interface ClosedClaimRow {
  lstSymbol: string;
  distribution: string;
  epoch: number;
  rentLamports: string;
}

export interface DistributionRow {
  epoch: number;
  status: string;
  distribution: string | null;
  startedAt: number;
  finishedAt: number | null;
  solRedeemed: string; // lamports
  platformFee: string; // lamports
  swappedIn: string; // lamports actually swapped
  assetOut: string; // asset base units
  swapSig: string | null;
  holders: number | null;
  totalAmount: string | null;
  notes: string | null;
}

/** One epoch of one LST for the /stats page. */
export interface StatsEpochRow extends DistributionRow {
  lstSymbol: string;
  assetSymbol: string;
  assetDecimals: number;
  holdersPaid: number;
  payoutTxs: number;
}

export interface StatsLstRow {
  lstSymbol: string;
  assetSymbol: string;
  assetDecimals: number;
  epochsRun: number;
  totalRedeemedLamports: string;
  totalDistributed: string;
  holdersLast: number | null;
  lastEpoch: number | null;
}

export interface LedgerRow {
  lstSymbol: string;
  owed: string;
  claimed: string;
  paid: string;
}

export interface PayoutRow {
  lstSymbol: string;
  epoch: number;
  amount: string;
  signature: string | null;
  ts: number;
}

export interface EpochRun {
  epoch: number;
  lstSymbol: string;
  startedAt: number;
  finishedAt: number | null;
  status: string;
  notes: string | null;
}

export interface ClaimsResponse {
  wallet: string;
  claimable: ClaimableRow[];
  closed: ClosedClaimRow[];
  ledger: LedgerRow[];
  payouts: PayoutRow[];
}

/** /api/project */
export interface ProjectionRow {
  year: number;
  inflationRate: number;
  netApyPct: number;
  solYield: number;
  assetUnits: number;
  usd: number;
  cumulativeAssetUnits: number;
  cumulativeUsd: number;
}
export interface ProjectionResponse {
  lstSymbol: string;
  assetSymbol: string;
  solAmount: number;
  years: number;
  solPriceUsd: number;
  assetPriceUsd: number;
  participation: number;
  rows: ProjectionRow[];
}
