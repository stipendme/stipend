import { parseArgs } from "node:util";
import { assetsSync } from "./commands/assets.js";
import { createLst } from "./commands/createLst.js";
import { epochRun, epochSettle } from "./commands/epoch.js";
import { adminStatus, adminUpdate, adminRebalance, adminSetFee, adminLive, adminTreasury } from "./commands/admin.js";
import { snapshotCmd, proofsCmd, cronCmd, tvlCmd } from "./commands/misc.js";
import { e2e } from "./commands/e2e.js";
import { testnetSetup, testnetStatus } from "./commands/testnet.js";
import { vanityGrind, vanityList, vanityTake } from "./commands/vanity.js";

const HELP = `stipend ops

  assets sync [--dry-run]                          verify the asset menu on Jupiter + chain, write draft LST entries
  create-lst --symbol nvdaSOL --mint-keypair keys/nvdasol-mint.json [--asset NVDAx] [--max-validators 4] [--dry-run]
  epoch run [--lst X] [--dry-run] [--force]         full per-epoch cycle for live LSTs
  epoch settle [--lst X] [--dry-run]                close previous merkle distributions + publish pending ones
  snapshot --lst X [--top 50]                       print current holders
  proofs --wallet W [--lst X]                       print open claim leaves for a wallet
  admin status [--lst X]
  admin update [--lst X] [--dry-run]
  admin rebalance [--lst X] [--dry-run]             move reserve to/from the validator per registry.reserve
  admin set-fee --lst X --kind epoch|sol-withdrawal|stake-withdrawal|sol-deposit|stake-deposit --num N --den D
  admin redeem-fees --lst X [--dry-run]
  admin live --lst X | admin pause --lst X
  admin treasury
  cron [--interval-sec 300]                         also samples TVL hourly into tvl_history
  tvl                                              sample TVL now and print the latest rows
  vanity grind --mode suffix|prefix|both [--count N] [--top N] [--max-prefix 4] [--tickers NVDA,AAPL,...] [--dry-run]
  vanity list | vanity take --ticker NVDA [--dry-run]
  e2e --symbol nvdaSOL [--keep] [--via ts|cli] [--verify-cli]   full rehearsal against a Surfpool fork (RPC_URL must be a surfnet)

env: RPC_URL, STIPEND_WORKER_KEY, STIPEND_MANAGER_KEY, STIPEND_STAKER_KEY, STIPEND_DB, PRIORITY_FEE_MICROLAMPORTS, JUPITER_API_KEY
`;

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2), allowPositionals: true,
    options: {
      lst: { type: "string" }, symbol: { type: "string" }, asset: { type: "string" }, "mint-keypair": { type: "string" }, "max-validators": { type: "string" },
      wallet: { type: "string" }, kind: { type: "string" }, num: { type: "string" }, den: { type: "string" }, top: { type: "string" }, "interval-sec": { type: "string" },
      "dry-run": { type: "boolean", default: false }, keep: { type: "boolean", default: false }, via: { type: "string" }, "verify-cli": { type: "boolean", default: false }, mode: { type: "string" }, count: { type: "string" }, targets: { type: "string" }, "max-prefix": { type: "string" }, ticker: { type: "string" }, tickers: { type: "string" }, force: { type: "boolean", default: false }, demo: { type: "boolean", default: false }, "skip-pools": { type: "boolean", default: false }, symbols: { type: "string" }, help: { type: "boolean", short: "h", default: false },
    },
  });
  const [cmd, sub] = positionals;
  const a = { lst: values.lst, symbol: values.symbol, asset: values.asset, mintKeypair: values["mint-keypair"], maxValidators: values["max-validators"], wallet: values.wallet, kind: values.kind, num: values.num, den: values.den, top: values.top, intervalSec: values["interval-sec"], dryRun: values["dry-run"], force: values.force, demo: values.demo };
  if (values.help || !cmd) { console.log(HELP); return; }
  const key = sub ? `${cmd} ${sub}` : cmd;
  switch (key) {
    case "assets sync": return assetsSync(a);
    case "create-lst": return createLst({ ...a, via: values.via as "cli" | "ts" | undefined });
    case "epoch run": return epochRun(a);
    case "epoch settle": return epochSettle(a);
    case "snapshot": return snapshotCmd(a);
    case "proofs": return proofsCmd(a);
    case "admin status": return adminStatus(a);
    case "admin update": return adminUpdate(a);
    case "admin rebalance": return adminRebalance(a);
    case "admin set-fee": return adminSetFee(a);
    case "admin redeem-fees": { const { makeCtx, pickLsts } = await import("./lib/ctx.js"); const { redeemFees } = await import("./commands/epoch.js"); const ctx = makeCtx({ dryRun: a.dryRun }); const [l] = pickLsts(ctx, a.lst, true); const e = (await ctx.conn.getEpochInfo()).epoch; return void (await redeemFees(ctx, l, e)); }
    case "admin live": return adminLive({ lst: a.lst });
    case "admin pause": return adminLive({ lst: a.lst, pause: true });
    case "admin treasury": return adminTreasury();
    case "cron": return cronCmd(a);
    case "testnet setup": return testnetSetup({ symbols: values.symbols, skipPools: values["skip-pools"] });
    case "testnet status": return testnetStatus();
    case "tvl": return tvlCmd();
    case "e2e": return e2e({ symbol: a.symbol, keep: values.keep, via: values.via as "cli" | "ts" | undefined, verifyCli: values["verify-cli"] });
    case "vanity grind": return vanityGrind({ mode: values.mode, count: values.count, targets: values.targets, top: values.top, maxPrefix: values["max-prefix"], tickers: values.tickers, dryRun: a.dryRun });
    case "vanity list": return vanityList();
    case "vanity take": return vanityTake({ ticker: values.ticker, dryRun: a.dryRun });
    default: console.log(HELP); process.exitCode = 1;
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
