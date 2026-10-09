# syntax=docker/dockerfile:1
# Taash — one container: Next.js + Socket.IO on one port (3000).
# Build:  docker build -t taash .
# Run:    docker run -p 3000:3000 --env-file .env taash

ARG NODE_IMAGE=node:22-alpine

# ---- 1. dependencies (all, for building) ---------------------------------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---- 2. build -------------------------------------------------------------
FROM ${NODE_IMAGE} AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build && rm -rf .next/cache

# ---- 3. production dependencies only --------------------------------------
FROM ${NODE_IMAGE} AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force \
 # Build-time only: compilers, image optimiser (unused), test runner, type packages.
 && rm -rf node_modules/@next/swc-* node_modules/@img node_modules/sharp \
           node_modules/playwright node_modules/playwright-core node_modules/@playwright \
           node_modules/@types node_modules/typescript

# ---- 4. runtime -----------------------------------------------------------
FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOST=0.0.0.0 \
    RUN_MIGRATIONS=true
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --chown=node:node package.json next.config.mjs server.js ./
COPY --chown=node:node public ./public
# Modules the custom server imports directly (realtime, game engine, db, auth).
COPY --chown=node:node lib ./lib
COPY --chown=node:node games ./games
COPY --chown=node:node components/game/card-model.js ./components/game/card-model.js
COPY --chown=node:node scripts ./scripts
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/healthz >/dev/null || exit 1
CMD ["sh", "scripts/start.sh"]
