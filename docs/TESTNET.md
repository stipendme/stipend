# Testing Stipend on a phone (devnet)

Staging can run against Solana **devnet** so anyone can mint, hold and get paid with worthless tokens. Phantom's "Testnet mode" connects to Solana devnet (not the cluster named testnet), which is why the environment is devnet.

## On the phone

1. Phantom → Settings → Developer settings → turn on **Testnet mode**.
2. Open the staging site. The header shows a `devnet` badge and a banner.
3. Connect the wallet, press **Get test SOL** (header or mint panel). You get 1 SOL from the cluster faucet or 2 SOL from our faucet key, once per wallet per 6 hours.
4. Open a pool (nvdaSOL or aaplSOL), mint some SOL. The transaction also opens your NVDAx account (one-off rent).
5. Wait for the next demo epoch (top of the hour). The asset lands in your wallet; the LST page's Epochs table and Portfolio show it.
6. Redeem some LST back to SOL to see the 0.1% fee and reserve liquidity.

## What is real

- The SPL stake pool program (`SPoo1Ku8…`), the pools, the LST mints, deposits, redemptions, holder snapshots, rent rules, creator share, and the payout transfers (Token-2022 with a null transfer hook, like mainnet xStocks).

## What is simulated

- **Fills.** There is no Jupiter on devnet. The worker prices the epoch's SOL with mainnet Jupiter prices for SOL and the real asset (`asset.priceMint`), mints that many units of the test asset to itself, and moves the SOL to the treasury. Mode is logged as `testmint`.
- **Epoch cadence.** `registry.demo` (every 60 minutes, 5% APY) creates a synthetic reward from the worker's own SOL so testers see a payout within the hour. Real epoch updates still run.
- **The validator.** Devnet runs a 2023 build of the stake pool program that cannot read current vote accounts (`add-validator` fails with BorshIoError) and predates `CreateTokenMetadata`, so devnet pools keep all SOL in the reserve and the LST shows as an unnamed token in wallets. Neither affects mainnet.

## Operating it

```bash
# one-off, from a machine with the devnet keys (keys/devnet/, git-ignored)
RPC_URL=https://devnet.helius-rpc.com/?api-key=... STIPEND_KEYS_DIR=keys/devnet STIPEND_REGISTRY=config/registry.devnet.json STIPEND_DB=data/devnet.db \
  pnpm ops testnet setup --symbols nvdaSOL,aaplSOL     # test mints + pools; idempotent/resumable
pnpm ops testnet status
pnpm ops epoch run --demo --lst nvdaSOL                 # one demo epoch now
```

Server `deploy/.env` for devnet:

```
NETWORK=devnet
RPC_URL=https://devnet.helius-rpc.com/?api-key=...
NEXT_PUBLIC_RPC_URL=https://api.devnet.solana.com
REGISTRY_PATH=/repo/config/registry.devnet.json
KEYS_DIR=/repo/keys/devnet
FAUCET_KEY=/repo/keys/devnet/faucet.json
DB_PATH=/repo/data/devnet.db
CRON_INTERVAL_SEC=120
```

`deploy/sync.sh` rsyncs `keys/devnet/` to the box (devnet keys only; mainnet keys never leave the ops machine). Start the worker with `docker compose -p stipend-staging -f deploy/docker-compose.yml --profile ops up -d worker`.

Devnet SOL: the public faucets rate-limit hard; the faucet key was funded from an existing devnet balance. Top it up with `solana transfer <faucet> 5 -u devnet -k <any funded devnet key>`.

## Back to mainnet

Set `NETWORK=mainnet-beta`, mainnet `RPC_URL`s, `REGISTRY_PATH=/repo/config/registry.json`, `KEYS_DIR=/repo/keys`, `DB_PATH=/repo/data/stipend.db`, unset `FAUCET_KEY`, then `deploy/sync.sh` and stop the worker unless mainnet keys are on the box.
