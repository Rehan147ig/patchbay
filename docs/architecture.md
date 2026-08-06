# Patchbay - Architecture

## 1. Overview

Patchbay is a pnpm monorepo with a Next.js dashboard/API surface, a BullMQ worker, and pure
TypeScript domain/engine packages. The design principle: **deterministic engines are pure and
DB-free; the database and external I/O live at the edges** (route handlers, worker, seed).

```
                    ┌─────────────────────────────┐
                    │        apps/web (Next.js)   │
                    │  dashboard (RSC) + route    │
                    │  handlers (typed JSON API)  │
                    └──────┬──────────────┬───────┘
                           │              │
                  packages/domain, db,    │
                  audit, ui               │  enqueue jobs
                           │              ▼
                    ┌──────┴──────┐  ┌──────────────┐      ┌─────────┐
                    │  postgres   │  │  apps/worker │◄────►│  redis  │
                    │  (Prisma)   │  │  (BullMQ)    │      └─────────┘
                    └─────────────┘  └──┬───────────┘
                                        │ uses pure engine packages
   ┌────────────────────────────────────┼────────────────────────────────┐
   │ packages/repo-analysis             │                                │
   │ packages/remediation-engine        │                                │
   │ packages/policy-engine             │                                │
   │ packages/vendor-connectors ────────┼──► packages/ai-provider (mock) │
   │ packages/sandbox-runner            │                                │
   │ packages/git-provider (local)      │                                │
   └────────────────────────────────────┼────────────────────────────────┘
                                        ▼
                             fixtures/repositories (analysis input,
                             test fixtures, demo scenarios)
```

## 2. Dependency rules

- `packages/domain`: zero runtime deps besides zod; no DB, no network. Single source of truth
  for enums and API input schemas.
- `packages/audit`, `policy-engine`, `remediation-engine`, `repo-analysis`, `ai-provider`,
  `sandbox-runner`, `git-provider`: depend on `domain` only, and perform no DB access.
- `packages/db`: Prisma schema + client; consumed by `apps/web` and `apps/worker` and seed.
- Engine packages expose plain functions taking plain inputs (paths, file contents, in-memory
  usage records) so they are trivially testable without infrastructure.

## 3. Data flow (change event → draft PR)

```
1. ingest          VendorChangeEvent created (manual, OpenAPI diff, connector, agent webhook)
2. normalize       VendorConnector.normalizeChange -> NormalizedChange(s) [+ severity/breaking]
3. analyze         repo-analysis scans repository snapshot
                   -> IntegrationUsage rows (AST-indexed, risk-tagged, owner-hinted)
4. assess          impact scoring (impact 0-100, confidence 0-100, rationale, risk level)
                   -> ImpactAssessment
5. plan            remediation-engine builds RemediationPlan
                   (rule-based patch proposal OR AI-assisted plan-only suggestion)
6. validate        sandbox-runner executes allowlisted commands on patched workspace
                   -> ValidationRun
7. decide          policy-engine evaluates definitionJson rules -> policyDecision
8. gate            approvals if required; confidence thresholds; validation status
9. deliver         git-provider: branch + patch + DRAFT pull request (mock by default)
10. audit          every step above writes an AuditEvent (correlationId threaded through)
```

Worker jobs: `scan-repository`, `analyze-change`, `run-validation`, `create-pr`.

## 4. Key components

### 4.1 repo-analysis

- Parses `package.json` + lockfile (pnpm-lock.yaml first, package-lock.json fallback).
- TypeScript compiler API: imports, client construction, method calls, string endpoint refs,
  config patterns, webhook handler patterns.
- Stores `file:line:column` locations, bounded sanitized code excerpts, `surroundingCodeHash`.
- Risk tags from paths/symbols: PAYMENT, AUTH, PII, WEBHOOK, INFRASTRUCTURE, TEST_ONLY.
- Owner hints: CODEOWNERS, path heuristics, "Unassigned".

### 4.2 remediation-engine

Rule order: load vendor rules → validate preconditions (AST + package version) → AST-aware edits →
unified diff → re-parse → syntax/type check → structured plan. No matching rule → plan-only
recommendation, optionally AI-drafted, always labeled "AI-assisted, not automatically applicable",
never patched without deterministic validation.

### 4.3 policy-engine

- Policy definitionJson validated with Zod (rule over riskTag/vendor/repository/confidence/
  validationStatus/changeType; decision ∈ {ALLOW_PLAN_ONLY, ALLOW_VALIDATE, ALLOW_DRAFT_PR,
  REQUIRE_APPROVAL, DENY}).
- Decision resolution is deterministic and returns the matched rule + reasons for UI display.

### 4.4 sandbox-runner

- Fixed allowlist: `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test`,
  `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`.
- Timeouts, bounded output capture, command + arg parsing on Windows via `cmd.exe /c`.
- Refuses anything not on the allowlist (unit-tested).

### 4.5 git-provider

- `GitProvider` interface: listRepositories, getRepositorySnapshot, createBranch, applyPatch,
  createDraftPullRequest.
- `LocalGitProvider`: copies fixture repos to a temp workspace, applies patches, creates a mock
  draft PR object + URL. Fully offline.
- `GitHubProvider` scaffold behind env vars; GitHub App-style; tokens server-side only.

### 4.6 ai-provider

- `AiProvider` interface: `draftRemediationPlan(input): Promise<AiPlanDraft>`.
- `MockAiProvider` (default): deterministic fixture output, no network.
- `OpenAiCompatibleProvider` optional via env. All outputs parsed through Zod; context redacted
  and size-bounded; prompt templates in `packages/ai-provider/prompts/*.md`.

### 4.7 audit

- Every mutation writes AuditEvent (org, actorType, actor, action, entityType, entityId,
  correlationId, before/after JSON, metadata). Application-level append-only (no update/delete
  paths in code); `beforeJson`/`afterJson` give immutability per event.
- Secret redaction helper applied to before/after/metadata and free-text.

### 4.8 agent mode (vendor ingest API)

- Vendors opt into agent mode: an ADMIN issues a `pb_agent_*` bearer key via
  `POST /api/vendors/:slug/agent-key` (plaintext returned once; only its sha256 hash is stored,
  compared with `timingSafeEqual`).
- `POST /api/vendors/:slug/events` is self-authenticating (no session): it verifies the key hash
  against the vendor, requires the vendor to belong to an organization, normalizes the payload
  through the vendor's connector, persists the event + normalizations with the vendor's
  organization, enqueues `ANALYZE_CHANGE`, and writes `agent.event_received` audit events with
  `ActorType.AGENT`. The dashboard middleware exempts `/api/vendors/` from session redirects;
  every vendor route still enforces its own auth (agent key or session).

### 4.9 tenant scoping

- All multi-tenant reads/writes are filtered by `organizationId`:
  - `VendorChangeEvent` carries `organizationId` (set from the user's session or the vendor's org
    on agent ingest); every change route, server page, and the worker's `analyze-change` job
    filters by it.
  - `RemediationPlan` has no org column; plans scope transitively through
    `impactAssessment.repository.organizationId`.
  - Dashboard counts and validation-run lists scope through the same relations.
- Cross-organization access is indistinguishable from missing rows (404/422) and is covered by
  `apps/web/src/app/api/vendor-changes/scoping.test.ts`.

## 5. Web application

- App Router; pages are server components querying Prisma; mutation via route handlers.
- Typed API: Zod on every body; role checks; predictable error JSON
  `{ error: { code, message }, correlationId }`; correlation id propagated to logs and audit.
- Dev auth: signed HttpOnly cookie (HMAC) for a seeded demo user; `AuthProvider` interface
  documented for Clerk/Auth.js/SSO later.
- No dead navigation: routes render real data or honest empty states.

## 6. Queueing

- BullMQ queue `remediation` with named jobs; worker consumes, updates Prisma, writes audit
  events. Correlates with the originating request's correlationId. `apps/worker` runs standalone
  (`tsx watch`), so web and worker can be scaled independently later.

## 7. Observability

- Structured JSON logs via `packages/domain` logger with AsyncLocalStorage correlation ids.
- `/api/health` liveness + DB check.
- Audit events double as the business observability trail.

## 8. Security boundaries

See [docs/threat-model.md](docs/threat-model.md). Highlights: command allowlist, draft-only PRs,
approval gates, redaction, no tokens in the browser, explicit "local sandbox is not hardened"
notice.
