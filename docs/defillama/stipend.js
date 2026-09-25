// DefiLlama TVL adapter for Stipend. Drop this file at projects/stipend/index.js in DefiLlama/DefiLlama-Adapters.
//
// Stipend LSTs are SPL stake pools (program SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy) that keep 100% of the staking
// yield as their epoch fee and pay it to holders in another asset. TVL is the SOL delegated through those pools.
// The site publishes the current figure at /api/tvl; the pool addresses are also on chain, listed in the site's
// registry (config/registry.json), for adapters that prefer to read stake pool accounts directly.

const { get } = require("../helper/http");
const { sumTokens2 } = require("../helper/solana");

const API = "https://stipend.my/api/tvl";
const SOL = "So11111111111111111111111111111111111111112";

async function tvl(api) {
  const data = await get(API);
  // byAsset[].sol is SOL delegated through each pool (pool total_lamports / 1e9)
  const lamports = data.byAsset.reduce((sum, a) => sum + Math.round(a.sol * 1e9), 0);
  api.add(SOL, lamports);
  return sumTokens2({ api });
}

module.exports = {
  timetravel: false,
  methodology: "SOL held by Stipend's SPL stake pools (reserve + delegated stake), read from the project API which samples the pool accounts hourly. Each pool's total is also readable on chain from the stake pool account's total_lamports field.",
  solana: { tvl },
  hallmarks: [],
};
