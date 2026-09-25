# Stipend ops runbook

Everything below runs from the repo root with `pnpm ops <command>` (see `pnpm ops --help`).

## Prerequisites

- Node 22 (`nvm use` picks it up from `.nvmrc`; Node 21 cannot build better-sqlite3). Then `pnpm install && pnpm -r build`.
- `solana` CLI and `spl-stake-pool` CLI (0.6.4 tested) on PATH. Only `create-pool` and `set-fee` shell out to the CLI; everything else is JS.
- `RPC_URL` set to a real RPC (Helius/Triton). The public endpoint rate-limits `getProgramAccounts`, which the holder snapshot needs.
- Keys in `keys/` (git-ignored):
  - `manager.json` — stake pool manager and fee-account owner. Signs `set-fee`, token metadata, and the fee redemption each epoch. Move to a Squads multisig once there is real TVL; until then keep it on the ops box with `chmod 400`.
  - `staker.json` — rebalancer (`admin rebalance`, `add-validator`).
  - `worker.json` — receives redeemed SOL, swaps on Jupiter, funds distributions or pays holders. Keep ≥ 0.1 SOL for fees; the worker refuses to spend below 0.05 SOL.
  - `<symbol>-mint.json` — one vanity keypair per LST, supplied by you.
- `config/registry.json` — single source of truth. Set `treasury` (platform fee destination) before the first epoch.

Environment overrides: `STIPEND_WORKER_KEY`, `STIPEND_MANAGER_KEY`, `STIPEND_STAKER_KEY`, `STIPEND_DB`, `STIPEND_REGISTRY`, `PRIORITY_FEE_MICROLAMPORTS` (default 50000), `JUPITER_API_KEY` (optional, lite-api works without).

## Delivery (read this first)

Every LST is `delivery: "direct"` (D10). The merkle notes below are kept for reference only.

Each LST has `delivery: "merkle" | "direct"`, chosen automatically by `assets sync`:

- **merkle** — rewards land in a Solana Foundation rewards-program merkle distribution; holders claim on the site. Only possible for mints without the Token-2022 `TransferHook` extension. The program rejects any hook mint even when the hook program is unset (`reject_mint_extensions` in `program/src/utils/token_utils.rs`). cbBTC and USDC qualify.
- **direct** — the worker transfers the asset straight to each holder's token account every epoch. Required for every xStock (NVDAx, AAPLx, TSLAx, GOOGLx, MSTRx, SPYx, GLDx all carry `TransferHook` with a null program). No claim step. Balances below `distribution.minPayoutUsd` are carried in the ledger until they clear it. Missing token accounts are created by the worker when `distribution.payAtaRent` is true (~0.002 SOL each, once per holder per asset).

## Rehearsal on a Surfpool fork (do this before any mainnet change)

`pnpm ops e2e --symbol nvdaSOL` with `RPC_URL` pointing at a surfnet runs the whole lifecycle against a fork of mainnet using scratch keys, a scratch registry copy and DB under `data/e2e/`: create-pool via the CLI, add-validator, metadata, three holders minting 100/300/600 SOL, rebalance to the validator, time-travel one epoch, 1 SOL of simulated reward in the reserve, the real epoch worker (update, fee redemption, platform fee, snapshot, fill, pro-rata Token-2022 payout), and a redemption. The Jupiter fill is the only stand-in (a Jupiter transaction cannot land on a fork): core's `swap()` credits the quoted output with cheatcodes when the RPC answers `surfnet_getSurfnetInfo`. It refuses to run against a real cluster.

Start a fork (docker): `docker run -d --name stipend-surfpool -p 127.0.0.1:28899:8899 ubuntu:22.04 bash -c '...install surfpool 1.5.0... && surfpool start --rpc-url $RPC --host 0.0.0.0 --no-tui --no-studio --no-deploy --airdrop-amount 0'` (see deploy notes) then `RPC_URL=http://127.0.0.1:28899 pnpm ops e2e`.

Verified 2026-09-16: every step passes; payouts split 10.0/30.0/60.0%; the pool stays exactly 1:1 after the update; a redemption larger than the liquid reserve fails with the program's "too much SOL withdrawn" error, which is the reserve policy working, not a bug.

## Key generation

```bash
# vanity mint for nvdaSOL (case-sensitive prefix; drop :1 for more matches)
solana-keygen grind --starts-with nvda:1 --ignore-case
mv nvda*.json keys/nvdasol-mint.json
solana-keygen new -o keys/manager.json --no-bip39-passphrase
solana-keygen new -o keys/staker.json  --no-bip39-passphrase
solana-keygen new -o keys/worker.json  --no-bip39-passphrase
chmod 400 keys/*.json
```

Fund: manager ≈ 0.5 SOL (pool creation rent + fees), staker ≈ 0.1 SOL, worker ≈ 0.5 SOL.

## Create an LST end to end

```bash
pnpm ops assets sync                      # verifies mints on Jupiter + chain, writes draft entries
pnpm ops create-lst --symbol nvdaSOL --mint-keypair keys/nvdasol-mint.json --dry-run   # prints the exact CLI commands
pnpm ops create-lst --symbol nvdaSOL --mint-keypair keys/nvdasol-mint.json
```

What `create-lst` does:
1. `spl-stake-pool create-pool` with epoch fee 1/1 (100%), stake-withdrawal fee 1/1000, deposit fee 0, max 4 validators, `--unsafe-fees`, using your mint keypair and generating pool / validator-list / reserve keypairs into `keys/<symbol>-*.json`.
2. `spl-stake-pool set-fee <pool> sol-withdrawal 1 1000` (create-pool's single withdrawal flag only covers stake withdrawals). Fee changes take effect next epoch.
3. `add-validator` with the registry vote account (staker signs).
4. Token metadata `name / symbol / https://<domain>/meta/<symbol>.json` (manager signs). The site must serve that JSON (name, symbol, image).
5. Writes addresses into the registry with `status: "draft"`.

Then:

```bash
solana transfer <reserve> 5 --allow-unfunded-recipient   # seed the reserve (registry.reserve.minSol) so redemptions never fail
pnpm ops admin status --lst nvdaSOL
pnpm ops admin live --lst nvdaSOL
```

Test with your own wallet: deposit SOL on the site (or `spl-stake-pool deposit-sol <pool> 1`), wait an epoch, run `pnpm ops epoch run --lst nvdaSOL --dry-run`.

## The epoch cycle

`pnpm ops epoch run` (or the `cron` loop) does, per live LST, idempotently per (lst, epoch):

1. `update` the pool if `lastUpdateEpoch < currentEpoch` (worker pays).
2. Redeem the manager fee account's pool tokens for SOL from the reserve into the worker (`withdraw-sol`, manager signs). If the reserve cannot cover all of it, the remainder stays in the fee account for next epoch.
3. Send `platformFeeBps` of the redeemed SOL to `treasury`; add any SOL carried from previous epochs.
4. Snapshot every holder of the LST mint (classic SPL `getProgramAccounts`), minus `snapshot.excludeOwners`, manager, worker, treasury.
5. Swap the budget SOL → asset on Jupiter (0.5% slippage) unless the budget is under `minSwapLamports`, in which case it is carried.
6. Credit `owed[holder] += received × balance / total` in the ledger. Rounding dust stays in the worker's asset account as float.
7. Deliver:
   - merkle: close last epoch's distribution (must be past its `clawback_ts`; `clawbackHours` = 12 keeps this well inside an epoch), record who claimed, and publish a new distribution whose leaf is `owed − claimed` for every holder. Nothing ever expires: an unclaimed leaf simply reappears in the next root.
   - direct: transfer `owed − paid` to every holder above the payout floor, 5 transfers per transaction.
8. Mark the epoch done. `data/stipend.db` (SQLite, WAL) holds snapshots, swaps, distributions, proofs and the ledger; the site reads the same file.

`--dry-run` performs every read and calculation, quotes the swap, prints the plan, and writes nothing.

If a merkle distribution is not yet closable when the epoch runs (e.g. the run started early), the epoch stays in status `credited` and `epoch settle` (run automatically by `cron` every tick) finishes it.

## Running it

```bash
pnpm ops cron            # foreground loop: every 5 min check epoch; new epoch -> epoch run; otherwise epoch settle
```

systemd unit (`/etc/systemd/system/stipend-ops.service`):

```ini
[Unit]
Description=Stipend epoch worker
After=network-online.target

[Service]
User=stipend
WorkingDirectory=/opt/stipend
Environment=RPC_URL=https://your-rpc
Environment=PATH=/home/stipend/.nvm/versions/node/v22.22.0/bin:/home/stipend/.cargo/bin:/usr/bin
ExecStart=/home/stipend/.nvm/versions/node/v22.22.0/bin/pnpm ops cron
Restart=always
RestartSec=30

[Install]
WantedBy=multi-user.target
```

Or crontab (no loop, relies on idempotency):

```
*/10 * * * * cd /opt/stipend && RPC_URL=https://your-rpc pnpm --silent ops epoch run >> data/cron.log 2>&1
*/10 * * * * cd /opt/stipend && RPC_URL=https://your-rpc pnpm --silent ops epoch settle >> data/cron.log 2>&1
0 */6 * * *  cd /opt/stipend && RPC_URL=https://your-rpc pnpm --silent ops admin rebalance >> data/cron.log 2>&1
```

Logs: `data/ops.log` (every command appends).

## Creating an LST: what actually happens

`create-lst` runs `spl-stake-pool create-pool` (CLI 0.6.4 works against the current mainnet program), then the manager deposits 1.01 SOL so the reserve can cover the 1 SOL minimum delegation that `add-validator` moves into the validator stake account, then `add-validator` (staker), then token metadata (manager). Because the CLI uses the manager's token account as the fee account, that 1.01 LST is redeemed with the first epoch's fee and paid to holders (a launch bonus of about $100; verified on the fork). Fund the manager with about 1.5 SOL before running it.

## TVL history

`pnpm ops cron` samples every live pool into `tvl_history` hourly and after each epoch run (total lamports, supply, holders from the last snapshot, SOL price). `pnpm ops tvl` samples once and prints the latest rows. The site reads it for the callouts, `/api/tvl` and the chart on `/stats`; `docs/defillama/` has the DefiLlama adapter that consumes `/api/tvl`.

## Reserve and rebalancing

`admin rebalance` targets `max(reserve.targetBps × pool lamports, reserve.minSol)` liquid in the reserve:

- Reserve above target by ≥ 1 SOL → `increase-validator-stake` (activates next epoch).
- Reserve below target by ≥ 1 SOL → `decrease-validator-stake` (deactivates next epoch, lands in the reserve the epoch after).

The reserve must cover one epoch of fee redemption (≈ pool size × 5% / 146 ≈ 0.035% of TVL) plus whatever holders redeem. 3% (`targetBps: 300`) is generous; drop it as TVL grows. Run rebalance a few times a day; deposits sit unearning in the reserve until delegated.

`admin status` shows reserve, target and shortfall per LST. `admin treasury` shows worker and treasury balances in SOL and every asset.

## Fees

```bash
pnpm ops admin set-fee --lst nvdaSOL --kind sol-withdrawal --num 1 --den 1000
```

Kinds: `epoch`, `sol-withdrawal`, `stake-withdrawal`, `sol-deposit`, `stake-deposit`. Withdrawal fee increases are capped by the program (≤ 1.5× per epoch) and everything except deposit fees applies next epoch. Keep the SOL withdrawal fee ≥ 0.1%: a day of yield is ~0.02%, so mint-before-snapshot / redeem-after loses money.

## When something fails

- `keys/manager.json ... is not the pool manager` — the registry entry points at a pool created with a different manager key.
- Fee redemption redeems less than the fee tokens — reserve is short; run `admin rebalance` (or top up the reserve) and the rest is redeemed next epoch.
- `worker <asset> balance < distribution total` — the float is short; usually a swap recorded in the DB did not land or someone spent from the worker's asset account. Check `swaps` and the worker ATA, then rerun `epoch settle`.
- `distribution ... not closable until ...` — clawback not reached; `cron` retries `epoch settle` every tick.
- Jupiter `quote 4xx` — no route or amount too small; the epoch is carried when under `minSwapLamports`, otherwise it fails loudly and retries next tick (idempotent: the fee redemption and snapshot are not repeated).
- Crash between an on-chain send and the DB commit: `epoch run` resumes from the DB state (redemption, snapshot, swap, credit and distribution are each recorded before the next step starts). If a distribution was created on-chain but not recorded, close it manually with the seeds signer logged in `data/ops.log` — this is the one non-idempotent gap; it is logged before the send.
- Snapshot counts an AMM pool or vault as a holder: add its owner address to `snapshot.excludeOwners` in the registry. Excluded balances earn nothing (their share is simply not counted). Look-through to LP holders is not implemented.

## Verification done so far (no mainnet pools yet)

- Merkle leaf/tree ported from the program's tests, `node --test packages/core/dist/merkle.test.js` passes (4 tests, including odd leaf counts).
- PDA derivations (kit) checked equal to web3.js derivations for `event_authority` and `merkle_distribution`.
- `getPoolStats`, `buildDepositSol`, `buildWithdrawSol` exercised against the JitoSOL pool on mainnet.
- `assets sync` verified all nine menu mints on Jupiter and read their Token-2022 extensions on-chain.
- `create-lst --dry-run`, `admin status`, `epoch run --dry-run`, `proofs` run against mainnet with the draft registry.
- Not yet exercised with real value: `create-pool` via the CLI, fee redemption, a Jupiter swap, distribution create/close, direct payouts. Do the first epoch with a few SOL and `--dry-run` first.

## Production server

Production runs on a small VPS managed by Laravel Forge (any host with Node 22, pnpm and nginx works). The repo lives at `~/app` on the box, never in the Forge site directory, which Forge wipes when a site is created. The env file is `~/app/.env.production`. The web app runs as a Forge background process whose command is `deploy/prod-start-web.sh`; the Forge API has no restart endpoint, so `deploy/prod.sh` deletes and re-creates that process by command after each build. nginx on the box reverse-proxies the site's domains to `127.0.0.1:3000`. Host, Forge organisation and server id come from `deploy/.env.local` (see `deploy/.env.example`).

Certificates: Let's Encrypt via the Forge API (`POST .../sites/<site>/domains/<domain>/certificates` with `{type: letsencrypt, letsencrypt: {verification_method: http-01, key_type: ecdsa}}`). Issue them one at a time and wait for `installed`: requesting two hostnames at once left a half-installed certificate whose files nginx could not load, which broke every reload until it was deleted. Forge renews.

Worker: copy the keys to `~/app/keys` and add a second background process running `pnpm --silent ops cron` from `~/app`.
