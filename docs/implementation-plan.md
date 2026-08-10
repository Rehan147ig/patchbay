# Patchbay - Implementation Plan

Phases must be completed in order; each phase ends with format/lint/typecheck/test green and
README updated. Status legend: [x] done, [ ] pending.

## Phase 0 - Repository foundation [x]

- [x] pnpm monorepo workspace, root tooling (ESLint 9 flat, Prettier, strict TS base, Vitest)
- [x] docker-compose (Postgres 16, Redis 7) with healthchecks
- [x] `.env.example`, root `.env` convention with `dotenv-cli`
- [x] docs: AGENTS.md, README, product-requirements, architecture, threat-model, demo-script, ADRs
- [x] CI workflow (format, lint, typecheck, test, migrate+seed, build)
- [x] Package skeleton for all planned packages

## Phase 1 - Domain and demo data [x]

- [x] Prisma schema (full domain model), committed SQL migration
- [x] Seed: Acme SaaS org, users, vendors, policies, repositories, scans/usages, historical audit
- [x] `packages/domain`: enums (single source of truth), Zod schemas, errors, JSON logger
- [x] `packages/audit`: audit event helpers, redaction, drift test vs Prisma enums
- [x] `packages/db`: client singleton, generate/migrate/seed/reset scripts
- [x] Dashboard shell: layout/nav, overview, repositories, changes, remediations, policies,
      audit, settings, login; typed GET API + health; policy toggle mutation
- [x] (`demo` route ships with Phase 3's demo engine)

## Phase 2 - Repository analysis [x]

- [x] fixture repositories (stripe/openai/twilio/generic) with lockfiles
- [x] `repo-analysis`: package/lockfile parsing, TS AST indexing (imports, init, calls, endpoint
      strings, config, webhooks), usage records, risk tags, owner hints
- [x] scan API (`POST /api/repositories/:id/scan`) + worker job + UI wiring
- [x] analyzer tests against all fixture repos

## Phase 3 - Vendor changes and impact assessment [x]

- [x] `VendorConnector` interface + `connectors` registry
- [x] OpenAI connector first (ingest/normalize/detect/generate patch/risk tags)
- [x] NormalizedChange persistence; change detail UI
- [x] Scoring engine (impact 0-100, confidence 0-100, rationale) with tests
- [x] `POST /api/vendor-changes/:id/analyze` + worker job; `/demo` page with "Run demo change"

## Phase 4 - Remediation and validation [x]

- [x] Migration-rule engine (preconditions, AST edits, unified diff, re-parse)
- [x] OpenAI fixture patch rule end-to-end
- [x] `sandbox-runner` allowlist executor (timeouts, caps, Windows cmd)
- [x] ValidationRun persistence + UI; `POST /api/remediations/:id/validate`
- [x] Remediation plan/patches UI with diff view

## Phase 5 - Policy and local PR workflow [x]

- [x] `policy-engine`: JSON policy definitions (Zod), deterministic decisions
- [x] Approval workflow (approve/reject endpoints, UI)
- [x] `LocalGitProvider` (temp workspace, branch, patch, mock draft PR)
- [x] `POST /api/remediations/:id/create-pr` gated by policy+approval+validation
- [x] Full audit trail across all mutations; acceptance tests 1, 2, 4

## Phase 6 - Additional demo scenarios [x]

- [x] Stripe fixture rule + payment risk path
- [x] Auth0 approval-gated flow (blocked PR test)
- [x] Twilio detection + deprecation fixture event
- [x] Generic OpenAPI diff (removed endpoint/response property, type change, required field)
      -> plan-only; acceptance test 3

## Phase 7 - Quality hardening [x]

- [x] Integration tests across engines
- [x] Playwright E2E (OpenAI demo happy path, diff+validation view; Auth0 policy gating covered by create-pr unit test)
- [x] Error/loading/empty states audit, no dead navigation
- [x] Final docs pass (README run instructions verified from clean clone)
- [x] Full green: format, lint, typecheck, test, e2e

## Phase 8 - Self-maintaining APIs: agent mode, real AI, tenant scoping [x]

- [x] Per-vendor agent mode: `pb_agent_*` bearer keys (sha256 hash stored, constant-time verify),
      self-authenticating `POST /api/vendors/:slug/events` ingest, ADMIN-only key issuance
      (`POST .../agent-key`, plaintext returned once), vendor catalog exposes `agentModeEnabled`
- [x] Agent ingest follows the same pipeline as human events: connector normalization, persistence,
      `ANALYZE_CHANGE` enqueue with organizationId, `agent.*` audit actions (ActorType.AGENT)
- [x] Real AI provider: OpenAI-compatible chat completions behind `AI_PROVIDER=openai`/
      `openai-compatible` + `OPENAI_API_KEY`; output parsed through Zod; advisory-only `aiNote`
      on plan audit (never blocks); deterministic mock remains the default
- [x] Tenant scoping: `VendorChangeEvent.organizationId` (migration
      `20260806100000_vendor_change_event_org`); all change/plan routes, server pages, worker
      jobs, and dashboard counts filter by caller organization; cross-org reads return 404/422
- [x] Cross-org scoping unit tests (`apps/web/src/app/api/vendor-changes/scoping.test.ts`),
      agent key + ingest + key-issuance test suites
- [x] Live verification: agent ingest → TRIAGED, per-org demo event, org-scoped lists; full gates
      green (format/lint/typecheck/test 252, e2e)

## Phase 9 - GitHub App integration and production hardening [x]

- [x] `GitHubAppProvider`: RS256 App JWT (node:crypto), installation access tokens, draft PRs,
      live repository metadata; `GitHubProvider` PAT mode kept as legacy fallback
- [x] Install flow: `/settings/github` → signed expiring state cookie → `/api/github/callback`
      (API-validated, org-bound, single-binding); webhooks can enrich/suspend but never bind
- [x] Webhook receiver `/api/webhooks/github`: HMAC `x-hub-signature-256`, delivery dedup
      (`WebhookDelivery` unique on `x-github-delivery`, migration
      `20260810100000_webhook_delivery_deduplication`), monotonic PR status sync + audit
- [x] Tenant schema migration `20260809091648_tenant_scoping_github_app`: direct
      `organizationId` on operational tables with indexes + seed backfill
- [x] Worker: `create-pr` resolves repository installation per plan, tenant-checked before acting
- [x] Auth: NextAuth GitHub OAuth (per-signup org via custom adapter) when configured; dev cookie
      fails closed in production (no default secret, no fallback password, login rate-limited)
- [x] Agent ingest hardening: oversized payload rejection + rate limiting
- [x] Verified: 260 tests, typecheck, lint, format, production build, browser E2E

## Definition of Done (overall)

Clone → README steps → docker up → migrate/seed → dashboard shows demo state → OpenAI demo flow
produces stored plan/patch/validation/mock draft PR/audit events → Auth0 flow blocked by policy →
generic OpenAPI produces plan-only → tests/lint/typecheck pass → no knowingly dead buttons or
broken routes.
