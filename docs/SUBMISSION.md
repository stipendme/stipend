# Stipend

**Stake SOL. Get paid in stocks.**

## Short description

Stipend turns SOL staking yield into tokenized stocks. Mint nvdaSOL, aaplSOL or goldSOL 1:1 with SOL, keep it in your wallet, and every epoch the staking yield is swapped into that asset and sent straight to you. Principal never leaves the audited SPL stake pool program; there is no custom program to exploit and nothing to claim.

---

## The problem

Most SOL holders stake and would happily own some NVIDIA, the S&P 500 or gold, but the only route is selling SOL to buy it. Staking yield, meanwhile, arrives as more SOL. Tokenized stocks on Solana (xStocks and others) now have real liquidity, yet nothing connects the two: there is no way to hold SOL and accumulate an equity position from its yield alone.

## What Stipend does

Each Stipend token is a liquid staking token for one asset:

| Token | Pays |
|---|---|
| nvdaSOL | NVDAx (NVIDIA) |
| aaplSOL | AAPLx (Apple) |
| tslaSOL | TSLAx (Tesla) |
| googlSOL | GOOGLx (Alphabet) |
| mstrSOL | MSTRx (Strategy) |
| spySOL | SPYx (S&P 500) |
| goldSOL | GLDx (gold) |
| btcSOL | cbBTC |
| usdcSOL | USDC |

Holding the token is the choice. It stays 1:1 with SOL, sits in your own wallet, and can be traded or paired like any other token. Each epoch its whole staking yield is bought in the asset and airdropped to holders pro rata. A 100 SOL position currently pays about 2 NVDAx a year at today's prices; the site shows every figure as an annual quantity of the asset, and switches to realised trailing payouts once a pool has paid.

It is dollar-cost averaging into a stock, funded by yield you were earning anyway, with the SOL principal untouched.

## How it works

1. **One SPL stake pool per asset.** You deposit SOL and receive the LST 1:1. Stake is delegated to the Solana Compass validator.
2. **100% epoch fee.** The pool keeps all staking rewards as its fee, so the LST never appreciates and stays exactly 1:1 with SOL. This is what makes it simple to reason about, to pair, and to redeem.
3. **Each epoch, a worker:**
   - updates the pool and redeems the fee for SOL from the reserve;
   - keeps the platform fee (15% of yield);
   - snapshots every wallet holding the LST;
   - swaps the rest into the asset on Jupiter;
   - transfers each holder their share directly, Token-2022 transfers included (xStocks carry a transfer-hook extension with no hook program, which the payout path handles).
4. **Redeem any time** for SOL from the reserve at a 0.1% fee, the market-standard rate, which also makes minting just before a snapshot and redeeming just after unprofitable.

Every fill, snapshot and payout is recorded and published on the Stats page, so anyone can rebuild the split from public data.

## Security

The design choice that matters most: **Stipend has no on-chain program of its own.**

- Principal lives in the SPL stake pool program, the same audited program behind JitoSOL and most Solana LSTs. Stipend mints and burns nothing itself.
- Stipend's keys cannot withdraw principal. The manager can set fees within the program's caps (withdrawal fee increases are rate-limited and delayed an epoch, so holders can leave first); the staker can only choose the validator; the worker only ever holds one epoch of redeemed yield.
- Worst case for a full key compromise is one epoch of undistributed yield. The How it works page lists exactly what each key can and cannot do, and what happens if Stipend disappeared: your LST still redeems 1:1 through the stake pool program and trades on Jupiter.

Services that keep user funds in their own wallets or their own upgradeable programs are one leaked key or bad upgrade from losing everything. Stipend is built so that path does not exist.

## Launch your own

Anyone can launch a pool for a new asset from the site:

- Pick a token from the curated stock, metal and major lists (tokens.xyz) or any Jupiter-verified token with enough liquidity. One token, one LST, so the `<ticker>SOL` name always means one thing.
- The backend prepares and co-signs the pool creation; the creator signs once in their wallet and pays about 1.03 SOL, most of which is the 1.01 SOL reserve seed returned to them as LST.
- The creator receives half of the platform fee from their pool every epoch. The role is revocable and metadata stays with the platform, so a token's real issuer can later claim its mark.
- Mints are vanity addresses ending in `stip`, with the ticker up front for flagship names (e.g. `AAPL…stip`), ground in bulk on a GPU.

## Yield, honestly

The single yield number shown is the validator's return net of the platform fee, derived live rather than quoted: Solana's current inflation rate from the network, divided by the share of SOL staked, compounded per epoch, plus MEV. Today that is about 4.3% net. The calculator projects any stake forward year by year with inflation's scheduled 15%-a-year step-down, and the docs balance that against what is rising: Jito tip sharing and the fee-sharing SIMDs that raise stakers' share of network activity.

## Tradeable from day one

We measured Jupiter routing across all 241 stake pools on the Sanctum LST list. Any listed pool, even with a few hundred SOL and no DEX liquidity, gets buys at exactly the pool rate through the Sanctum router and sells at about 0.13% through a liquid-unstake vault, and a 100% epoch fee does not block this. Stipend LSTs are therefore tradeable on Jupiter as soon as they are listed.

## Built and tested

- **Mainnet-fork rehearsal (Surfpool).** Pool creation, three holders minting 100/300/600 SOL, rebalancing to the validator, an epoch rollover with rewards, fee redemption, platform fee, snapshot, Token-2022 payouts split exactly 10/30/60%, creator share, holder token-account closure and rent handling, and redemption. Pool-creation instructions were diffed byte for byte against the official stake pool CLI.
- **Devnet environment.** Live pools, a test-SOL faucet and hourly demo epochs so anyone can mint on a phone and see a payout within the hour.
- **Production site** on stipend.my with the pools list, calculator, per-pool pages, portfolio, stats with TVL history, documentation with diagrams, self-serve launch and an admin console for reserve and validator stake.
- **DefiLlama adapter** and a public `/api/tvl` endpoint.

## Stack

Next.js 15 and React 19, Solana wallet adapter, `@solana/web3.js` and `@solana/kit`, `@solana/spl-stake-pool`, SQLite for the epoch ledger, a TypeScript ops CLI for pool creation, the epoch worker and reserve management, Surfpool for fork testing, and a CUDA vanity-key grinder. No custom on-chain program.

## Roadmap

- Launch the first mainnet pools and list them on Sanctum for Jupiter routing.
- Move the manager key to a Squads multisig as TVL grows.
- Run a dedicated Stipend validator once stake justifies it.
- Pay LP providers too: look through DEX pools and lending positions so pairing the LST does not forfeit the payout.
- Single-transaction launches using Solana's new v1 transaction format.
- More assets as tokenized stock liquidity grows.

## Links

- Live demo on devnet: https://stipend.my (switch Phantom to Testnet mode and use the "Get test SOL" button)
- Code: https://github.com/stipendme/stipend
