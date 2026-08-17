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
- `apps/worker` - BullMQ background job processor (scan, analyze, validate, PR creation)
- `packages/domain` - enums, Zod schemas, shared errors, JSON logger (no framework deps)
- `packages/db` - Prisma schema, client singleton, seed script
- `packages/audit` - immutable audit event helpers, secret redaction
- `packages/billing` - subscription plans/caps, SDK-free Stripe REST client, webhook signature verification
- `packages/ui` - accessible UI primitives
- `packages/vendor-connectors` - Stripe/OpenAI/Twilio/Auth0/Generic OpenAPI adapters
- `packages/repo-analysis` - TypeScript AST indexing, integration usage inventory, impact scoring
- `packages/remediation-engine` - migration rules, patch generation, remediation plans
- `packages/policy-engine` - JSON policy definitions, confidence gates, risk classification
- `packages/git-provider` - GitProvider interface, LocalGitProvider, GitHubProvider (PAT), GitHubAppProvider (App JWT + installation tokens)
- `packages/sandbox-runner` - allowlisted command execution with timeouts
- `packages/ai-provider` - AI abstraction; deterministic mock is the default
- `apps/web/src/lib/agent-keys.ts` - agent key generation/hashing/verification (`pb_agent_*`)
- `fixtures/repositories` - sample TypeScript repositories used for analysis/demo

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
docker compose up -d         # postgres + redis
pnpm db:generate             # prisma generate
pnpm db:migrate              # apply committed migrations
pnpm db:seed                 # seed demo data (idempotent)
pnpm dev                     # web (http://localhost:3000) + worker
pnpm lint                    # eslint, zero warnings allowed
pnpm format:check            # prettier check
pnpm typecheck               # tsc --noEmit across all packages
pnpm test                    # vitest run
pnpm e2e                     # Playwright (Phase 7)
```

After ANY code change run: `pnpm format` → `pnpm lint` → `pnpm typecheck` → `pnpm test`
and fix everything before finishing.

## Architecture rules

- `packages/domain`, `packages/audit`, `packages/policy-engine`, `packages/remediation-engine`
  must stay DB-free and runnable in plain unit tests (no database, no network).
- The DB is only touched by `apps/web` route handlers/pages, `apps/worker`, and seed code.
- Enums are defined once in `packages/domain` (as const objects + Zod enums) and mirrored in
  `prisma/schema.prisma`. A drift test in `packages/domain` verifies Prisma values stay in sync.
- All API responses include a `correlationId`; all mutations write an `AuditEvent`.
- Prompt templates are files, not inline strings. Redact context before any AI call.
- The local sandbox runner is NOT a hardened multi-tenant sandbox; say so in docs and UI.
- Every org-scoped query must filter by `organizationId` (change events carry it; remediation
  plans scope through `impactAssessment.repository.organizationId`). Cross-org reads return
  404/422, never leak data.
- Agent keys (`pb_agent_*`) are bearer secrets: only argon2id hashes are stored (legacy
  sha256 hashes verify during the migration window), comparison is constant-time,
  plaintext is shown exactly once at issuance, and rotation keeps the previous hash
  valid until the next rotation. The `/api/vendors/` prefix is exempt from session
  middleware because agent ingest self-authenticates.
