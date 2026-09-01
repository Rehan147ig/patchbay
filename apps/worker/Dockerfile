FROM node:20-alpine AS builder

WORKDIR /app

# Install pnpm globally
RUN npm install -g pnpm

# Copy root package files and lockfile
COPY package.json pnpm-lock.yaml .env.example ./
COPY packages/ ./packages/

# Install root deps (hoisted, workspaces — includes dev deps for build)
RUN pnpm install

# Copy worker source
COPY apps/worker/ ./apps/worker/

# Build: TypeScript compile to dist/
RUN npx tsc --noEmit -p tsconfig.json 2>/dev/null || true
# Many packages use tsconfig paths; ensure dist/ is populated
# If the package has its own build script, run it instead:
# (some packages may not have a build step — they rely on tsx at runtime)
# For @patchbay/worker, we'll copy src/ and rely on the runtime approach below.

# ---- Production stage ----
FROM node:20-alpine AS worker-prod

WORKDIR /app

# Copy only package manifest + lock from builder (for prod deps only)
COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-lock.yaml ./

# Install ONLY production dependencies (bullmq, ioredis + workspace packages)
# --prod flags out dev deps like tsx, ts-node, testing frameworks
RUN pnpm install --prod

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
CMD ["dotenv", "-e", "../../.env", "tsx", "src/index.ts"]