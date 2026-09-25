# syntax=docker/dockerfile:1
# Stipend: one image for the site and the ops CLI (the worker is the same code, different command).
FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1 NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@8.15.3 --activate
WORKDIR /repo

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/rewards-client/package.json packages/rewards-client/
COPY apps/ops/package.json apps/ops/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,id=stipend-pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

FROM deps AS build
# NEXT_PUBLIC_* is inlined into the client bundle at build time.
ARG NEXT_PUBLIC_RPC_URL=https://api.mainnet-beta.solana.com
ARG NEXT_PUBLIC_ADMIN_WALLETS=
ARG NEXT_PUBLIC_NETWORK=mainnet-beta
ENV NEXT_PUBLIC_RPC_URL=$NEXT_PUBLIC_RPC_URL NEXT_PUBLIC_ADMIN_WALLETS=$NEXT_PUBLIC_ADMIN_WALLETS NEXT_PUBLIC_NETWORK=$NEXT_PUBLIC_NETWORK NODE_ENV=production
COPY . .
RUN pnpm -r build

FROM build AS runtime
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 TZ=UTC \
    REGISTRY_PATH=/repo/config/registry.json STIPEND_REGISTRY=/repo/config/registry.json \
    DB_PATH=/repo/data/stipend.db STIPEND_DB=/repo/data/stipend.db
RUN mkdir -p /repo/data /repo/keys && chown -R node:node /repo/data /repo/keys /repo/config
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/lsts').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
WORKDIR /repo/apps/web
CMD ["node_modules/.bin/next", "start", "-p", "3000"]
