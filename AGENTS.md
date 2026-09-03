# AGENTS.md

Guidance for humans and AI agents (including OpenCode, Cursor, and Gemini) working in this repository.

## What Patchbay is

Patchbay is a neutral, policy-governed **Autonomous Software Change Engine**. When a third-party
API/SDK changes, Patchbay detects the change, finds affected usages across connected repositories using
a commit-versioned **Software Intelligence Graph**, generates safe migration patches for known patterns,
runs allowlisted validation commands in isolated container sandboxes, and records an auditable trail.
It never auto-merges, never runs arbitrary commands, and never claims autonomous safety for high-risk changes.

It is NOT a generic chatbot, changelog summarizer, or OpenAPI diff dashboard.

## Repository layout (19 Workspace Projects)

- `apps/web` - Next.js 15 App Router dashboard (Apple Light design system) + typed API route handlers
- `apps/worker` - BullMQ background job processor (Watchtower, scan, analyze, validate, create-pr, graph-index, capability health, retention purge)
- `packages/cli` - `@patchbay/cli` (`npx patch-migrate <vendor>` zero-install terminal tool)
- `packages/domain` - Single source of truth: enums, semver, Zod schemas, shared errors, JSON logger (no framework deps)
- `packages/env` - Typed runtime environment validation via Zod + SecretStore abstraction
- `packages/db` - Prisma schema, client singleton, org row-scoping (`withOrgContext`), seed script
- `packages/audit` - Immutable append-only WORM audit event helpers, secret redaction, audit action registry
- `packages/operations` - WP10 DB-free logic: SLO rollups (`computeOrganizationMetrics`), capability health/auto-suspend, retention purge; uses structural `PrismaLike` types
- `packages/billing` - Subscription plans/caps, SDK-free Stripe REST client, webhook signature verification
- `packages/ui` - Accessible Apple Light UI primitives (Card, StatCard, Button, Badge, Table, PageHeader, StatusPill, Input)
- `packages/vendor-connectors` - 56-connector catalog (6 certified `DRAFT_PR`, 50 `ASSESS`), connector certification registry, defineConnector SDK, strict symbol scoring
- `packages/repo-analysis` - TypeScript compiler AST indexer, Python L1 (web-tree-sitter WASM), graph extractor, integration usage inventory, impact scoring
- `packages/remediation-engine` - Migration rules, semantic AST edits, CRLF line-ending preservation, patch generation, evaluation corpus
- `packages/policy-engine` - JSON policy definitions, confidence gates, risk classification (ALLOW/APPROVE/DENY)
- `packages/git-provider` - GitProvider interface, LocalGitProvider, GitHubProvider (PAT), GitHubAppProvider (App JWT + installation tokens, Link-header pagination)
- `packages/sandbox-runner` - Allowlisted command execution with timeouts and output bounds (container/Docker default)
- `packages/ai-provider` - AI abstraction (deterministic mock, Vercel AI SDK, OpenAI-compatible drivers)
- `packages/ai-harness` - Dual-agent workflow supervisor (analyst → planner → reviewer), measurement, Mastra-contract adapter
- `packages/queue` - BullMQ queue definitions, JobType contracts, Redis Lua atomic concurrency control
- `fixtures/repositories` - Sample TypeScript/Python repositories used for analysis, corpus tests, and demos
- `docs/` - Architecture diagrams, security model, threat model, enterprise readiness guide

### Key UI & Interaction Components (`apps/web/src/components/`)

- `blast-radar.tsx` - Concentric Blast-Radius Radar (`cases/[id]`): Center symbol -> Ring 1 affected call-sites (red) -> Ring 2 co-located dependents (amber) with interactive click-to-evidence drawer.
- `connect-repository-form.tsx` - Native searchable GitHub repository picker backed by `GET /api/github/installations/[id]/repositories`.
- `demo-simulator.tsx` - In-browser zero-install 1-click live remediation simulator on `/demo` and `/overview`.
- `product-tour.tsx` - Driver.js 5-step guided walkthrough across Overview KPIs, Cases Funnel, Watchtower, Policies, and Playground.

## Non-negotiable engineering rules

1. **Strict TypeScript everywhere.** No `any` unless documented and narrowly justified. Zero warnings allowed.
2. **Deterministic logic first, AI second.** AST transforms and rule packs run first. AI may propose, never execute or bypass policy.
3. **AI output must parse through Zod schemas** before it can affect state.
4. **Validation commands come only from the fixed allowlist** in `packages/sandbox-runner`. Never run commands constructed from model output or external text.
5. **Every mutation endpoint:** Zod validation, role check, audit event, correlation ID, predictable error JSON, no stack traces in production mode.
6. **Never claim a feature works unless implemented and verified.** No placeholder buttons, no "coming soon" flows, no dead navigation.
7. **Credentials live server-side only.** Redact secrets before logging, auditing, or sending to AI. Never expose GitHub tokens to the browser.
8. **Default safety policy:** Draft PRs only, never auto-merge, human approval required for payment/auth/authorization/PII/webhook/encryption/secrets/infrastructure changes.
9. **Strict symbol matching:** In `packages/vendor-connectors/src/scoring.ts`, `matchKind` is strictly exact-only; prefix matches must never trigger false-positive affected nodes.
10. **Parity across PR creation vectors:** Both `cases/[id]/draft-pr` and `remediations/[id]/create-pr` must enforce `requireCertified(slug, "DRAFT_PR")` and `assertCapabilityGateOpen`.
11. **Observable failures:** `run-validation.ts` captures stdout, stderr, and exit codes on test failures and stores them in `ValidationRun.output`.

## Commands

```bash
pnpm install                 # install everything
docker compose up -d         # postgres (5434) + redis (6380)
pnpm db:generate             # prisma generate
pnpm db:migrate              # apply committed migrations
pnpm db:seed                 # seed demo data (idempotent)
pnpm dev                     # web (http://localhost:3000) + worker
pnpm lint                    # eslint, zero warnings allowed
pnpm format:check            # prettier check
pnpm format                  # prettier write
pnpm typecheck               # tsc --noEmit across all 19 packages
pnpm test                    # full vitest suite (1,067+ tests)
pnpm test:corpus             # 34/34 eval-corpus certification gate
pnpm build                   # production Next.js build (all 37 dynamic routes)
pnpm e2e                     # Playwright (needs port 3000 free + worker running)
```

After ANY code change run: `pnpm format` → `pnpm lint` → `pnpm typecheck` → `pnpm test` and fix everything before finishing.

## Architecture rules

- **Certification requires the eval corpus green** (`pnpm test:corpus`): Exactly 6 connectors are certified for `DRAFT_PR` (`openai`, `stripe`, `twilio`, `anthropic`, `supabase`, `vercel-ai-sdk`). 50 connectors operate at `ASSESS` (graph inventory & blast-radius analysis). Never promote `ASSESS` → `DRAFT_PR` without all corpus fixtures passing.
- `packages/domain`, `packages/audit`, `packages/policy-engine`, `packages/remediation-engine`, `packages/operations` must stay DB-free and runnable in plain unit tests (no database, no network).
- The DB is only touched by `apps/web` route handlers/pages, `apps/worker`, and seed code.
- Enums are defined once in `packages/domain` and mirrored in `prisma/schema.prisma`. A drift test in `packages/domain` verifies Prisma values stay in sync.
- Every org-scoped query must filter by `organizationId`. Cross-org reads return 404/422, never leak data. `withOrgContext(prisma, orgId)` is the helper.
- Client components (`"use client"`) must NOT import from `@patchbay/domain` — its logger pulls in `node:async_hooks`, which fails the client bundle. Inline string literals instead.
- Capability kill switch (WP10): `draft-pr` and `validate` routes call `assertCapabilityGateOpen` after `requireCertified`; a SUSPENDED gate returns 422.
- GitHub App install: Non-admin users clicking install are gracefully redirected to `/settings/github?error=admin_required` with an explanatory notice.
- PR Markdown body: Generated pull requests must carry the complete Patchbay evidence block (policy decision, justification, validation sandbox run, risk tags, and affected usage counts).
