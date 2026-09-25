# Decisions

D1. One stake pool per asset, epoch fee 100%. Holding the LST is the vote. Rejected: single LST + deposit-to-pool (Meteora reward-pool model) because the LST leaves the wallet and becomes untradeable/unpairable, and MeteoraAg/reward-pool was archived 2026-09-02.

D2. Rewards by merkle claim on the Solana Foundation rewards program. Rejected: off-chain allocation records (unverifiable), Jito distributor (per-round ClaimStatus rent paid by claimant, not closable upstream), Streamflow distributor (close is gated, still one distributor per round).

D3. Continuous pool mode of the rewards program is NOT on mainnet. README describes it; the code was removed in commit d795849 before the OtterSec audit and the 2026-05-27 mainnet binary contains only direct/merkle seeds (verified with `solana program dump` + strings). Upstream branch feat/restore-points-continuous exists. Stipend therefore uses merkle mode with cumulative rollover (ARCHITECTURE.md). The distributor is behind one module so continuous mode can replace it later.

D4. Claim rent: MerkleClaim PDAs are paid by the claimant and can be closed once the distribution is closed (next epoch). The site batches "reclaim rent". Net cost to a daily claimer is transaction fees only.

D5. Snapshot is point-in-time at epoch boundary. The 0.1% SOL withdrawal fee makes mint-before/redeem-after unprofitable (~5x a day's yield). Look-through to LP positions is a later feature via the same leaf builder.

D6. Validator: Solana Compass vote account, 0% commission, Jito. Net LST yield = validator total APY x (1 - platform fee 10%).

D7. Brand: Stipend, stipend.my. Token names <asset>SOL.

D8. xStocks cannot use the rewards program at all: their mints carry the Token-2022 TransferHook extension and both CreateMerkleDistribution and CreateDirectDistribution reject that extension type outright. xStock LSTs therefore pay out by direct transfer from the worker each epoch (`delivery: "direct"`); merkle claims remain for hook-free assets (cbBTC, USDC). If the Foundation lifts the restriction, flip the registry field.

D9. Node 22 is required (better-sqlite3 has no Node 21 binding); `.nvmrc` pins it.

D10. One delivery mode in production: direct airdrop for every LST (product decision, 2026-09-13: one delivery mode, not both claim and airdrop). The merkle path stays in core, dormant. Consequence: the worker funds recipient token accounts (~0.002 SOL each, once per holder per asset), so the platform fee default moved from 10% to 15% to cover it.

D11. Yield shown on the site is a single number: validator yield net of the platform fee, derived from live RPC inflation (3.65% on 2026-09-13, not the 4.5% the profile API carried) divided by staking participation, compounded per epoch, plus MEV. Fees are documented, not printed on every page. Figures are annual per 100 SOL at current SOL and asset prices.
