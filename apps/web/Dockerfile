FROM node:20-alpine AS builder

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy root package files and lockfile
COPY package.json pnpm-lock.yaml .env.example ./
COPY packages/ ./packages/

# Install root deps (hoisted, workspaces)
RUN pnpm install

# Copy apps/web source
COPY apps/web/ ./apps/web/

# Build Next.js app
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
RUN --mount=type=cache --mount=type=bind,from=node:20-alpine pnpm --filter @patchbay/web build

# Production stage
FROM node:20-alpine AS web-prod

WORKDIR /app

# Copy only compiled output from builder
COPY --from=builder /app/.pnpm/.public-resolver-map.json /app/.pnpm/.public-resolver-map.json 2>/dev/null || true
COPY --from=builder /app/apps/web/.next/stand ./ .next/stand
COPY --from=builder /app/apps/web/package.json ./
COPY --from=builder /app/apps/web/tsconfig.json ./

# Install only production deps (no dev deps)
RUN pnpm install --prod

# Set non-root user (security)
ENV NODE_ENV=production
ENV PORT=3000
USER node

EXPOSE 3000

CMD ["node", ".next/stand/server.js"]