#!/usr/bin/env bash
# Entry point for the production web process (run by the process supervisor). Resolves the repo from its own location.
set -euo pipefail
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
set -a; . "$APP_DIR/.env.production"; set +a
cd "$APP_DIR/apps/web"
exec "$APP_DIR/apps/web/node_modules/.bin/next" start -p "${PORT:-3000}" -H 127.0.0.1
