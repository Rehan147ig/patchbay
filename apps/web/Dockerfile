FROM node:22-alpine AS builder

WORKDIR /app

# Install pnpm pinned to repo's packageManager version (10.34.5) - latest breaks lockfile identity
RUN npm install -g pnpm@10.34.5

# Copy root package files and lockfile + workspace manifests (needed before pnpm install for correct linking)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .env.example ./
COPY packages/ ./packages/
COPY apps/web/package.json ./apps/web/package.json
COPY apps/worker/package.json ./apps/worker/package.json

# Install root deps (hoisted, workspaces)
RUN pnpm install --frozen-lockfile

# Copy apps/web source
COPY apps/web/ ./apps/web/

# Build Next.js app
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
# Ensure .env exists for dotenv (copy example if missing) and generate Prisma client
RUN cp .env.example .env 2>/dev/null || true; pnpm --filter @patchbay/db exec prisma generate 2>/dev/null || true
RUN pnpm --filter @patchbay/web build

# Production stage
FROM node:22-alpine AS web-prod

WORKDIR /app
RUN npm install -g pnpm@10.34.5

COPY --from=builder /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/pnpm-workspace.yaml ./pnpm-workspace.yaml

# Copy only compiled output from builder
COPY --from=builder /app/apps/web/.next/standalone ./standalone
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/package.json ./
COPY --from=builder /app/apps/web/tsconfig.json ./

# Standalone already contains traced deps, no need for pnpm install --prod

# Set non-root user (security)
ENV NODE_ENV=production
ENV PORT=3000
USER node

EXPOSE 3000

CMD ["node", "standalone/apps/web/server.js"]