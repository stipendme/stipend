#!/usr/bin/env bash
# rsync the repo to the staging box and rebuild the web container (docker compose, see deploy/docker-compose.yml).
#   deploy/sync.sh              # rsync + rebuild + restart web
#   deploy/sync.sh --no-build   # rsync + restart only
#   deploy/sync.sh --sync-only
# Host settings come from the environment or a git-ignored deploy/.env.local (see deploy/.env.example):
#   STIPEND_SSH_HOST (user@host, required), STIPEND_SSH_PORT (default 22), STIPEND_REMOTE_DIR (default stipend),
#   STIPEND_PROJECT (compose project, default stipend-staging)
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[[ -f "$REPO_ROOT/deploy/.env.local" ]] && { set -a; . "$REPO_ROOT/deploy/.env.local"; set +a; }
SSH_HOST="${STIPEND_SSH_HOST:?set STIPEND_SSH_HOST (user@host) in deploy/.env.local}"
SSH_PORT="${STIPEND_SSH_PORT:-22}"
REMOTE_DIR="${STIPEND_REMOTE_DIR:-stipend}"
PROJECT="${STIPEND_PROJECT:-stipend-staging}"
build=1; sync=1
for arg in "$@"; do case "$arg" in --no-build) build=0;; --sync-only) build=0; sync=0;; *) echo "unknown flag: $arg" >&2; exit 2;; esac; done
echo "==> rsync -> $SSH_HOST:~/$REMOTE_DIR"
rsync -az --delete -e "ssh -p $SSH_PORT -o BatchMode=yes" \
  --exclude '.git/' --exclude 'node_modules/' --exclude '.next/' --exclude 'dist/' \
  --exclude 'keys/' --exclude 'data/' --exclude 'private/' --exclude 'deploy/.env' --exclude 'deploy/.env.local' --exclude '*.log' --exclude 'docs/screenshots/' --exclude 'tools/vanity/upstream/' --exclude 'tools/vanity/work/' \
  "$REPO_ROOT/" "$SSH_HOST:$REMOTE_DIR/"
if [[ -d "$REPO_ROOT/keys/devnet" ]]; then
  echo "==> rsync keys/devnet"
  rsync -az -e "ssh -p $SSH_PORT -o BatchMode=yes" "$REPO_ROOT/keys/devnet/" "$SSH_HOST:$REMOTE_DIR/keys/devnet/"
fi
[[ $sync -eq 0 ]] && { echo "==> sync only"; exit 0; }
up="up -d --remove-orphans --force-recreate web"; [[ $build -eq 1 ]] && up="up -d --remove-orphans --build --force-recreate web"
ssh -p "$SSH_PORT" -o BatchMode=yes "$SSH_HOST" "cd $REMOTE_DIR && mkdir -p data keys && docker compose -p $PROJECT -f deploy/docker-compose.yml $up && docker compose -p $PROJECT -f deploy/docker-compose.yml ps"
