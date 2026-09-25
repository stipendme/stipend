# Stipend architecture

Stake SOL, receive an LST that pays its yield in a chosen asset (tokenized stock, ETF, metal, or any SPL token).

## Shape

- One SPL stake pool per asset. Epoch fee 100% so the LST stays 1:1 with SOL and never appreciates. All stake delegated to the Stipend validator (Solana Compass vote account). Withdrawal fee 0.1% makes "mint before the snapshot, redeem after" unprofitable (a day of yield is ~0.02%).
- Holding the LST is the vote. The LST stays in the user's wallet; nothing is deposited anywhere.
- Each epoch the worker redeems the pool's fee tokens for SOL, keeps the platform fee, swaps the rest into the asset on Jupiter, snapshots LST holders, and transfers each holder's share straight to their wallet (creating the token account if needed). Nothing to claim.
- The merkle-claim path on the Solana Foundation rewards program (REWArDioXgQJ2fZKkfu9LCLjQfRwYWVVfsvcsR5hoXi) is implemented but dormant: that program rejects transfer-hook mints, which every xStock is, and one delivery mode is simpler for users (D8, D10).

## Programs used (no custom program)

- SPL stake pool `SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy` via `@solana/spl-stake-pool` (JS) and `spl-stake-pool` CLI (create-pool, set-fee only).
- Rewards program merkle mode via vendored `@solana/rewards` (packages/rewards-client, @solana/kit based).
  - Leaf = keccak(0x00 || keccak(claimant(32) || total_amount u64 LE || borsh(VestingSchedule::Immediate = [0x00])))
  - Nodes: keccak(min(a,b) || max(a,b)); leaves sorted by hash before pairing; odd node promoted.
  - PDAs: distribution ["merkle_distribution", mint, authority, seeds_signer]; claim ["merkle_claim", distribution, claimant]; revocation ["revocation", distribution, claimant]; event authority ["event_authority"] (the IDL doc comment says "__event_authority" but the program seed is "event_authority").
- Jupiter lite-api for swaps and prices.

## Delivery

`LstEntry.delivery` is `direct` for every LST (`ops assets sync` always sets it). `merkle` remains supported by the worker and core for a future where the rewards program accepts the mints, but nothing on the site uses it.

- `merkle`: the cumulative rollover below (cbBTC, USDC, any plain SPL or Token-2022 mint without a transfer hook).
- `direct`: the rewards program refuses mints carrying the Token-2022 TransferHook extension (`UNSUPPORTED_MINT_EXTENSIONS` in program/src/utils/token_utils.rs), and every xStock mint carries it (hook program unset, but the extension type is present). For these the worker transfers the asset straight to each holder every epoch (5 transfers per transaction). Balances under `distribution.minPayoutUsd` accrue in the ledger until they clear the threshold. Missing recipient token accounts are created by the worker when `payAtaRent` is on, otherwise the amount accrues until the holder has one. No claim step, no rent to reclaim; the site shows payout history instead.

## Cumulative rollover (why nothing expires)

The rewards program has one immutable root per distribution and a MerkleClaim PDA per (distribution, claimant), rent paid by claimant, closable only after the distribution is closed (after clawback_ts). To avoid "claim within N days or lose it" and to let users skip epochs for free:

For each LST, the worker keeps `owed[user]` (lifetime earned) and `claimed[user]` (lifetime claimed) in the DB. Each epoch:

1. `updateStakePool` for the pool.
2. Read manager fee account balance (pool tokens minted as the epoch fee). `withdrawSol` them to the worker wallet from the reserve. If the reserve cannot cover it, withdraw what it can and carry the rest.
3. Split: platform fee (platformFeeBps) to treasury, remainder is the epoch's reward budget.
4. Snapshot: all token accounts for the LST mint at the current slot, grouped by owner, minus excluded owners (manager fee account, treasury, registry.snapshot.excludeOwners). Store the snapshot with its slot.
5. Swap budget SOL to the asset via Jupiter (skip and carry forward if below minSwapLamports). Store the fill.
6. Credit: `owed[user] += received * balance / totalSnapshotBalance` (integer math, dust stays in the pool float).
7. Settle the previous distribution: read every MerkleClaim PDA under it (getProgramAccounts filtered by distribution), set `claimed[user] = max(claimed[user], previousClaimedBefore[user] + pda.claimed_amount)`; then `CloseMerkleDistribution` (requires now > clawback_ts; clawbackHours is set well under an epoch) which returns the unclaimed float to the worker's asset token account.
8. Build the new root with leaf(user) = owed[user] - claimed[user] for every user with a positive delta. `CreateMerkleDistribution` with amount = total of leaves, clawback_ts = now + clawbackHours, revocable = 0. Fund from the worker's asset token account (float + this epoch's fill). Persist proofs for the API.
9. Users claim the full leaf from the latest distribution only. Old MerkleClaim PDAs can be closed by the user (`CloseMerkleClaim`) to reclaim rent once that distribution is closed; the site offers "reclaim rent" in one batch.

A third party can rebuild every root from the stored snapshots, fills, and on-chain claims.

## Keys

manager (fee receiver + set-fee; multisig later), staker (rebalance), worker (fee redemption, swaps, distributions). Vanity mint keypairs per LST supplied by the operator.

## Reserve policy

Reserve must cover: one epoch of fee redemption (~yield of the pool for one epoch) plus expected withdrawals. `admin rebalance` targets max(reserve.targetBps of pool lamports, reserve.minSol) in the reserve and moves the rest to the validator with increase/decrease-validator-stake. Deposits activate next epoch; decreases deactivate next epoch, so the reserve is refilled with a one-epoch lag.

## Data

SQLite (better-sqlite3) file at `data/stipend.db`, shared by ops and web on the same box. Tables: epochs, fee_redemptions, snapshots, snapshot_balances, swaps, distributions, leaves (proofs), ledger (owed/claimed per user per lst), claims_seen.

## Yield shown on the site

One number: validator yield net of the platform fee. Gross yield is derived, not quoted: live inflation from RPC `getInflationRate` (3.65% on 2026-09-13) × (1 − commission) ÷ staking participation (Compass profile), compounded per epoch, plus the validator's MEV APY. Asset units per 100 SOL per year use Jupiter prices for SOL and the asset. The calculator projects forward with the 15%/yr inflation taper towards the 1.5% terminal rate, prices held constant. Fees are documented on /docs, not printed on product pages.
