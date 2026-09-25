# Self-service LST launch

`/launch` lets anyone create a Stipend pool for an eligible asset. The result is an ordinary SPL stake pool (program `SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy`), identical to one created with the CLI, paying its holders in the chosen asset every epoch.

## Who signs what

Every transaction is built server-side by `packages/core/src/launch.ts` (instruction layouts ported from the program and verified byte-for-byte against the CLI on a Surfpool fork with `pnpm ops e2e --via ts --verify-cli`).

| step | instructions | backend signs | user signs |
|---|---|---|---|
| accounts | create reserve stake (+ stake Initialize), create mint (+ InitializeMint2, decimals 9, authority = pool withdraw PDA), manager fee ATA | reserve kp, mint kp | fee payer |
| initialize | create pool account (611 B), create validator list (9 + 73×max B), stake pool Initialize | pool kp, list kp, manager | fee payer |
| seed | create the user's LST ATA, DepositSol of `launch.seedLamports` (1.01 SOL) | – | fee payer, depositor |
| configure | SetFee SolWithdrawal (and SolDeposit if > 0), AddValidatorToPool | manager, staker | fee payer |
| metadata | CreateTokenMetadata | manager | fee payer |

The user is fee payer on all five and pays the rent and the seed; the seed comes back as the first LST minted. The backend never spends SOL. The one-shot keypairs (mint, pool, validator list, reserve) are stored in the `launches` table until the launch completes; they have no power after creation (the mint authority is the pool PDA).

## Blockhash expiry

The API signs a step only when the browser asks for it (`POST /api/launch/refresh`), immediately before the wallet prompt. If the user sits on the prompt past expiry, submit returns `409 expired` and the client fetches a fresh transaction for the same step. Steps are idempotent: the `launches` row records the step index and signatures, and a launch can resume after a browser crash by calling refresh with the same id.

## API

- `GET  /api/launch/assets` → curated menu (tokens.xyz `stocks`, `metals`, `majors` via `TOKENS_XYZ_KEY`, plus registry assets), quote (costs, creator share), existing symbols.
- `POST /api/launch/prepare` `{ assetMint, symbol, creator }` → `{ id, steps, addresses, costs }`. Validates: symbol `/^[a-z0-9]{2,8}SOL$/i` and unique; one LST per asset; asset on a curated list or Jupiter-verified with ≥ `launch.minJupLiquidityUsd`; no freeze authority; no active transfer-hook program (an unset hook, as on xStocks, is fine); Token-2022 transfer fees allowed and recorded. Takes a vanity mint from the bank (`takeVanityKey`) when one matches the ticker, else a random key.
- `POST /api/launch/refresh` `{ id }` → current step tx (base64, backend-signed, fresh blockhash).
- `POST /api/launch/submit` `{ id, tx }` → sends, confirms, advances; on the last step writes the registry entry (`status: live`, `delivery: direct`, `creator`, `creatorFeeBps`, `launchTx`).
- `GET  /api/launch/status?id=` → step / signatures.

Returns `503 launch disabled` when `keys/manager.json` or `keys/staker.json` (or `STIPEND_MANAGER_KEY` / `STIPEND_STAKER_KEY`) are missing.

## Creator share and rent (worker)

Each epoch, `creatorFeeBps` (default `launch.creatorFeeBps` = 50%) of the pool's platform fee is sent to `creator` in SOL (`creator_payouts`). Holder token-account rent follows `registry.rent`: the platform funds a holder's first account once per (lst, wallet) inside a per-epoch budget of `rentBudgetBpsOfFee` of the fee, largest balances first; unspent budget goes to the treasury; a holder who closes a funded account is recreated only from their own accrual (rent converted to asset units at the epoch fill, `funded_accounts.closures` incremented, `rent_ledger` row `funded_by = holder`). Program-owned (off-curve) holders accrue and are never paid. Rent is read from RPC every epoch.

## Ops equivalent

`pnpm ops create-lst --symbol x --mint-keypair keys/x-mint.json --via ts` runs the same builders with the manager as payer.
