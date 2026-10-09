#!/bin/sh
# Container entrypoint: apply pending migrations (safe, idempotent), then start.
set -e
if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  node scripts/migrate.js
fi
exec node server.js
