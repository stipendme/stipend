#!/usr/bin/env bash
# Deploy to the production VPS (a Laravel Forge server): rsync, install, build, restart the web process.
#   deploy/prod.sh            # full deploy
#   deploy/prod.sh --sync-only
# Settings come from the environment or a git-ignored deploy/.env.local (see deploy/.env.example):
#   STIPEND_PROD_HOST        ssh target for the VPS (e.g. forge@<ip>), required
#   STIPEND_PROD_URL         URL to poll after restart (e.g. http://<ip>/), required
#   STIPEND_PROD_HOSTNAME    Host header for that poll (e.g. stipend.my), required
#   FORGE_API_HOST           ssh target of the machine holding the Forge API token, required
#   FORGE_API_SSH_PORT       its ssh port (default 22)
#   FORGE_TOKEN_FILE         path of the token file on that machine (default ~/forge-token)
#   FORGE_ORG, FORGE_SERVER_ID   Forge organisation slug and server id, required
# Layout on the box: repo at ~/app (never the Forge site directory, which Forge wipes on site creation), env in
# ~/app/.env.production, the web process is a Forge background process running deploy/prod-start-web.sh. The Forge API
# has no restart endpoint, so the process is deleted and re-created by command.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[[ -f "$REPO_ROOT/deploy/.env.local" ]] && { set -a; . "$REPO_ROOT/deploy/.env.local"; set +a; }
HOST="${STIPEND_PROD_HOST:?set STIPEND_PROD_HOST in deploy/.env.local}"
PROD_URL="${STIPEND_PROD_URL:?set STIPEND_PROD_URL in deploy/.env.local}"
PROD_HOSTNAME="${STIPEND_PROD_HOSTNAME:?set STIPEND_PROD_HOSTNAME in deploy/.env.local}"
rsync -az --delete -e "ssh -o BatchMode=yes" \
  --exclude '.git/' --exclude 'node_modules/' --exclude '.next/' --exclude 'dist/' --exclude 'keys/' --exclude 'data/' --exclude 'private/' \
  --exclude 'deploy/.env' --exclude 'deploy/.env.local' --exclude '.env.production' --exclude '*.log' --exclude 'docs/screenshots/' \
  --exclude 'tools/vanity/upstream/' --exclude 'tools/vanity/work/' \
  "$REPO_ROOT/" "$HOST:app/"
[[ "${1:-}" == "--sync-only" ]] && exit 0
ssh -o BatchMode=yes "$HOST" 'cd ~/app && export PATH=$HOME/.local/bin:$PATH && set -a && . .env.production && set +a && pnpm install --frozen-lockfile 2>&1 | tail -1 && pnpm --filter @solana/rewards --filter @stipend/core --filter @stipend/ops --filter @stipend/web build 2>&1 | grep -E "error|Failed|web build: Done"'
API_HOST="${FORGE_API_HOST:?set FORGE_API_HOST in deploy/.env.local}"
API_PORT="${FORGE_API_SSH_PORT:-22}"
TOKEN_FILE="${FORGE_TOKEN_FILE:-~/forge-token}"
ORG="${FORGE_ORG:?set FORGE_ORG in deploy/.env.local}"
SERVER="${FORGE_SERVER_ID:?set FORGE_SERVER_ID in deploy/.env.local}"
APP_HOME="$(ssh -o BatchMode=yes "$HOST" 'cd ~/app && pwd')"
ssh -p "$API_PORT" -o BatchMode=yes "$API_HOST" "T=\$(tr -d '\n\r ' < $TOKEN_FILE); S='https://forge.laravel.com/api/orgs/$ORG/servers/$SERVER'; APP='$APP_HOME'; "'H1="Authorization: Bearer $T"; H2="Accept: application/vnd.api+json";
  for id in $(curl -s -m 30 -H "$H1" -H "$H2" "$S/background-processes" | python3 -c "import json,sys;[print(d[\"id\"]) for d in json.load(sys.stdin)[\"data\"] if d[\"attributes\"][\"command\"].endswith(\"prod-start-web.sh\")]"); do curl -s -m 60 -X DELETE -o /dev/null -w "delete $id -> %{http_code}\n" -H "$H1" -H "$H2" "$S/background-processes/$id"; done; sleep 20;
  for try in 1 2 3 4; do code=$(curl -s -m 60 -X POST -o /dev/null -w "%{http_code}" -H "$H1" -H "$H2" -H "Content-Type: application/json" -d "{\"name\":\"stipend-web\",\"command\":\"$APP/deploy/prod-start-web.sh\",\"user\":\"forge\",\"processes\":1,\"directory\":\"$APP/apps/web\"}" "$S/background-processes"); echo "create (try $try) -> $code"; case "$code" in 201|202) break;; esac; sleep 15; done'
for i in $(seq 1 50); do sleep 3; curl -s -o /dev/null -w "%{http_code}" -m 10 -H "Host: $PROD_HOSTNAME" "$PROD_URL" | grep -q 200 && { echo "web up"; exit 0; }; done
echo "web did not come back; check the Forge daemon log on the box" >&2; exit 1
