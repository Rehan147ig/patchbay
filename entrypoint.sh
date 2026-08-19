#!/bin/sh
# Patchbay container entrypoint. Selects the process for this service:
#   APP_PROCESS=web    -> apply prisma migrations, then Next.js (`next start`)
#   APP_PROCESS=worker -> BullMQ worker (`tsx src/index.ts`)
# APP_PROCESS is the source of truth; RAILWAY_SERVICE_NAME is the fallback so
# a Railway service named "worker" works without extra configuration.
set -eu

# Every pnpm start script loads `dotenv -e ../../.env`. Railway injects the
# real values as environment variables, so an empty file is enough: dotenv
# never overrides variables that are already set.
if [ ! -f .env ]; then
  touch .env
fi

process="${APP_PROCESS:-${RAILWAY_SERVICE_NAME:-web}}"

case "$process" in
  web)
    echo "[entrypoint] applying prisma migrations (migrate deploy)"
    pnpm db:migrate
    echo "[entrypoint] starting web (next start on PORT=${PORT:-3000})"
    exec pnpm --filter @patchbay/web start
    ;;
  worker)
    echo "[entrypoint] starting worker (BullMQ consumer)"
    exec pnpm --filter @patchbay/worker start
    ;;
  *)
    echo "[entrypoint] unknown APP_PROCESS '$process' (expected 'web' or 'worker'); refusing to start" >&2
    exit 1
    ;;
esac
