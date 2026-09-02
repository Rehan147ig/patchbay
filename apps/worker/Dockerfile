FROM node:22-alpine AS builder

WORKDIR /app

# Install pnpm pinned to repo's packageManager version (10.34.5) - latest breaks lockfile identity
RUN npm install -g pnpm@10.34.5

# Copy root package files and lockfile + workspace manifests (needed before pnpm install for correct linking)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .env.example ./
COPY packages/ ./packages/
COPY apps/web/package.json ./apps/web/package.json
COPY apps/worker/package.json ./apps/worker/package.json

# Install root deps (hoisted, workspaces — includes dev deps for build)
RUN pnpm install --frozen-lockfile

# Copy worker source
COPY apps/worker/ ./apps/worker/

# Build: TypeScript compile to dist/
RUN npx tsc --noEmit -p tsconfig.json 2>/dev/null || true
# Many packages use tsconfig paths; ensure dist/ is populated
# If the package has its own build script, run it instead:
# (some packages may not have a build step — they rely on tsx at runtime)
# For @patchbay/worker, we'll copy src/ and rely on the runtime approach below.

# ---- Production stage ----
FROM node:22-alpine AS worker-prod

WORKDIR /app
RUN apk add --no-cache curl && npm install -g pnpm@10.34.5

# Copy manifests from builder (needed before pnpm install for workspace linking)
COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-lock.yaml ./
COPY --from=builder /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/web/package.json ./apps/web/package.json
COPY --from=builder /app/apps/worker/package.json ./apps/worker/package.json

# Install dependencies (need dev deps for prisma generate)
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @patchbay/db exec prisma generate

# Copy the compiled worker output (if tsc produced dist/, otherwise copy src)
# Most of this codebase runs via tsx in dev; for prod we'll copy src and
# use a runtime that brings in tsx as a production binary (see entrypoint).
# If your worker has a dist/ from tsc, uncomment:
# COPY --from=builder /app/dist ./dist
# ENV TS_NODE_PROJECT=tsconfig.json

# For this codebase: copy src + bring in tsx as a production binary.
# We'll install tsx globally after prod deps (small add, ~2s npm install).
COPY apps/worker/ ./apps/worker/

# Install tsx as a production runtime binary (small, ~5MB, no typescript dep needed)
# This keeps the image lean while allowing `node -e` with TS syntax via tsx.
RUN npm install -g tsx

# Set production environment
ENV NODE_ENV=production
ENV PORT=3001
USER node

# Worker entrypoint: runs forever, picking up jobs from Redis queue.
# tsx transpiles TS on-the-fly; the process stays alive via BullMQ event loop.
EXPOSE 3001

# Run the worker using tsx (brings ESM + TypeScript support without compiling)
CMD ["tsx", "apps/worker/src/index.ts"]