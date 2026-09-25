# Jupiter routing for low-cap LSTs (2026-09-17)

Sample from the Sanctum LST list (241 pools with on-chain TVL; 138 under 100 SOL, 37 in 100–1,000, 25 in 1k–10k, 18 in 10k–100k, 23 above). Quotes from Jupiter lite-api at 10 and 100 SOL each way; 'vs fair' compares the quote to the pool's on-chain exchange rate. DEX liquidity from DexScreener.

| LST | program | TVL SOL | buy 100 vs fair | buy route | sell 100 vs fair | sell route | DEX liq USD |
|---|---|---:|---:|---|---:|---|---:|
| elSOL | Spl | 1,830 | -0.0% | Sanctum:100% | -0.118% | VaultLiquidUnstake:100% | 0 |
| daoSOL | Spl | 869 | -0.0% | Sanctum:100% | -0.332% | VaultLiquidUnstake:100% | 14,281 |
| edgeSOL | Spl | 1,073 | 0.01% | Meteora:22% Sanctum:78% | -0.132% | VaultLiquidUnstake:99% Sanctum:1% | 12,364 |
| laineSOL | Spl | 12,084 | -0.0% | Sanctum:100% | -0.132% | VaultLiquidUnstake:100% | 0 |
| xandSOL | Spl | 4,947 | -0.0% | Sanctum:100% | -0.117% | Sanctum:70% VaultLiquidUnstake:30% | 0 |
| sentSOL | Spl | 3,626 | -0.05% | Sanctum:100% | -0.583% | Sanctum Infinity:100% Meteora DLMM:100% | 0 |
| cgntSOL | Spl | 2,559 | -0.1% | Sanctum:100% | -0.032% | VaultLiquidUnstake:100% | 0 |
| clockSOL | SanctumSpl | 1,364 | -0.0% | Sanctum:100% | -0.132% | VaultLiquidUnstake:100% | 0 |
| MonkeSOL | SanctumSpl | 1,658 | -0.0% | Sanctum:100% | -0.132% | VaultLiquidUnstake:100% | 0 |
| stepSOL | SanctumSpl | 286 | -0.0% | Sanctum:100% | -0.132% | VaultLiquidUnstake:100% | 25 |
| rSOL | SanctumSpl | 194 | -0.0% | Sanctum:100% | -0.132% | VaultLiquidUnstake:100% | 0 |
| digitSOL | SanctumSpl | 2,681 | -0.0% | Sanctum:100% | -0.132% | VaultLiquidUnstake:100% | 0 |
| haSOL | SanctumSpl | 43,792 | -0.0% | Sanctum:100% | -0.132% | VaultLiquidUnstake:100% | 0 |
| iASOL | SanctumSpl | 18,376 | -0.0% | Sanctum:100% | -0.132% | VaultLiquidUnstake:100% | 0 |
| kateSOL | SanctumSplMulti | 131 | -0.0% | Sanctum:100% | -0.132% | VaultLiquidUnstake:100% | 0 |
| gotmSOL | SanctumSplMulti | 1,605 | -0.0% | Sanctum:100% | -0.118% | VaultLiquidUnstake:100% | 0 |
| joeSOL | SanctumSplMulti | 155 | -0.0% | Sanctum:100% | -0.132% | VaultLiquidUnstake:100% | 0 |
| hyloSOL+ | SanctumSplMulti | 11,199 | -0.05% | Sanctum:100% | -0.068% | VaultLiquidUnstake:100% | 2 |
| uptSOL | SanctumSplMulti | 2,538 | -0.0% | Sanctum:100% | -0.118% | VaultLiquidUnstake:100% | 0 |
| phaseSOL | SanctumSplMulti | 21,400 | -0.0% | Sanctum:100% | -0.118% | VaultLiquidUnstake:100% | 0 |
| PSOL | Spl | 1,622,487 | 0.054% | Riptide:8% Manifest:92% | -0.063% | Whirlpool:21% Riptide:7% Manifest:72% | 1,958,677 |
| JitoSOL | Spl | 10,333,142 | 0.024% | AlphaQ:10% Manifest:90% | -0.025% | Manifest:95% AlphaQ:5% | 15,081,834 |

Program IDs SPoo1Ku8… (SPL), SP12tWFx… (Sanctum SPL) and SPMBzsVU… (Sanctum SPL Multi) all carry the Jupiter label `Sanctum`, i.e. the Sanctum router handles deposit-SOL / withdraw-stake for all three identically. Sells route through `VaultLiquidUnstake` (2rU1oCHt…), a liquid-unstake vault that takes the withdrawn stake account and pays SOL, at 0.118–0.132% all-in with no price impact at 100 SOL. Large sells (5,000+) fall back to Sanctum Infinity at ~0.15–0.16%. Big LSTs (JitoSOL, PSOL) route through AMMs instead because those are cheaper (0.02–0.06%).

Buy-side deviations are the pools' own SOL deposit fees (cgntSOL 0.1%, sentSOL and hyloSOL+ 0.05%), not slippage.

Implication for Stipend: a 1:1 LST with no DEX pool gets par buys and ~0.13% sells on Jupiter as soon as it is on the sanctum-lst-list (PR to igneous-labs/sanctum-lst-list). Our own 0.1% SOL withdrawal fee is cheaper than the router sell while the reserve has liquidity.
