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

## 5. WP1 — Domain vocabulary & capability matrix (DONE 2026-09-05, branch `feat/production-spec`)

- `packages/domain/src/capability-matrix.ts` (new): 7 contract kinds (REST, GRAPHQL,
  SDK, MCP, WEBHOOK, ASYNC, AUTH_CONFIG) + 7 capability dimensions per spec §2.2
  (detection/normalization/analysis/remediation/validation/delivery/certification) as
  const objects + Zod schemas, `certificationAtLeast` rank ordering,
  parse/serialize helpers (byte-identical round-trip), `CAPABILITY_VOCABULARY` export.
  Deliberately not mirrored in Prisma yet (no table stores a matrix until WP2).
- `RiskTag` extended with AUTHORIZATION, SECRETS, ENCRYPTION (spec §8.2 classes) +
  Prisma schema + migration `20260905000000_risk_tag_extended`. Policy wiring of the
  new tags stays in WP5 by design (vocabulary now, enforcement later).
- Drift kills found by the compiler during WP1 (the process working as designed):
  `aiPlanDraftSchema`/`patchPlanSchema` hardcoded the 7-value tag list (now
  `z.nativeEnum(RiskTag)`); `apps/web/src/lib/format.ts` label/tone maps gained the
  three tags; `HIGH_RISK_APPROVAL_TAGS` untouched (WP5).
- Stability tests: `capability-matrix.test.ts` (6: value pins, rank ordering,
  serialization round-trip, rejection, vocabulary export) + `errors-stable.test.ts`
  (2: 12-code public set pinned, round-trip). Policy `reasons` stay free-form human
  strings; standardizing them into codes is WP5, not WP1.
- API: `GET /api/capability-matrix` (public, registry-route shape) + route test.
- Verification: prettier clean, eslint 0 warnings, typecheck 19/19, domain suite
  363 passed (drift 308 both directions), capability-matrix route green, regression
  sweep 38 files / 336 tests green (ai-provider, ai-harness, policy-engine,
  remediation-engine engine, vendor-connectors, web lib).

## 6. WP2 — Contract source & snapshot pipeline (DONE 2026-09-05, branch `feat/production-spec`)

- Models + migration `20260905000001_contract_pipeline`: `ContractSource`
  (nullable org = public; `@@unique` org-side + raw partial unique index for the
  NULL-org side, since Postgres NULLS DISTINCT skips them), `ContractSnapshot`
  (`@@unique(sourceId, contentHash)`), `ContractChange`
  (`@@unique(sourceId, toSnapshotId, identity)`; nullable `fromSnapshotId` for
  genesis). `Organization.contractSources` back-ref added.
- Tenant boundary: `ContractSource` joins `ORG_SCOPE_EXEMPT_MODELS` (MIXED
  public/org like Vendor; reads filter `organizationId IN {NULL, org}` explicitly;
  exempt-list test updated). Snapshots/changes carry no org column — boundary is
  the source join, enforced in the pipeline service. RLS deliberately NOT enabled
  on these tables (would hide the public catalog — documented in the migration).
- `ContractProviderAdapter` interface (`packages/vendor-connectors/src/contract-provider.ts`):
  spec §5.2 shape (verifyInboundEvent/fetchCurrentSnapshot/normalize/diff/
  getMigrationHints) with Zod schemas; fake-adapter conformance test proves
  implementability (fetch→normalize→diff→hints closed loop).
- Content addressing: `canonicalJson` + `sha256Hex` (key-order invariant, array-order
  significant, fail-closed on ambiguous values) + 5 tests.
- Polling hardening (the verified gap): `fetchWithTrustRetry` — 429 honors Retry-After
  (new `retryAfterMs` on TrustViolationError, additive), 5xx/timeout/transport get
  exponential backoff + jitter, trust rejections and 4xx throw immediately,
  classification preserved on exhaustion. Wired into the npm packument poll
  (reference path; other adapters follow the same one-line pattern later).
  Pre-existing strength kept: ETag/If-None-Match, defensive cursors, receipt dedupe,
  staleness watchdog. 7 retry tests.
- Pipeline service `apps/worker/src/lib/contract-pipeline.ts`: `ingestContractSnapshot`
  (scope check → hash → dedupe → store raw via `storeRawEvidence` with hash-agreement
  guard → snapshot row → persist caller-computed changes only on normalized movement;
  genesis records snapshot only). Triple idempotency (content dedupe, pre-check +
  P2002-converge on the change key, no-op re-ingest). 8 tests incl. cross-org
  rejection, hash-mismatch refusal, race convergence, malformed-change refusal.
- `zod@^4.0.0` added to `@patchbay/vendor-connectors` (lockfile reconciled, frozen
  install passes).
- Verification: prettier clean, eslint 0 warnings, typecheck 19/19, 30 new tests
  green, regression sweep (vendor-connectors + db: 28 files / 211 tests) green.
  Migration applies via standard `db:migrate` (CREATE TABLE + partial index, no
  data movement).

## 7. WP3 — Consumer graph expansion (DONE 2026-09-05, branch `feat/production-spec`)

- `ContractConsumer` model + migration `20260905000002_contract_consumer`
  (org/repository/source/identifier/versionRange unique with a partial index for
  NULL ranges; multi-tenant indexes; RLS tenant policy — safe: org non-nullable).
  Back-refs on Organization/Repository/ContractSource/GraphSnapshot. Scoped via
  `ORG_SCOPED_MODELS` (drift test green).
- Graph node kinds `MCP_SERVER` + `EVENT_HANDLER` (domain + Prisma + migration;
  drift 310 both directions). No new edge kinds — both layers reuse `CONTAINS`
  (`repo:root` → server, `module` → handler), which the key-based incremental
  merge already handles correctly.
- MCP layer in `extractGraph`: one node per wired server (evidence = config file +
  its walked-tree content hash; content-sensitive `contentHash` so config edits
  converge by key) + `repo:root CONTAINS` edges + `DEPENDENCY` nodes for
  `@modelcontextprotocol/*` packages even without tracked usage. Deliberately no
  call-site edges: statically undecidable, documented as future work (tool-name
  references, spec §2.3).
- Event-handler detection in the structural pass: conservative Express-style
  `app|router.<method>("literal")` only (no templates/variables/middleware);
  missing facts acceptable, wrong facts forbidden. Confidence 90, EXTRACTED.
- `contractConsumersFromExtraction` pure mapper (repo-analysis): DEPENDENCY→SDK
  (registry-decided via caller-supplied kinds; frameworks never become contracts),
  MCP_SERVER→MCP (90), EVENT_HANDLER→WEBHOOK (80); every descriptor bound to
  commit SHA + source hash + extractor identity. Persistence wiring is WP4.
- Fixture `mcp-agent-legacy` (configs, SDK dep, routes, pnpm lockfile) + graph
  assertions + incremental-corpus entry. Full-vs-incremental proven: 17/17
  (leaf, reverse-importer, lockfile × 5 fixtures). No MCP/invalidation changes
  needed: configs flow as normal changed files, merge converges by key.
- Drive-by fix: pnpm parser dropped double-quoted scoped keys
  (`"@scope/pkg@1.0.0":`) — unquoted form worked, quoted form silently lost the
  version. Fixed + covered; this exact gap would have hidden MCP SDK versions.
- `EXTRACTOR_VERSION` 1→2 in graph-index (pre-WP3 READY snapshots never reuse as
  if they held the new facts; one full re-extract per repo on upgrade).
- Verification: prettier clean, eslint 0 warnings, typecheck 19/19, repo-analysis
  - graph-index suites 115/115 green (zero ripple in old fixtures), corpus 17/17.

## 8. WP4 — Maintenance case orchestration (DONE 2026-09-05, branch `feat/production-spec`)

- Schema + migration `20260905000003_case_orchestration` (applied clean to local
  Postgres with WP1–WP3 migrations: 5/5 applied, zero errors):
  `RemediationCase` += contractChangeId/caseKey/triggerType/dedupeKey (+ back-refs;
  `@@unique(organizationId, dedupeKey)`); releaseId/dependencyId relaxed to
  nullable (existing rows populated — no backfill); `ImpactAssessment` +=
  caseId/graphSnapshotId/affected/blastRadiusJson/evidenceJson/reasonCode +
  `@@unique(caseId, repositoryId)`, changeEventId relaxed to nullable;
  new `RemediationAttempt` (org/case/strategy/versions/agent/run hashes/status/
  artifact/failureCode) with RLS tenant policy + back-refs on
  Organization/RemediationCase/AgentRun/PatchArtifact.
- Orchestration `apps/worker/src/lib/case-orchestration.ts`: `orchestrateContractChange`
  (scope check → consumers → per-repo reconcile → OBSERVED create + timeline +
  audit + notification → assessments → IMPACT_CONFIRMED advance). Evidence-gated
  (no consumers = no case). Duplicates refresh receipt metadata only — no new
  rows, no timeline spam; terminal cases never reopen; races converge on the
  dedupe key. Release funnel untouched (scopeKey path intact); the two funnels
  share lifecycle enum, timeline writer, terminal protection, and audit discipline.
- `recordRemediationAttempt` wired into run-validation (SKIPPED/SUCCEEDED/FAILED
  with input/output hashes; legacy plans without case linkage skip honestly;
  recording never breaks remediation). Agent-planning attempts follow in WP7.
- Nullable-FK fallout paid in full: worker create-pr/run-validation fail closed
  on missing change events; capability-sweep null-tolerant; 3 PR vectors
  fail-closed; 6 dashboard render paths degrade gracefully (contract identity
  shown where release data is absent). Full typecheck 19/19 proves no reader left behind.
- Verification: 10 orchestration tests (dedupe stability, per-repo cases,
  evidence gate, cross-org rejection, duplicate convergence, terminal protection,
  repo narrowing, attempt provenance/skip/failure-isolation); regression 40 files /
  559 tests green (worker + db + domain + touched web routes). `CaseReasonCode.CONTRACT_CHANGE`
  added (pre-existed in domain enums; String column, no migration).

## 9. WP5 — Policy + certification hardening (DONE 2026-09-05, branch `feat/production-spec`)

- Enum alignment (spec §8.1): `ALLOW_PLAN_ONLY`→`PLAN_ONLY` + new `ASSESS`/`SUPPRESSED`
  across domain, Prisma (migration renames + adds), `policyDecisionResultSchema`,
  engine, corpus expectations (~20 entries), policy tests, and docs. Deliberate,
  documented deviation: `ALLOW_VALIDATE` stays — the staged engine needs the
  transient "validated, PR not yet permitted" state §8.1 does not name; folding
  it into REQUIRE_APPROVAL would force approvals where none are needed.
  Corpus 35/35 confirms zero behavior drift from the rename.
- Models + migration `20260905000004_policy_certification` (applied clean):
  `PolicyDecisionRecord` (org/case/policy/decision/reasonCodes/riskTags/
  confidence/versions + RLS + org-leading indexes) and `ConnectorCertification`
  (global catalog mirror, unique connector+version, no RLS — same rationale as
  shared Vendor rows). `PolicyDecisionRecord` scoped; drift green.
- Org-policy overlay: `then: SUPPRESSED/ASSESS` flow through existing `when`
  matchers (riskTags/vendor/validationStatus) with strength
  DENY>SUPPRESSED>ASSESS>REQUIRE_APPROVAL>… — safety refusals always beat admin
  silence. Suppressed cases record + audit but never notify. Quiet hours and
  grouping are explicitly deferred (documented in code), not implied.
- `PolicyDecisionRecord` writer in `upsertRemediationCase` (best-effort,
  never breaks reconciliation) + overlay/suppression/snapshot tests.
- `syncConnectorCertifications` worker helper: mirrors the static registry with
  honestly-mapped corpus metrics (usage precision→precision, patch-validation→
  patch rate, validation success stays null — never duplicated), expires
  superseded rule-pack versions. Standalone + tested; WP10 ops views consume it.
- Gate parity closed (the WP5 find): worker `create-pr` never called
  `requireCertified` nor the kill switch — an uncertified/suspended vendor
  reaching the job sailed through. Now enforced identically on both vectors
  (certification refusal + `assertWorkerCapabilityGateOpen`, worker-side twin of
  the web gate to respect app boundaries), failing loudly into the DLQ/alert
  path. Parity tests mirror the web fixtures verbatim (auth0 uncertified,
  openai suspended).
- Verification: prettier clean, eslint 0 warnings, typecheck 19/19, 434 tests
  green across worker/policy/domain/DB suites, corpus 35/35, migration applied
  to local Postgres.

## 10. Next steps

WP6 (deterministic remediation packs) per spec §17 order.
Branch hygiene: one work package per commit/PR, gates re-run per package, this file
updated per §19.9. `main` stays locked (branch protection + Railway tracking `main`
only); merges via green PR only.
