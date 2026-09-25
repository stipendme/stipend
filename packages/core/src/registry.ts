/** Shared registry contract. config/registry.json is the single source of truth for both ops and web. */

export interface Fee { numerator: number; denominator: number }

export interface AssetInfo {
  /** Ticker as shown to users, e.g. "NVDAx" */
  symbol: string;
  /** e.g. "NVIDIA xStock" */
  name: string;
  mint: string;
  decimals: number;
  /** "spl-token" or "token-2022" (xStocks are Token-2022) */
  tokenProgram: "spl-token" | "token-2022";
  logo?: string;
  /** Non-mainnet only: the real mainnet mint whose Jupiter price prices the simulated fill for this test asset. */
  priceMint?: string;
  /** Free-text category used for browsing: "stock" | "etf" | "metal" | "crypto" | "stable" */
  category: string;
}

export interface LstEntry {
  /** e.g. "nvdaSOL" */
  symbol: string;
  /** e.g. "Stipend NVIDIA SOL" */
  name: string;
  /** Short marketing line, e.g. "Hold nvdaSOL, get paid NVDA every epoch." */
  blurb?: string;
  asset: AssetInfo;
  /** SPL stake pool account */
  stakePool: string;
  /** Pool token mint (the LST). Vanity keypair supplied at creation. */
  mint: string;
  validatorList: string;
  reserve: string;
  managerFeeAccount: string;
  /** Path (relative to keys/) of the vanity mint keypair used at creation, for the record */
  mintKeypair?: string;
  createdEpoch: number;
  status: "draft" | "live" | "paused";
  /**
   * How rewards reach holders.
   * "merkle": Solana Foundation rewards program merkle distribution, users claim on the site (any mint WITHOUT the
   *           Token-2022 TransferHook extension; the program rejects hook mints even when the hook program is unset).
   * "direct": the worker transfers the asset straight to holders' token accounts each epoch (required for xStocks,
   *           which carry the TransferHook extension). No claim step; small amounts are carried until they clear minPayoutUsd.
   */
  /** "direct": worker transfers the asset to holders each epoch (the launch mode for every LST). "merkle": dormant claim mode, kept for a hook-free future. */
  delivery: "merkle" | "direct";
  /** Self-service launches: the wallet that paid for the pool and receives creatorFeeBps of the platform fee each epoch */
  creator?: string;
  /** Share of the platform fee (bps of the fee, not of yield) paid to `creator`; defaults to registry.launch.creatorFeeBps */
  creatorFeeBps?: number;
  launchedAt?: number;
  /** Signatures of the launch transactions, in order */
  launchTx?: string[];
}

export interface LaunchPolicy {
  enabled: boolean;
  /** default creator share, bps of the platform fee */
  creatorFeeBps: number;
  /** SOL the launcher deposits so the reserve can cover add-validator's minimum delegation (1 SOL + buffer) */
  seedLamports: number;
  maxValidators: number;
  /** tokens.xyz curated lists an asset may come from */
  allowedLists: string[];
  /** fallback: Jupiter-verified tokens with at least this much liquidity */
  minJupLiquidityUsd: number;
}

export interface RentPolicy {
  /** platform pays the rent of a holder's first asset token account (once per lst+wallet); later recreations come from the holder's accrual */
  platformFundsFirstAccount: boolean;
  /** cap on platform-funded rent per epoch, bps of that epoch's platform fee; the rest accrue to later epochs */
  rentBudgetBpsOfFee: number;
}

export interface Registry {
  network: "mainnet-beta" | "devnet" | "testnet";
  /** Non-mainnet only: synthetic epochs so testers see payouts within the hour. */
  demo?: { enabled: boolean; intervalMinutes: number; apyPct: number };
  brand: { name: string; domain: string; tagline: string };
  validator: { voteAccount: string; name: string; yieldApi: string };
  programs: { stakePool: string; rewards: string };
  fees: {
    platformFeeBps: number;
    epochFee: Fee;
    solWithdrawalFee: Fee;
    stakeWithdrawalFee: Fee;
    solDepositFee: Fee;
    stakeDepositFee: Fee;
  };
  /** Reserve policy: keep max(targetBps of total lamports, minSol) liquid in the reserve */
  reserve: { targetBps: number; minSol: number };
  distribution: {
    /** Merkle mode: distribution N is closable (and rolled into N+1) this many hours after creation. Keep well under an epoch. */
    clawbackHours: number;
    /** Skip the Jupiter swap and carry the SOL forward when the epoch budget is below this. */
    minSwapLamports: number;
    /** Direct mode: carry a holder's balance forward until it is worth at least this much (USD). */
    minPayoutUsd: number;
    /** Direct mode: create the recipient's token account (rent ~0.002 SOL) when missing. */
    payAtaRent: boolean;
  };
  /** Owners excluded from holder snapshots (AMM pools, treasury, fee accounts are added automatically) */
  snapshot: { excludeOwners: string[] };
  treasury: string;
  launch?: LaunchPolicy;
  rent?: RentPolicy;
  lsts: LstEntry[];
}

export const DEFAULT_LAUNCH: LaunchPolicy = { enabled: true, creatorFeeBps: 5000, seedLamports: 1_010_000_000, maxValidators: 4, allowedLists: ["stocks", "metals", "majors"], minJupLiquidityUsd: 250_000 };
export const DEFAULT_RENT: RentPolicy = { platformFundsFirstAccount: true, rentBudgetBpsOfFee: 5000 };
export const launchPolicy = (r: Registry): LaunchPolicy => ({ ...DEFAULT_LAUNCH, ...(r.launch ?? {}) });
export const rentPolicy = (r: Registry): RentPolicy => ({ ...DEFAULT_RENT, ...(r.rent ?? {}) });
