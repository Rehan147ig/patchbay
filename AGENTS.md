# AGENTS.md

Guidance for humans and AI agents working in this repository.

## What Patchbay is

Patchbay is a governed API-change remediation platform (local-development MVP). When a third-party
API/SDK changes, Patchbay detects the change, finds affected usages across connected repositories,
generates safe migration patches for known patterns, runs allowlisted validation commands, and
records an auditable trail. It never auto-merges, never runs arbitrary commands, and never claims
autonomous safety for high-risk changes.

It is NOT a generic chatbot, changelog summarizer, or OpenAPI diff dashboard.

## Repository layout

- `apps/web` - Next.js 15 App Router dashboard + typed API route handlers
- `apps/worker` - BullMQ background job processor (scan, analyze, validate, PR creation, capability health, retention purge)
- `packages/domain` - enums, Zod schemas, shared errors, JSON logger (no framework deps)
- `packages/db` - Prisma schema, client singleton, org row-scoping (`withOrgContext`), seed script
- `packages/audit` - immutable audit event helpers, secret redaction, audit action registry
- `packages/operations` - WP10 DB-free logic: SLO rollups (`computeOrganizationMetrics`), capability health/auto-suspend, retention purge; uses structural `PrismaLike` types (no `@patchbay/db` dependency)
- `packages/billing` - subscription plans/caps, SDK-free Stripe REST client, webhook signature verification
- `packages/ui` - accessible UI primitives
- `packages/vendor-connectors` - Stripe/OpenAI/Twilio/Anthropic/AWS SDK/Supabase/Auth0/Generic OpenAPI adapters, connector certification registry
- `packages/repo-analysis` - TypeScript AST indexing (TS compiler API), Python L1 (web-tree-sitter WASM), graph extractor, integration usage inventory, impact scoring. Python support is detect+assess (L1/L2) only; certified remediations remain Node/TS.
- `packages/remediation-engine` - migration rules, patch generation, remediation plans
- `packages/policy-engine` - JSON policy definitions, confidence gates, risk classification
- `packages/git-provider` - GitProvider interface, LocalGitProvider, GitHubProvider (PAT), GitHubAppProvider (App JWT + installation tokens)
- `packages/sandbox-runner` - allowlisted command execution with timeouts
- `packages/ai-provider` - AI abstraction; deterministic mock is the default
- `packages/ai-harness` - agent workflow supervisor (analyst → planner → reviewer), measurement, Mastra-contract adapter
- `packages/queue` - BullMQ queue definitions, JobType contracts, Redis connection
- `apps/web/src/lib/agent-keys.ts` - agent key generation/hashing/verification (`pb_agent_*`)
- `apps/web/src/lib/pr-outcomes.ts` - single writer for PrOutcome (webhook + feedback)
- `apps/web/src/lib/capability-gates.ts` - kill-switch check wired into draft-pr/validate routes
- `fixtures/repositories` - sample TypeScript repositories used for analysis/demo
- `docs/` - architecture.md (mermaid diagrams), CTO execution plan, roadmap, ledger, threat model

Key models (Prisma): `RemediationCase` (lifecycle + append-only events), `AgentRun`/`AgentStep`,
`GraphSnapshot`/`GraphNode`/`GraphEdge`, `PrOutcome` + `CapabilityGate` (WP10), `PullRequest`,
`ValidationRun`, `AuditEvent`. New JobTypes go in `packages/queue/src/index.ts`; new audit actions
in `packages/audit/src/actions.ts`; org-scoped models are listed in `packages/db/src/org-scope.ts`.

## Non-negotiable engineering rules

1. Strict TypeScript everywhere. No `any` unless documented and narrowly justified.
2. Deterministic logic first, AI second. AI may propose, never execute or bypass policy.
3. AI output must parse through Zod schemas before it can affect state.
4. Validation commands come only from the fixed allowlist in `packages/sandbox-runner`.
   Never run commands constructed from model output or external text.
5. Every mutation endpoint: Zod validation, role check, audit event, correlation ID,
   predictable error JSON, no stack traces in production mode.
6. Never claim a feature works unless implemented and verified. No placeholder buttons,
   no "coming soon" flows, no dead navigation.
7. Credentials live server-side only. Redact secrets before logging, auditing, or sending
   to AI. Never expose GitHub tokens to the browser.
8. Default safety policy: draft PRs only, never auto-merge, human approval required for
   payment/auth/authorization/PII/webhook/encryption/secrets/infrastructure changes.
9. Add JSDoc only where logic is non-obvious. Meaningful names. Simple over abstract.

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
pnpm typecheck               # tsc --noEmit across all packages
pnpm test                    # vitest run
pnpm test:corpus             # eval-corpus certification gate (also covered by pnpm test)
pnpm e2e                     # Playwright (needs port 3000 free + worker running)
```

After ANY code change run: `pnpm format` → `pnpm lint` → `pnpm typecheck` → `pnpm test`
and fix everything before finishing.

**Important:** vitest treats `[id]` in paths as a glob character class, so route tests under
`apps/web/src/app/api/**/[id]/**` are NOT picked up by `pnpm test`. Run them explicitly with the
temp config: `pnpm vitest run --config vitest.wp10.config.ts` (aliases `@` → `apps/web/src` and
`server-only` → `apps/web/test/server-only.ts`). Add `capabilityGate`/`withOrgContext` to
`@patchbay/db` mocks in route tests that call kill-switch or org-scoped helpers.

## Architecture rules

- **Certification requires the eval corpus green** (`pnpm test:corpus`): a connector promoted to
  DRAFT_PR must prove its patch kit on the H8 corpus — every patchable corpus entry must produce
  `buildPatchSuggestions` and the patches must apply to the fixtures. Connectors below DRAFT_PR
  (e.g. auth0 at PLAN) must produce zero patch suggestions; if the kit exists but was never
  certified, the gate fails loudly. Never promote ASSESS → DRAFT_PR without the corpus green.
- `packages/domain`, `packages/audit`, `packages/policy-engine`, `packages/remediation-engine`,
  `packages/operations` must stay DB-free and runnable in plain unit tests (no database, no
  network). `packages/operations` accepts structural `PrismaLike` clients for testability.
- The DB is only touched by `apps/web` route handlers/pages, `apps/worker`, and seed code.
- Enums are defined once in `packages/domain` (as const objects + Zod enums) and mirrored in
  `prisma/schema.prisma`. A drift test in `packages/domain` verifies Prisma values stay in sync.
  New domain exports must also be added to the explicit export list in `packages/domain/src/index.ts`.
- All API responses include a `correlationId`; all mutations write an `AuditEvent`.
- Prompt templates are files, not inline strings. Redact context before any AI call.
- The local sandbox runner is NOT a hardened multi-tenant sandbox; say so in docs and UI.
- Every org-scoped query must filter by `organizationId` (change events carry it; remediation
  plans scope through `impactAssessment.repository.organizationId`). Cross-org reads return
  404/422, never leak data. `withOrgContext(prisma, orgId)` is the helper.
- Client components (`"use client"`) must NOT import from `@patchbay/domain` — its logger pulls in
  `node:async_hooks`, which fails the webpack build. Inline string literals instead (see
  `apps/web/src/components/outcome-feedback-form.tsx`).
- Capability kill switch (WP10): `draft-pr` and `validate` routes call
  `assertCapabilityGateOpen` after `requireCertified`; a SUSPENDED gate returns 422. Gates are
  created by the worker job `evaluate-capability-health` (thresholds in
  `apps/worker/src/jobs/evaluate-capability-health.ts`) and restored only by ADMIN via
  `POST /api/capability-gates`.
- Agent keys (`pb_agent_*`) are bearer secrets: only argon2id hashes are stored (legacy
  sha256 hashes verify during the migration window), comparison is constant-time,
  plaintext is shown exactly once at issuance, and rotation keeps the previous hash
  valid until the next rotation. The `/api/vendors/` prefix is exempt from session
  middleware because agent ingest self-authenticates.
