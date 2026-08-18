# Patchbay — Development Ledger

Status as of this commit. Everything under **DONE** is implemented, tested, and
passing (`pnpm typecheck`, `pnpm lint`, `pnpm test` = 392 tests). Everything
under **PENDING** is scoped but requires money, credentials, or infra — do them
after funding.

## DONE (code-complete, verified)

### Security hardening (from deepsec AI scan + manual triage)

- **Session secret fail-closed** — `apps/web/src/lib/session.ts`: refuses to sign
  with a known default; `readSessionCookie` fails closed when misconfigured.
- **Constant-time HMAC verify** — `crypto.subtle.verify` replaces the manual
  byte loop (timing-safe).
- **Login brute-force protection** — in-memory fixed-window rate limiter
  (`apps/web/src/lib/rate-limit.ts`), `429 RATE_LIMITED` domain error.
- **Rate-limit header-spoofing fix** — `x-forwarded-for` no longer trusted
  blindly; `TRUSTED_PROXY_CIDRS` allowlist or shared `unknown` bucket.
- **Global fallback password removed** — `login/route.ts` fails closed when
  `DEMO_USER_PASSWORD` is unset; seed no longer logs the password.
- **Cross-tenant auth gap fixed** — `create-pr.ts` verifies the plan's change
  event + repository belong to the job's org before acting.
- **Path traversal fixed** — `run-validation.ts` validates patch `filePath`
  resolves inside the disposable workspace; added tenant check.
- **Scan race condition fixed** — `scan-repository.ts` ownership-read +
  delete + create now in one interactive transaction.
- **WORM audit log (schema-enforced)** — `20260811100000_audit_worm` trigger
  `enforce_audit_append_only` blocks UPDATE/DELETE/TRUNCATE on `AuditLog` at
  the database level (defense-in-depth under the service-layer guard);
  `packages/audit/src/redact.ts` also now strips GitHub App access tokens from
  `changed` snapshots. Verified by 4 migration tests + redaction tests.
- **Secret store abstraction** — `packages/env/src/secrets.ts` centralizes
  credential access/validation (`AUTH_SECRET`, `DEMO_USER_PASSWORD`,
  `SESSION_SECRET`, GitHub OAuth/App secrets) so mechanism changes
  (env → secret manager) are one-file swaps; `packages/git-provider` reads App
  credentials through it, no direct `process.env` in providers.
- **Sandbox runner interface** — `packages/sandbox-runner` now exposes a
  `ValidationRunner` contract: deterministic local runner for dev/tests plus a
  **container backend** (`SANDBOX_RUNTIME=container`): each allowlisted command
  runs in an ephemeral Docker container with `--network none`, `--cap-drop ALL`,
  `--security-opt no-new-privileges`, read-only rootfs (workspace is the only
  writable path), CPU/memory/PID caps, static minimal environment (no host
  secrets), and hard timeout via container SIGKILL. Verified by 5 live Docker
  integration tests (run, timeout-kill, egress blocked, redaction, env
  isolation) + args/env unit tests; worker warns once if the runtime is
  selected but Docker is down. A microVM-safe stub closes the loop for a
  future Firecracker backend (no DB/network, fails loudly today).
- **Redis & queue hardening** — `packages/queue/src/url.ts` validates Redis
  URLs (protocol, host allowlist, no credentials in URL), worker rejects
  oversize jobs (> 1 MiB), and rate-limit / retryable queue failures are
  classified as `RateLimitError` (no poison-message retry loops).
  `pnpm verify:lockfile` (root script) = frozen-lockfile install so dependency
  drift is caught at CI time, and `redis-kernel` is pinned to a 7.x-compatible
  version in the lockfile.
- **ReDoS hardening** — `redactGitHubSecrets` PEM pattern bounded
  (`[A-Za-z0-9+/]{500,}={0,2}` → `{170,2048}`) to kill quadratic backtracking
  on unclosed `-----BEGIN` markers; regression tests are timing-guarded
  (adversarial 500 KB inputs complete < 2 s), connector glob matching is
  linearity-tested (`packages/vendor-connectors`), and the audit sanitizer gets
  the same treatment.

### Connector moat (the product's core value)

- **Connector SDK** — `packages/vendor-connectors/src/sdk.ts`:
  `defineConnector()` turns a declarative spec into a full `VendorConnector`
  (cutting authoring boilerplate, enforcing the pure contract, and supporting
  glob identifiers like `@google-cloud/*`).
- **56-connector catalog** (5 → 56), each tested. Groups: AI/LLM (openai,
  anthropic, gemini, mistral, deepseek, cohere, groq, replicate, langchain,
  huggingface), cloud/infra (aws-sdk, google-cloud, azure-sdk, vercel,
  cloudflare, terraform, kubernetes, digitalocean), payments (stripe, paypal,
  square, plaid, adyen, lemon-squeezy), auth (auth0, clerk, okta, keycloak,
  next-auth, passport), messaging (twilio, slack, sendgrid, discord, telegram,
  socket.io), data/DB (prisma, drizzle, typeorm, sequelize, mongodb, mongoose,
  redis), frameworks (express, react, next, vue, trpc), search/observability
  (elasticsearch, algolia, sentry), CRM (salesforce, hubspot), generic
  (generic-openapi).
- Registered in `packages/vendor-connectors/src/registry.ts` (exports
  `listConnectorSlugs()` for catalog surfaces); exported from the package index.
- Tests: `connector-catalog.test.ts` + `connector-pack.test.ts` (34 connector
  tests total).

### GitHub App integration (real PRs, webhooks, OAuth)

- **`GitHubAppProvider`** (`packages/git-provider/src/github-app-provider.ts`) — App RS256 JWT
  (`createAppJwt`, node:crypto, no Octokit dep), installation access tokens, draft PR creation
  via delegated PAT provider, live repository metadata fetch (connect flow). 8 unit tests.
- **Install binding** — `/api/github/install` → signed expiring state cookie →
  `/api/github/callback` (state + API-validated, org-bound, single-binding per installation).
  Webhooks can enrich/suspend but never create bindings.
- **Webhook receiver** (`/api/webhooks/github`) — HMAC `x-hub-signature-256` verification,
  delivery dedup via unique `WebhookDelivery` (migration
  `20260810100000_webhook_delivery_deduplication`), installation lifecycle sync, monotonic PR
  status (`DRAFT → OPEN → MERGED/CLOSED`, no regressions), `PR_STATUS_SYNCED` audit events.
- **Worker wiring** — `create-pr.ts` resolves the repository installation and builds the App
  provider per plan; tenant check (event + repository org) verified before acting.
- **NextAuth OAuth sign-in** — `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` enable "Continue with
  GitHub"; custom Prisma adapter creates a dedicated org per first-time signup; dev cookie
  remains the default and fails closed in production.
- **Tenant scoping migration** `20260809091648_tenant_scoping_github_app` — direct
  `organizationId` columns on operational tables (Repository, ImpactAssessment, RemediationPlan,
  PullRequest, ValidationRun, …) with indexes and seed backfill.

### CI / supply chain

- `ci.yml` actions pinned to verified commit SHAs.
- `deepsec.yml` PR-review workflow (NIM route via Pi agent, pinned actions).

### Software intelligence graph (roadmap Phases H0–H2)

Engineering report for the Release Watchtower → software graph → impact loop:

- **IMPLEMENTED**
  - Graph schema `GraphSnapshot/GraphNode/GraphEdge/GraphSourceEvidence/GraphIndexJob`
    (migration `20260811184049_software_intelligence_graph`), composite indexes
    `(org, repo, snapshot, kind)`, `(org, snapshot, fromNodeId)`/`toNodeId`, unique content
    `(snapshotId, kind, stableKey)`; all 5 models org-scoped, enums mirrored in
    `packages/domain` (drift-tested).
  - Deterministic extractor `packages/repo-analysis/src/graph.ts`: repo root, file, module,
    dependency, package, client, API operation, test, symbol nodes; USES_PACKAGE /
    RESOLVES_TO / CREATES_CLIENT / INVOKES_API / IMPORTS / TESTS edges; provenance
    EXTRACTED/RESOLVED/INFERRED with fixed confidence; content hashes (file sha256,
    synthetic factHash); sorted evidence; no timestamps or randomness. 7 tests.
  - Full baseline + GitHub **push-webhook incremental** indexing jobs (`graph-index.ts`):
    unchanged-commit snapshots are **reused** (README job `READY`, audit `GRAPH_INDEX_REUSED`),
    new snapshots are immutable (INDEXING → READY in one transaction, chunked `createMany`
    with `skipDuplicates`, explicit edge ids so evidence can link `nodeId`/`edgeId`);
    `scan-repository` now persists commit-keyed `RepositoryDependency` rows.
  - Tenant-scoped graph reads (`packages/db/src/graph-reads.ts`): `latestSnapshot`,
    `impactByKind`, `packageImpact` (dep node → every using module with edge kinds and
    evidence counts); route `GET /api/repositories/[id]/graph?package=<name>`.
  - Release classification: pure semver (`packages/domain/src/semver.ts`, `^`/`~`/`x-y`/
    exact/*, null-opaque); `classify-release.ts` uses connector `normalizeChange` plus a
    `KNOWN_MIGRATIONS` table (openai→4: `createChatCompletion`→`chat.completions.create`,
    response-unwrap, etc.), deterministic facts with `requiresHumanReview` on breaking;
    `match-release.ts` emits `ReleaseRepositoryMatch` only on exact resolved version or
    range-admitted version (each with an explainable match reason).
  - Routes: `POST/GET /api/releases`, `GET /api/releases/[id]` with per-match graph
    evidence; duplicate recording is idempotent (200 + existing id, no re-enqueue).
  - Dashboard: `/releases` list (classification, breaking/review badges, per-org match
    counts, record-release form), `/releases/[id]` (facts, change drafts, why-affected
    evidence per matched repository via graph evidence).
  - `serverExternalPackages` now includes the `@patchbay/*` packages: bundling
    `@patchbay/domain`'s `node:async_hooks` logger tripped webpack ("Unhandled scheme").

- **REUSED**: existing enum/org-scope/audit conventions, `getConnector`/`normalizeChange`
  connector SDK, worker `enqueue`/audit pattern, additive enums only (ReleaseStatus/Source/
  MatchStatus/ClassificationMethod existed), fixture repos via existing `resolveFixtureDir`,
  UI primitives (`Table`, `Card`, `StatusPill`, `Badge`, `EmptyState`), E2E probe convention
  (minted dev session + CSRF + direct HTTP).

- **CHANGED**: `scan-repository.ts` (dependency inventory persisted), GitHub webhook route
  (push events enqueue incremental graph-index jobs), `next.config.ts`, `ORG_SCOPED_MODELS`,
  `packages/db`/`packages/domain` index exports, audit actions + `JobType`.

- **VALIDATED**: `pnpm format`/`lint`/`typecheck` clean; **553 tests / 42 files pass**
  (7 graph extractor, 8 semver, 5 match-release, 8 ai-harness, 3 corpus replay, plus
  regression suites); live E2E on the seeded openai fixture: graph READY → release →
  classification → match → agent plan run SUCCEEDED (analyst/planner/reviewer steps, 1
  hash-bound edit, independent review approved, digest set, 0 cost).

- **REMAINING (roadmap H2+)**: incremental per-file content-hash skip + importer re-extract
  (currently full re-extraction with snapshot reuse — path deltas are recorded on the job),
  `ReleaseEvidence`/DetectionRun ingestion adapters, AFFECTED_BY link-ups, more migration
  tables (stripe/twilio), agent-facing graph tools.

- **Agent harness (roadmap Phase H3 — first version delivered)**:
  - `packages/ai-harness` (new): plan/review calls behind `AiProvider`, schema-validated
    output only, per-run call budgets before persistence, `redactedInputDigest` replay
    identity, `bindSourceHashes` invalidates edits whose file content can't be bound.
  - `AgentRun`/`AgentStep` persistence (migration `20260812025413_agent_runs`), `agent-plan`
    BullMQ job (ANALYST bounded graph query → PLANNER one call → REVIEWER independent),
    audit actions for queue/start/completed/failed/cancelled/budget, cancel-aware steps.
  - API: `POST /api/releases/[id]/plan` (idempotent per match), run list/detail/cancel routes.
  - H2 fixture corpus (`remediation-engine/src/corpus.test.ts`): replay gate for
    openai/stripe/twilio v4+ releases with recall + precision assertions; it caught and
    fixed a no-op stripe suggestion (now a metadata-required insert rule).
  - Mock provider is the default; `AI_PROVIDER=openai` switches to the real client, both
    going through the same typed harness.

- **RISKS**: low — no AI in this loop; graph facts are deterministic and evidence-linked;
  snapshot storage grows per commit (retention policy pending).

- **DEVIATIONS**: extraction re-runs the full repo per job (readme pragmatic choice, reuse
  on unchanged sha); no `AMBIGUOUS` provenance emitted yet; `repo:root` evidence requires
  a primary manifest; repositories are validated against `repository.metadata.fixture`.

- **NEXT BEST STEP**: per-file content-hash skip with importer/caller re-extract (roadmap
  incremental indexing step 3-4), then roadmap Phase H4 (Mastra workflow adapter with the
  release/impact analysts and evaluation gates before policy can permit a draft PR).

- **Automated Watchtower evidence (session H4 — delivered)**:
  - **Adapter contract upgraded** (`packages/vendor-connectors/src/watchtower.ts`): `fetch(cursor?)`
    now returns `{ evidence, cursor }`; every adapter is conditional (ETag replayed as
    `If-None-Match`) and persists an opaque `AdapterCursor` on `DetectionRun.cursor`, so a poller
    restart never re-emits observed evidence.
  - **npm adapter**: polls the packument (abbreviated accept type), emits every version published
    since the cursor with its chronological `previousVersion`; 304 short-circuits.
  - **GitHub releases adapter**: ETag-conditional poll, skips drafts/prereleases, strips `v`
    prefixes, emits releases newer than the cursor with the predecessor tag as `previousVersion`.
  - **OpenAPI adapter**: new deterministic `openapi-diff.ts` (added/removed operations, shape
    change detection that ignores descriptions/examples, `breaking` fact set). The adapter stores
    the previous spec in its cursor and attaches `apiDiff` facts to evidence instead of raw
    snapshots. First poll has no diff basis; unchanged content hash emits nothing.
  - **detect-releases worker**: resumes from the last COMPLETED run's cursor, persists the new
    cursor per run, reconciles `previousVersion` on already-observed releases (updateMany when
    null), honors a `batchSize` cap.
  - **Automated scheduling** (`apps/worker/src/schedule/watchtower.ts`): BullMQ job schedulers
    registered at worker boot — `watchtower-npm-openapi` every 15 min, `watchtower-github` every
    30 min. Gated by `WATCHTOWER_POLLING_ENABLED` and interval env vars in `packages/env`.
  - **VALIDATED**: 27 new tests (4 npm adapter, 4 github adapter, 5 openapi-diff, 4 openapi
    adapter, 5 detect-releases worker, 2 scheduler, 3 existing suites unaffected); mocks use real
    `Response` objects with ETag/304 semantics. Full suite green at commit time.

- **Semver hardening + historical match corpus (session H5 — delivered)**:
  - `packages/domain/src/semver.ts` semantics now match npm for the shapes Patchbay needs:
    caret admits any patch/minor in the same major (`^3.3.0` admits 3.4.0), tilde is capped at
    the next minor (`~13.0.0` admits 13.0.x only), stable ranges never admit prerelease
    versions, prerelease ranges admit only the identical identifier, AND-composed pairs
    (`>=3.0.0 <4.0.0`) and `x.y.z - a.b.c` spans are supported, and `compareVersions` returns
    0 for identical prereleases. Opaque input still returns false/null (never guessed).
  - New pure matching core `packages/domain/src/matching.ts` (`evaluateReleaseMatch`); the
    `match-release` worker now calls it (same reason strings, no behavior drift).
  - New hand-labeled corpus `packages/domain/src/match-corpus.ts` + `match-corpus.test.ts`:
    10 realistic repos × 10 historical releases (openai 3.x/4.x incl. a prerelease, stripe
    12/13, twilio 3/4) with explicit ground truth, aggregate + per-vendor precision/recall
    gates (recall ≥ 95%, precision ≥ 90%), non-vacuity checks, and no-positive-bias
    regression cases. Re-running the corpus is now a conscious re-labeling exercise
    instead of silent drift.
  - **VALIDATED**: 11 semver tests + 9 corpus tests (20/20), full suite green.

- **File-level incremental graph repair (session H6 — delivered)**:
  - `extractGraph` accepts `changedFiles?: Map<relPath, sha256>`; when provided, only the
    listed files are re-extracted (structured per-file facts + tracked-usage evidence), and
    unchanged files retain their prior snapshot facts via contentHash matching at the caller.
    Binding resolution passes still run over the whole repo so imports stay correct.
  - `graph-index` worker passes `changedPaths` from an INCREMENTAL graph-index job into
    `extractGraph` (baseline unchanged; unchanged-commit reuse already existed).
  - **VALIDATED**: 2 new incremental tests (filtered re-extraction; changedFiles covering
    every file produces baseline-identical node/edge key sets).

- **Graph edge vocabulary extension (session H7 — delivered)**:
  - New edge kinds `CONFIGURES`, `USES`, `PROVIDES`, `QUEUE_TOPIC` added to
    `GraphEdgeKind` in `packages/domain` and mirrored in `prisma/schema.prisma`
    (migration `20260812030000_graph_edge_kind_extended`); enum drift test extended
    across all 36 domain/prisma enums.
  - `StableEdgeKinds` / `VolatileEdgeKinds` partition the edge vocabulary: structural
    edges are safe for automated change, dependency/release edges (DECLARES, RESOLVES_TO,
    USES_PACKAGE, AFFECTED_BY) require human review before automated patch application.
  - **VALIDATED**: 250 enum drift assertions green; lint/typecheck/test/build clean.

- **Full-loop evaluation gates (session H8 — delivered)**:
  - New `packages/remediation-engine/src/eval-corpus.ts` + `eval-corpus.test.ts`: a replay
    corpus that runs the complete deterministic relay per supported vendor against the real
    fixture repositories — release evidence → dependency/API match (`evaluateReleaseMatch`)
    → connector normalization → deterministic plan (`generatePlan`) → patch validation
    (re-parse via exported `reparseCheck`) → policy outcome (`evaluatePolicy`).
  - 8 labeled entries across openai/stripe/twilio (exact-pin 3.3.0/16.12.0/3.84.0 matches with
    migration patches and a subsequent-major no-match case each) plus auth0 (AUTH gate, no
    auto patch). Ground truth is explicit per (entry, aspect), so matcher/connector/engine/
    policy changes demand conscious re-labeling.
  - Reports the roadmap launch metrics: dependency match recall ≥95%, affected-usage match
    precision ≥90% with zero false-positive alerts, automatic patch validation ≥80%,
    policy outcome correctness 100% (all measured 100% today; all 3 remediation entries
    land on REQUIRE_APPROVAL — every current connector change is breaking).
  - **VALIDATED**: 17 new tests; 611 tests / 50 files green, lint/typecheck clean; this is
    the measured-fixture baseline the Mastra reviewer workflow (session H9) must beat.

- **Mastra-contract workflow + manual replay (session H9 — delivered, roadmap Phase H4)**:
  - New `packages/ai-harness/src/workflow.ts` (+23 tests total for the phase): the Mastra
    workflow _contract_ without the `@mastra/core` dependency — `defineWorkflow` with typed
    steps, per-step tool allowlists (enforced by the runner), declaration-ordered parallel
    waves (`dependsOn` gates independent analysts to run concurrently), explicit
    success/failure transitions (including skip-to-target and transitive dependent skips),
    failure mapping by error name (`BudgetExceededError` → BUDGET_EXCEEDED,
    `PlanSchemaError` → SCHEMA_VIOLATION, tool-allowlist violations → TOOL_FAILURE,
    unknown → UNKNOWN; custom classifiers supported), evaluation gates recorded per run,
    abort signals (pre-abort skips everything; runStep-level aborts fail the next step),
    and manual replay that hydrates COMPLETED steps after verifying each carried step's
    input digest (input mismatch ⇒ `WorkflowDefinitionError`).
  - Worker: `apps/worker/src/lib/agent-workflow.ts` defines the Phase H4 workflow — release
    analyst (`getReleaseFacts`) ∥ impact analyst (`getAffectedUsageSubgraph`) → planner
    (no tools, plan-only, fixture source-hash binding) → reviewer (no tools) → gates
    `plan-gate` (breaking ⇒ ≥1 edit) and `review-gate` (independent approval), each gate
    recorded on the run. `agent-plan` job refactored onto it (STEP rows, audit events, and
    budget/terminal semantics preserved); run inputJson + workflow step records are now
    persisted on EVERY terminal state so replays work from failures.
  - Manual replay: `JobType.AGENT_REPLAY` (`agent-replay` job) re-executes a FAILED or
    BUDGET_EXCEEDED run from its first non-completed step with the same input/definition
    (digest-verified carry-over; new AgentStep rows per replayed step), triggered by
    `POST /api/runs/[id]/replay` (role-gated, audited via new `AGENT_RUN_REPLAYED`).
  - **VALIDATED**: 18 adapter tests + 5 worker workflow tests; 634 tests / 52 files green,
    lint/format/typecheck clean. Mastra-core stays deferred per the roadmap's own risk
    table — BullMQ/Postgres remain the workflow authority; the adapter mirrors the Mastra
    step/transition/parallel surface so a real `@mastra/core` flow can replace it behind
    the same contract.

- **Planner/reviewer performance measurement (WP8 — delivered)**:
  - New `packages/ai-harness/src/measure.ts` + `measure.test.ts` (+10 tests):
    provider-neutral `measureWorkflow` runs the bounded planner →
    independent-reviewer sequence N rounds through the existing
    budget/schema-validated harness and aggregates wall + provider latency
    (p50/p95/max via nearest-rank `percentile`), token usage, cost estimate,
    and classified failures (error examples capped at 3); verdict PASS/FAIL
    against thresholds (p95 ≤ 15 s, failure rate ≤ 20%, cost ≤ 100¢/run).
  - Worker CLI: `pnpm --filter @patchbay/worker bench`
    (`apps/worker/scripts/bench-planner-reviewer.ts`) — deterministic mock by
    default; `AI_PROVIDER=ai-sdk` + `OPENAI_API_KEY` for live measurement of
    the real 2-call sequence; exits 1 on a failed verdict.
  - Mock-mode baseline (5 rounds): planner wall p95 10.2 ms (mean 2.5 ms),
    reviewer p95 1.4 ms, provider latency 0, cost 0, verdict PASS — harness
    overhead only; the model call dominates real latency.
  - **Mastra decision: not adopted.** The measurement plus the existing
    Mastra-contract adapter show `@mastra/core` would add orchestration over
    the two-step sequence without reducing complexity or improving
    quality/cost; BullMQ/Postgres stay the retry/state authority and the
    adapter remains the swap point for the fixed role sequence with per-role
    tool allowlists.
  - **VALIDATED**: 10 new tests; 828 tests / 70 files green, lint/format/
    typecheck clean, production build green.

## PENDING (needs money / credentials / infra)

### Critical path (the product is not sellable without these)

- [ ] **GitHub App depth** — check runs, review comments, commit signing, PR merge (policy-gated),
      token rotation/revocation UI.
      (Install flow, webhooks, draft PRs, and OAuth sign-in are DONE — see above.)
- [ ] **Sandbox hardening** — microVM isolation (Firecracker/gVisor) per
      validation run. The container backend (no network, dropped caps,
      read-only rootfs, resource limits) is DONE behind
      `SANDBOX_RUNTIME=container`; the process backend is the default and is
      still explicitly "NOT a hardened multi-tenant sandbox".
- [ ] **Real auth** — SSO (SAML/OIDC), SCIM, MFA, per-tenant BYO-AI-keys,
      data residency (EU/US), fine-grained RBAC.
- [ ] **AI-generated patches** (not just advisory notes) with rule-engine
      verification, plus a feedback loop that learns from accepted/rejected
      patches and calibrates confidence.
- [ ] **AI cost controls** — per-org budgets/quotas, multi-provider failover,
      model tiering (cheap triage vs strong patch gen).

### Connectors

- [ ] Connector marketplace / plugin registry (community-contributed, versioned).
- [ ] AI-generated connectors from changelogs/OpenAPI diffs.
- [ ] Version monitoring — track SDK versions in lockfiles, alert before majors.
- [ ] Batch migrations across repos (Codemod.com model).

### Integrations

- [ ] GitLab / Bitbucket / Azure DevOps providers (enterprise self-host TAM).
- [ ] Slack / Teams notifications + slash commands.
- [ ] Jira / Linear ticket creation.
- [ ] SARIF export (GitHub Advanced Security / DefectDojo).
- [ ] Snyk / Dependabot ingest.
- [ ] Webhooks out (audit events → SIEM: Splunk/ELK), hash-chained evidence.
- [ ] IDE extensions (VS Code / JetBrains) — inline "this breaks in v5" hints.
- [ ] Public API SDK + OpenAPI spec.
- [ ] OpenTelemetry / Datadog / Sentry telemetry.
- [ ] First-party GitHub Action (own action, not deepsec's).

### Governance & enterprise

- [ ] Policy-as-code (versioned in git) + dry-run simulation.
- [ ] Audit → SIEM export, retention policies, tamper evidence.
- [ ] Approval evidence linked to PRs in audit trail.
- [ ] Compliance mappings (SOC2 / PCI / HIPAA controls).
- [ ] Self-hosted: Helm charts, air-gapped install, license keys.

### Product / business

- [ ] Value metrics dashboard (findings→fixed, MTTR, FP rate, cost/migration).
- [ ] Benchmark suite proving patch correctness.
- [ ] Open-core the scanner + connectors (Apache-2.0), monetize governance.
- [ ] Pricing tiers + billing integration (Stripe is already a connector 🙂).
- [ ] Free tier that's genuinely useful (1 repo, pattern scan, PR comments).

## Suggested order after funding

1. Sandbox hardening → unblocks enterprise + auto-merge.
2. SSO (SAML/OIDC/SCIM) + team invites on top of GitHub OAuth.
3. AI-generated patches + feedback loop → the differentiator.
4. Slack + SARIF + webhooks → cheap, high-perception integrations.
5. Connector marketplace + AI-generated connectors → the moat.
6. Open-core the scanner, sell the platform.
