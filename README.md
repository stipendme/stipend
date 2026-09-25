# Stipend

Stake SOL. Get paid in stocks.

Each Stipend LST (nvdaSOL, aaplSOL, goldSOL, ...) is an SPL stake pool token pinned 1:1 to SOL. The pool keeps 100% of staking yield as its fee, and every epoch that yield is swapped into the LST's asset and sent straight to the wallets that held the LST at the epoch boundary. The LST stays in your wallet the whole time.

- `docs/ARCHITECTURE.md`  how it works, which programs, the cumulative merkle rollover
- `docs/DECISIONS.md`     what was chosen and what was rejected, with reasons
- `docs/OPS.md`           runbook: keys, creating an LST, epoch worker, rebalancing
- `docs/BRAND.md`         name, domain, voice
- `config/registry.json`  single source of truth for LSTs, fees, validator
- `packages/core`         chain library shared by ops and web
- `packages/rewards-client` vendored Codama client for the Solana Foundation rewards program
- `apps/ops`              CLI: create-lst, epoch worker, admin tools
- `apps/web`              Next.js site: browse, mint, redeem, calculator, stats, self-serve launch, admin
- `docs/TESTNET.md`       running the devnet demo with a faucet and hourly demo epochs

## Running locally

Requirements: Node 22 (`nvm use` reads `.nvmrc`; better-sqlite3 has no Node 21 build), pnpm 8, and a Solana RPC that serves `getProgramAccounts` (the public endpoint rate-limits it).

```bash
pnpm install
pnpm -r build
cp apps/web/.env.example apps/web/.env.local   # set RPC_URL and NEXT_PUBLIC_RPC_URL
pnpm web                                        # http://localhost:3000, reads config/registry.json
```

Ops CLI (keys live in the git-ignored `keys/` directory; see `docs/OPS.md`):

```bash
RPC_URL=<your rpc> pnpm ops admin status
RPC_URL=<your rpc> pnpm ops epoch run --dry-run
```

Devnet demo with test assets, a faucet and hourly demo epochs: see `docs/TESTNET.md`. Fork rehearsal of the whole lifecycle against a Surfpool mainnet fork: `RPC_URL=<surfnet> pnpm ops e2e --symbol nvdaSOL`.

Deploying: `deploy/docker-compose.yml` for a container host behind caddy-docker-proxy, `deploy/prod.sh` for a Forge-managed VPS; both read their hosts from a git-ignored `deploy/.env.local` (template in `deploy/.env.example`).
