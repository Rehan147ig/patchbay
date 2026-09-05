# Patchbay Implementation Status (WP0 Baseline)

**Branch:** `feat/production-spec` (base: `main` @ `29f6a69`, all-green)
**Date:** 2026-09-05
**Spec:** `Patchbay Production Transformation Specification` (Manus AI, 2026-09-05), §19 protocol
**Rule:** no completion claimed without evidence. Failures are documented, never hidden.

## 1. Baseline verification (§19 gate commands)

| Command                               | Result  | Evidence                                                                                                                                                                           |
| ------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`      | ✅ pass | lockfile up to date, 20 workspace projects                                                                                                                                         |
| `pnpm --filter @patchbay/db generate` | ✅ pass | Prisma Client v6.19.3 generated                                                                                                                                                    |
| `pnpm format:check`                   | ✅ pass | all matched files, Prettier clean                                                                                                                                                  |
| `pnpm lint`                           | ✅ pass | eslint, zero warnings                                                                                                                                                              |
| `pnpm typecheck`                      | ✅ pass | 19/19 projects, `tsc --noEmit` clean                                                                                                                                               |
| `pnpm test` (full vitest)             | ✅ pass | **414/414 suites, 1337 passed, 0 failed, 14 pending** (JSON report `test-results.wp0.json`; pending = infra-gated skips: worm-db, Docker sandbox, network checkout)                |
| `pnpm test:corpus`                    | ✅ pass | **35/35** eval-corpus gate green (solo run, 107s assertion time)                                                                                                                   |
| `pnpm build`                          | ✅ pass | Next.js production build: 41 static pages + ~70 API routes; warnings only (middleware→proxy deprecation notice, Turbopack dynamic-fs tracing notes in `repo-analysis/lockfile.ts`) |

### Baseline incident (documented per §19, not hidden)

First `pnpm test:corpus` attempt ran **in parallel** with `pnpm build` and failed 2 tests
(`checkCertifiedPatchCoverage` gate + auth0 PLAN-only gate) with 30s test timeouts.
Re-ran solo: 35/35 green. Root cause is resource contention on this host
(Turbopack build at 11 workers starving the fixture-patching tests), not a product
regression — but it proves the coverage-gate tests are timing-sensitive under load.
**Follow-up for WP10/WP13:** raise coverage-gate timeouts or pin corpus CI to a
dedicated runner; never parallelize heavy jobs on one host.

## 2. Environment prerequisites

- Node.js ≥ 22, pnpm ≥ 10, Docker (Desktop/Engine + Compose) for Postgres (host 5434) + Redis (host 6380).
- Local Redis lives on **6380 with password** (`REDIS_URL=redis://:patchbay_dev_only@localhost:6380`); Redis-dependent tests that hardcode 6379 skip without it (`redis-conformance` env-gate) or run in the `ci-redis` workflow.
- `cp .env.example .env`, `pnpm db:generate`, `pnpm db:migrate`, `pnpm db:seed`.
- No cloud credentials required for the baseline: AI defaults to deterministic mock, sandbox defaults allow local process mode, validation defaults do not need Docker.

## 3. Feature matrix vs spec (§2–§17)

### 3.1 Data model (§4.1) — present ✅

Organization, AutonomyPolicy, Workspace/WorkspaceMember, Subscription, User/Account/Session,
WebhookDelivery, GitHubInstallation, Repository, RepositoryScan, Vendor, VendorProduct,
ReleaseRecord, ReleaseEvidence, RepositoryDependency, ReleaseRepositoryMatch,
ReleaseClassification, RemediationCase (+Event), AgentRun/Step, DetectionRun, TaskParameter,
GraphSnapshot/Node/Edge/SourceEvidence/IndexJob, VendorChangeEvent, NormalizedChange,
IntegrationUsage, ImpactAssessment (+Usage), RemediationPlan, PatchArtifact, ValidationRun,
PullRequest, Policy, Approval, AuditEvent, PrOutcome, CapabilityGate, Notification.
Tenant isolation: `withOrgContext` + `FORCE ROW LEVEL SECURITY` migration + org-scope drift tests.

### 3.2 Data model (§4.1) — missing ❌ (WP2/WP4/WP5/WP10 work)

ContractSource, ContractSnapshot, ContractChange, ContractConsumer, MaintenanceSchedule,
RemediationAttempt, ValidationProfile, ValidationArtifact, PolicyDecision (model; enum only),
DeliveryAttempt, DeadLetterJob (queue exists, record + replay API do not), NotificationPreference,
ConnectorCertification (versioned record; CapabilityGate + corpus cover behavior only), Incident.

### 3.3 Capability matrix (§2.2) — partial 🟡 (WP1/WP5 work)

Present: single-level vocabulary (DETECT/ASSESS/PLAN/VALIDATE/DRAFT_PR) + certified flag +
corpus gate. 64 connectors; 9 DRAFT_PR (openai, openai-python, stripe, twilio, anthropic,
supabase, google-gemini, vercel-ai-sdk, autonomous-generic); PLAN: auth0, aws-sdk, langchain,
mcp-generic. Missing: the 7-dimension vocabulary (detection/normalization/analysis/
remediation/validation/delivery/certification) shared across registry, policy, UI, PR body.

### 3.4 Contract families (§2.3)

REST/OpenAPI ✅ · SDK/package ✅ · MCP ✅ (tool diff engine + client-config discovery,
plan-only default with privileged-tool gating) · GraphQL consumer analysis ❌ ·
webhook/event contracts ❌ · async (Avro/Protobuf/Kafka) ❌ · auth/config contracts ❌ (risk tags only).

### 3.5 Routes, jobs, dashboard (§11)

Present API: webhooks (github incl. `check_run` verdict ingestion, stripe, dodo), cases
(approve/cancel/draft-pr/reject/replay), releases (+analyze/plan), remediations
(approve/create-pr/validate), vendors (+agent-key/events/private/promotions), watchtower
(detect/health/runs), operations/metrics, audit/export, registry, policies, SCIM, outcomes,
health (Postgres+Redis+queue backlog), demo, github callback/install, notifications,
repositories (+connect/scan/graph), runs (+cancel/replay), settings/autonomy, submission,
billing, export/data, auth.
Missing: `contracts/*`, `consumers`, `maintenance/cases/*` (assess/plan/validate/suppress +
timeline), `operations/queues|replay|capabilities`.
Worker jobs: scan-repository, analyze-change, run-validation, create-pr, poll-npm-registry,
update-task-parameter (+sweep), graph-index, classify-release, match-release, agent-plan,
agent-replay, detect-releases, evaluate-capability-health, siem-forward; sweeps: task (1m),
retention (6h), capability health (30m), watchtower staleness (30m).
Dashboard pages: overview, cases, changes, releases, remediations, repositories, policies,
outcomes, outcomes, audit, notifications, onboarding, demo, settings. Missing: change feed,
repository fleet, contract sources, operations/DLQ view, policies with quiet hours.

### 3.6 Policy, agents, execution (§7–§9)

Policy engine + dual-approver quorum + capability kill switch ✅; spec vocabulary
(ASSESS/SUPPRESSED) + quiet hours + grouping + usage limits ❌. Agent harness
(analyst→planner→reviewer, Mastra-contract workflow, budgets, replay, measurement) ✅ wired
into worker jobs. Sandbox: allowlist + redaction + timeouts + container/no-network tests ✅;
SBOM/SLSA/provenance ❌; seccomp to-verify. Command allowlist ✅. DLQ alerting + Redis-aware
health + staleness watchdog ✅ (this branch base). `SANDBOX_VALIDATION_MODE=github-checks-only`
supported end-to-end (SKIPPED runs close via `check_run` ingestion).

### 3.7 Enterprise, metering, release (§14–§16)

RBAC, SCIM (+deprovisioning), audit export, retention/deletion, security headers/CSRF/rate
limits ✅. Missing: SSO/OIDC/SAML, real (cloud-KMS) envelope encryption — **`packages/db/src/kms.ts`
is a local-key stub` (envelope shape preserved for swap) — DPA/subprocessors docs, backup/restore
drills, vuln disclosure, SOC 2 (process), staging environment (no references found), immutable
images + SBOM, job schema versions, formal rollout stages. Billing caps enforced at registration
only; server-side metering/quota-exhaustion states missing.

## 4. Unimplemented-claims audit (honesty; AGENTS.md rule 6)

- README scopes event/data planes and the learning loop as roadmap, not shipped — accurate.
- `private-beta-onboarding.md` hardening claims verified against code (DLQ alerts, health,
  staleness sweep all wired at base commit).
- `docs/github-app-listing.md` support matrix matches `capabilities.ts` (9 DRAFT_PR).
- KMS drill doc exists; production KMS is a stub — the doc must not be read as "KMS done."
- OTel is stub-by-default; no Sentry/error tracking in apps.
- `apps/web/src/app/(marketing)/page.tsx` (uncommitted, carried into this branch): says
  "8 vendors ship with proven auto-fixes" — stale (9 DRAFT_PR connectors). Fix on this branch.

## 5. Next steps

WP1 (domain vocabulary + capability matrix) per spec §17 order. Branch hygiene: one work
package per commit/PR, gates re-run per package, this file updated per §19.9. `main` stays
locked (branch protection + Railway tracking `main` only); merges via green PR only.
