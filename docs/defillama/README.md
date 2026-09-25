# DefiLlama listing

`stipend.js` is a TVL adapter in the format of [DefiLlama/DefiLlama-Adapters](https://github.com/DefiLlama/DefiLlama-Adapters).

To submit:

1. Fork the adapters repo, copy `stipend.js` to `projects/stipend/index.js`.
2. Run `node test.js projects/stipend/index.js` in the fork; it should print the SOL total that `https://stipend.my/api/tvl` reports.
3. Open a PR titled "Add Stipend" with the project description, website, Twitter and a link to the docs page. DefiLlama also asks for the category (Liquid Staking) and the chain (Solana).
4. Once merged, submit the listing form at defillama.com/submit-project if the reviewers ask for it.

`/api/tvl` returns `{ totalSol, totalUsd, byAsset: [{ symbol, assetSymbol, sol, usd }], updatedAt, source }`; `source` is `history` when the worker's hourly sample is used and `live` when read straight from the pools. The hourly samples live in the `tvl_history` table and drive the chart on `/stats`.

If reviewers prefer an on-chain read, the stake pool addresses are in `config/registry.json` and each pool's TVL is the `total_lamports` u64 at byte offset 258 of the stake pool account.
