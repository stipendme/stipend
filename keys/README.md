Keypairs live here and are git-ignored.

- `manager.json`    stake pool manager (fee receiver authority). Put this on a Squads multisig before mainnet TVL.
- `staker.json`     stake pool staker (rebalancer). Hot key on the ops box.
- `worker.json`     epoch worker: receives redeemed fee SOL, swaps, funds distributions. Hot key on the ops box.
- `<symbol>-mint.json`  vanity mint keypair for each LST (e.g. `nvdasol-mint.json`).
