# Stipend

**Stake SOL. Get paid in stocks.**

Stipend turns SOL staking yield into tokenized stocks. Mint nvdaSOL, aaplSOL or goldSOL 1:1 with SOL, keep it in your wallet, and every epoch its staking yield is swapped into that asset and sent straight to you. Principal never leaves the audited SPL stake pool program. There is no custom program to exploit and nothing to claim.

## Why

SOL holders who want some NVIDIA, the S&P 500 or gold today have to sell SOL to get it, while their staking yield arrives as more SOL. Stipend connects the two: keep your SOL staked and accumulate an equity position from the yield alone. It is dollar-cost averaging into a stock, funded by yield you were earning anyway.

## How it works

- **One SPL stake pool per asset.** nvdaSOL pays NVDAx, aaplSOL pays AAPLx, goldSOL pays GLDx, plus TSLAx, GOOGLx, MSTRx, SPYx, cbBTC and USDC. Holding the token is the choice.
- **100% epoch fee.** The pool keeps all staking rewards as its fee, so the token never appreciates and stays exactly 1:1 with SOL. It lives in your wallet and can be traded or paired like any other token.
- **Each epoch a worker** redeems the fee for SOL, takes a 15% platform fee, snapshots every holder, swaps the rest into the asset on Jupiter and transfers each holder their share directly, Token-2022 xStocks included.
- **Redeem any time** for SOL at the market-standard 0.1% fee, which also makes minting before a snapshot and leaving after it unprofitable.

A 100 SOL position currently pays about 2 NVDAx a year at today's prices. Every fill, snapshot and payout is published on the Stats page, so anyone can check the split.

## Security

Stipend has no on-chain program of its own. Principal sits in the SPL stake pool program, the same audited program behind JitoSOL. Stipend's keys cannot withdraw it: the manager sets fees within the program's rate-limited caps, the staker picks the validator, and the worker only ever holds one epoch of yield. The worst case for a full key compromise is one epoch of undistributed yield. If Stipend disappeared, every token still redeems 1:1 through the stake pool program.

## Launch your own

Anyone can launch a pool for a new asset: any token on the curated stock, metal and major lists, or any Jupiter-verified token with enough liquidity. One token, one LST, so each `<ticker>SOL` name means one thing. The creator signs once, pays about 1.03 SOL (mostly a reserve seed returned to them as LST), and earns half of the platform fee from their pool. Mints are vanity addresses like `AAPL…stip`, ground on a GPU.

## Honest yield

The one yield figure shown is derived live, not quoted: Solana's current inflation divided by the share of SOL staked, plus MEV, net of the platform fee. About 4.3% today. A calculator projects any stake year by year with inflation's scheduled step-down, and figures switch to realised payouts once a pool has paid.

## Tradeable from day one

We measured Jupiter routing across all 241 pools on the Sanctum LST list. Even small pools with no DEX liquidity get buys at the exact pool rate and sells at about 0.13%, and a 100% epoch fee doesn't block it. Stipend tokens trade on Jupiter as soon as they're listed.

## Built and tested

- **Mainnet-fork rehearsal on Surfpool:** pool creation, three holders minting 100, 300 and 600 SOL, rebalancing, an epoch of rewards, fee redemption, Token-2022 payouts split exactly 10/30/60%, creator share, rent handling and redemption. Pool-creation instructions match the official CLI byte for byte.
- **Live devnet demo** with a test-SOL faucet and hourly payouts, so you can mint on your phone and see the asset arrive within the hour.
- **Full site:** pools, calculator, portfolio, stats with TVL history, illustrated docs, self-serve launch, admin console and a DefiLlama adapter.

Built with Next.js, the Solana wallet adapter, `@solana/spl-stake-pool`, Jupiter and Surfpool. No custom on-chain program.

## Next

First mainnet pools and Sanctum listing, manager key on a Squads multisig, a dedicated Stipend validator, payouts for LP positions, single-transaction launches with Solana's new v1 transactions, and more assets.

**Try it:** https://stipend.my (devnet demo: switch Phantom to Testnet mode and tap "Get test SOL")
**Code:** https://github.com/stipendme/stipend
