#!/usr/bin/env bash
# Fill the vanity bank: cheap prefix keys for every target, then the flagship <TICKER>...stip set (days of GPU).
set -uo pipefail
cd "$(dirname "$0")/../.."
source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1
FLAGSHIP="${FLAGSHIP:-NVDA,AAPL,TSLA,SPY,GOOG,MSTR,GLD,AMZN,MSFT,META,QQQ,COIN,HOOD,AMD,PLTR,NFLX,CRCL,SLV,JTO,JUP,BONK,WIF,ORE,JLP}"
echo "=== $(date -u +%FT%TZ) prefix pass"
pnpm --silent ops vanity grind --mode prefix --count 1 2>&1 | sed 's/\x1b\[[0-9;]*[A-Za-z]//g' | grep -E "^mode|^batch|^bank|^skipped|panicked|ingested"
echo "=== $(date -u +%FT%TZ) both pass (flagship: $FLAGSHIP)"
pnpm --silent ops vanity grind --mode both --count 1 --tickers "$FLAGSHIP" 2>&1 | sed 's/\x1b\[[0-9;]*[A-Za-z]//g; s/\r/\n/g' | grep -E "^mode|^batch|^bank|match:|ingested|panicked|attempts/sec" | awk 'NR%200==1 || !/attempts\/sec/'
echo "=== $(date -u +%FT%TZ) done"
