# Patchbay CTO Execution Plan

## Mission

Turn Patchbay into an external-software-change intelligence and remediation control plane. It must
detect a trusted vendor change, prove impact from repository evidence, apply only governed changes,
validate them in isolation, and create an auditable GitHub draft PR.

This is an execution handoff for Cursor/OpenCode. Preserve the existing architecture and complete
the work packages in order. Do not undo current features because they already form a substantial
foundation.

## Existing Baseline

| Area           | Current implementation                                                                                                                    |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Vendor catalog | 57 registered connectors across AI, cloud, auth, payments, data, messaging, frameworks, and observability                                 |
| Watchtower     | npm, GitHub Release, OpenAPI, and signed vendor-agent sources; scheduled polling; global release records/evidence/classification/matching |
| Software graph | TypeScript/JavaScript dependency inventory, commit-versioned snapshots, AST nodes/edges/evidence, baseline and incremental indexing       |
| Impact         | deterministic semver matching, explainable repository matches, graph evidence API and release views                                       |
| Remediation    | deterministic rules, source-hash binding, patch safety checks, policy engine, evaluation corpus                                           |
| AI harness     | provider-neutral planner/reviewer, typed plans, budgets, replay, AgentRun/AgentStep persistence, Mastra-compatible contract               |
| Delivery       | GitHub App, signed webhooks, short-lived tokens, draft PR lifecycle, append-only audit                                                    |
| Validation     | allowlisted commands, secret redaction, process/container runtimes, container no-network tests                                            |
| Quality        | 17-project typecheck and 683 tests in 55 files pass                                                                                       |

## Non-Negotiable Rules

- Keep tenant scope, CSRF, roles, audit events, redaction, source-hash checks, policy gates, and
  draft-PR default behavior intact.
- Do not give a model unrestricted shell, filesystem, Docker, network, GitHub, cloud, database, or
  secret access.
- LLMs are never the source of truth for releases, dependency versions, graph facts, policies, or
  validation results.
- BullMQ and PostgreSQL own durable retries, cancellation, state transitions, approval waits, and
  recovery. Agent frameworks execute bounded work inside those jobs.
- Do not add Neo4j, Kubernetes, vectors, or another queue before benchmarks prove the need.
- Do not claim a connector can auto-remediate merely because it exists in the catalog.

## Capability Contract

Show support by connector, package, and language. Do not use a single vague "supported" label.

| Level      | Meaning                                                             |
| ---------- | ------------------------------------------------------------------- |
| `DETECT`   | Trusted release evidence is observed and deduplicated               |
| `ASSESS`   | Dependency and graph evidence identify affected repositories/usages |
| `PLAN`     | A reviewable deterministic or AI-assisted remediation plan exists   |
| `VALIDATE` | A supported patch can be sandbox-validated                          |
| `DRAFT_PR` | A policy-permitted validated patch can create a GitHub draft PR     |

Add a `ConnectorCapability` registry (database or source-controlled configuration) with:

- vendor slug, ecosystem, package, language, and capability level;
- rule-pack and extractor version;
- validation profile and required policy class;
- evaluation corpus ID, owner, status, and expiry/review date.

All 57 connectors can be marketed under the appropriate `DETECT`/`ASSESS` level. Promotion to
`PLAN`, `VALIDATE`, or `DRAFT_PR` requires a trusted adapter, deterministic normalization, usage
analysis, migration rules, positive and negative fixtures, sandbox profile, and passing metrics.

## Target Control Plane

```text
Trusted vendor signal
  -> global release evidence
  -> dependency and graph impact proof
  -> remediation case
  -> policy eligibility gate
  -> bounded planner/reviewer
  -> deterministic patch engine
  -> hardened sandbox
  -> policy decision
  -> GitHub draft PR
  -> outcome feedback and evaluations
```

Create a parent `RemediationCase` record connecting release, repository, match, graph snapshot,
agent runs, plan, validation, approval, pull request, audit chain, and outcome.

```text
OBSERVED -> EVIDENCE_VERIFIED -> IMPACT_CONFIRMED -> POLICY_ELIGIBLE
-> PLANNING -> PATCH_PROPOSED -> VALIDATING
-> APPROVAL_REQUIRED | DRAFT_PR_CREATED | PLAN_ONLY | REJECTED
-> MERGED | CLOSED | LEARNED
```

Transitions must be tenant-scoped, idempotent, audited, and explicit. A case cannot skip policy or
validation by a retry or direct API call.

## Work Package 1: Fix Detection Resume Test

The test `resumes from the last completed run cursor` in
`apps/worker/src/jobs/detect-releases.test.ts` verifies the cursor reaching the adapter but leaves
release persistence mocks incomplete. It logs a `TypeError` during the test while still passing its
narrow assertion.

Complete the mocks and assert that the resumed adapter poll receives the prior cursor, writes a
`COMPLETED` `DetectionRun`, intentionally observes/deduplicates evidence, and makes no failure
update. Do not suppress the error or weaken test assertions.

## Work Package 2: Production-Safe Sandbox

### Changes

- Add explicit `development`, `test`, and `production` runtime modes.
- In production, reject `SANDBOX_RUNTIME=process` at startup and at validation execution.
- Require the container runner until an implemented microVM runner exists.
- Keep process execution only for local development/test with explicit opt-in.
- Harden containers: non-root user, read-only root filesystem, no host mounts/socket, dropped Linux
  capabilities, PID/CPU/memory limits, timeout, bounded output, disposable workspace, and no
  network by default.
- Permit package-registry egress only through an explicit policy; prefer an immutable dependency
  cache.
- Record runtime, image digest, limits, network policy, workspace provenance, and failure class on
  each validation execution.
- Refuse production-worker readiness if the container runtime is unavailable.

### Acceptance criteria

- Production cannot validate customer code using the host process.
- Tests prove no egress, no inherited secrets, no workspace escape, cleanup after all outcomes, and
  configured resource limits.
- Every validation result identifies the actual runtime and image digest.

## Work Package 3: Remediation Case and Policy-First Funnel

### Changes

- Add `RemediationCase`, its status enum, correlation ID, release/repository/match/snapshot links,
  reason codes, policy result, owner, and terminal outcome.
- Make a case unique for the intended release/repository/dependency/snapshot scope.
- Calculate blast radius from risk tags, affected usage count, ownership, capability level, and
  validation profile after matching.
- Run policy before creating `AgentRun`. Denied, unsupported, or insufficient-evidence cases stay
  visible as `ASSESS` results and must not spend model budget.
- Add case timeline/API/dashboard views with evidence, policy, agent, sandbox, approval, and PR data.
- Add cancel, replay, approve, reject, and permitted draft-PR actions.

### Acceptance criteria

- Duplicate polls/retries create one case per intended scope.
- A denied case never queues an AI run.
- Every case explains why it was detected, matched, planned, validated, approved, or rejected.
- Cross-tenant case reads reveal no data.

## Work Package 4: Exact-Commit GitHub App Checkout

### Changes

- Add a checkout service in `packages/git-provider` accepting organization, repository, installation,
  full name, and exact commit SHA.
- Obtain a short-lived GitHub installation token only inside the worker.
- Fetch exact commits safely. A SHA is not a branch: initialize a temporary repository, fetch the
  SHA shallowly, and use detached checkout; or verify a GitHub archive against the expected SHA.
- Disable hooks and credential persistence; never execute repository code during checkout.
- Create unique disposable workspaces and clean them after success, failure, cancellation, and stale
  job recovery.
- Store tree/source hashes in PostgreSQL; place approved raw artifacts only in encrypted object
  storage with retention controls.
- Keep fixture sources only for test/demo modes and prevent fixture mode in production.

### Acceptance criteria

- Integration test verifies exact SHA checkout and proves no token leaks to config, logs, database,
  artifacts, or browser output.
- Graph snapshots record commit and tree/source hashes.
- Cleanup is tested for success, error, timeout, and cancellation.

## Work Package 5: Graph Accuracy and Incremental Indexing

### Changes

- Keep immutable snapshots and only serve `READY` snapshots.
- Calculate changed files by webhook data plus content hashes.
- Use reverse `IMPORTS` and reliable reverse `CALLS` to identify invalidated files.
- Treat manifests, lockfiles, workspace configuration, codegen inputs, and API specs as invalidating
  their known dependents.
- Re-extract changed plus invalidated files; reuse facts only when source hash and extractor version
  match.
- Add a full-vs-incremental comparator corpus. Every incremental result must equal a clean full
  extraction for meaningful nodes and edges.
- Keep `EXTRACTED`, `RESOLVED`, `INFERRED`, `AMBIGUOUS` provenance. Inferred/ambiguous paths alone
  cannot authorize automatic changes.
- Add graph retention, compaction, quotas, result limits, hop limits, and traversal timing metrics.

### Acceptance criteria

- Incremental graph output matches full extraction in the corpus.
- Queries enforce organization/repository filters and bounded results.
- PostgreSQL graph p95 is measured before any graph database is considered.

## Work Package 6: Watchtower Trust and Evidence

### Changes

- Retain npm, GitHub Release, OpenAPI, and signed vendor-agent adapters.
- Add trust profiles: allowed domains, signature requirements, redirects, max response size, timeout,
  cadence, evidence confidence, and cursor format.
- Use ETags, `If-Modified-Since`, content hashes, source delivery IDs, and replay protections.
- Put raw release evidence in content-addressed object storage; retain only metadata/hash/reference
  in `ReleaseEvidence`.
- Treat an OpenAPI diff as an observation until deterministic classification establishes sufficient
  evidence. It is not automatically a trusted release.
- Build detector health views: last success, latency, cursor, evidence authenticity, error rate,
  release count, and backlog.

### Acceptance criteria

- Duplicate source events create one global release and no duplicate remediation cases.
- Invalid signatures, unexpected redirects, invalid domains, oversized content, and malformed
  cursors are rejected and audited.
- One adapter failure does not stop others.

## Work Package 7: Vercel AI SDK Integration

### Changes

- Keep the existing `AiProvider` interface and deterministic mock provider.
- Add Vercel AI SDK plus only the needed provider package(s) after consulting current package docs.
- Implement typed Zod structured planner/reviewer output using existing domain schemas.
- Configure timeout, cancellation, max output tokens, retries, model/provider allowlist, budget,
  quota, circuit breaker, and safe fallback policy.
- Persist provider request ID, model, latency, token usage, tool calls, schema result, redacted input
  digest, and cost in integer cents/micro-cents.
- Do not store chain-of-thought, secrets, or unbounded raw source in agent records.

### Acceptance criteria

- Tests cover malformed output, provider failure, timeout, cancellation, budget exhaustion, and
  fallback behavior.
- No provider key appears in logs, audit events, database, browser response, or snapshots.

## Work Package 8: Mastra Decision and Bounded Workflow

Do not introduce actual Mastra merely to claim an agent swarm. First measure the AI SDK planner plus
independent reviewer. Evaluate `@mastra/core` behind the existing workflow contract only if it
reduces complexity and improves quality/cost.

If adopted, use this fixed sequence:

```text
release analyst -> impact analyst -> migration planner -> independent reviewer
```

Each role receives a separate Patchbay-owned tool allowlist. Tools enforce organization scope,
repository scope, graph hop/result limits, source redaction, and audit. Mastra never owns retries,
policy, authorization, approval waits, database access, shell/Docker access, or GitHub writes.

**Status: DELIVERED (WP8).** Planner/reviewer performance measurement added —
`measureWorkflow` in `packages/ai-harness/src/measure.ts` runs the bounded
planner → independent-reviewer sequence N rounds through the existing
budget/schema-validated harness and aggregates wall + provider latency
(p50/p95/max), token usage, cost estimate, and classified failures; verdict
PASS/FAIL against thresholds (p95 ≤ 15 s, failure rate ≤ 20%, cost ≤ 100¢/run).
Bench CLI: `pnpm --filter @patchbay/worker bench`
(`apps/worker/scripts/bench-planner-reviewer.ts`) — deterministic mock by
default; `AI_PROVIDER=ai-sdk` + `OPENAI_API_KEY` measures live model latency;
exits 1 on a failed verdict.

Mock-mode baseline (5 rounds, 10 calls): planner wall p95 10.2 ms (mean
2.5 ms), reviewer p95 1.4 ms, provider latency 0, cost 0, verdict PASS — pure
harness overhead; the model call dominates real runs.

**Mastra decision: NOT adopted.** The `@mastra/core` dependency would add an
orchestration layer over a two-step sequence whose step/transition/parallel
surface the existing contract adapter already mirrors, without reducing
complexity or improving quality/cost. BullMQ/Postgres remain the retry/state
authority; the adapter stays the swap point if real Mastra is ever justified
(fixed sequence above; per-role tool allowlists are already enforceable in the
worker).

## Work Package 9: Connector Certification and Languages

- Add dashboard/API capability filters from the capability contract.
- Certify `PLAN`/`VALIDATE`/`DRAFT_PR` only with trusted release sources, deterministic
  normalization, dependency matcher, language-specific usage analysis, migration rules,
  positive/negative fixtures, validation profile, policy defaults, owner, and metrics.
- Keep TypeScript/JavaScript as the strongest L3 path using the TypeScript compiler API.
- Add Python next: manifests, Tree-sitter L1 graph, then LibCST transformations for only certified
  OpenAI/Stripe/Twilio patterns.
- Add Go, Java, C#, Rust, PHP, Swift, Elixir, C, and C++ only by customer demand and with
  language-appropriate semantic analysis. Tree-sitter syntax extraction alone is L1, not L3.

## Work Package 10: Outcome Learning and Enterprise Operations

- Record structured PR outcomes: merged, closed, wrong-impact, wrong-patch, insufficient-tests,
  validation failure, manual edits, and policy/customer preference.
- Link outcomes to rule-pack/extractor/model version, graph evidence, sandbox result, and policy.
- Add GitHub webhook outcome ingestion, feedback UI, capability kill switch, replay controls, spend
  cap, sandbox concurrency, repository/vendor opt-in, approval routing, retention, export, and
  deletion controls.
- Measure detection latency, match precision/recall, plan acceptance, sandbox pass rate, PR merge
  rate, cost per successful remediation, false positive rate, and time to remediation.
- Automatically suspend an auto-PR capability when its evaluation/error thresholds fail.

## Required Build Order

1. Fix the detection resume test and add connector capability registry.
2. Add `RemediationCase` and policy-first case creation.
3. Fail closed for production sandbox and record sandbox provenance.
4. Build exact-commit GitHub App checkout and cleanup lifecycle.
5. Add graph full-vs-incremental comparator and correctness gates.
6. Harden Watchtower trust/evidence and detector-health reporting.
7. Integrate Vercel AI SDK behind existing provider interfaces.
8. Measure planner/reviewer performance; then decide on actual Mastra adoption.
9. Add customer controls, outcome learning, and operational SLOs.
10. Expand certified vendor/language capability according to proven demand.

## Verification

Run after every work package:

```bash
pnpm db:generate
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm build
```

For UI/API changes, add or run Playwright coverage. For GitHub, Docker, and external API changes,
use environment-gated integration tests; never target customer repositories or data.

## Product-Ready Draft PR Gate

Patchbay may create a draft PR only when all conditions hold:

1. Trusted immutable release evidence exists.
2. The repository has a `READY` graph snapshot at an exact commit SHA.
3. Dependency match and affected usage are deterministic and evidence-backed.
4. Connector/language capability is certified for `DRAFT_PR`.
5. Policy permits it and required approval exists.
6. AI output is schema-valid, bounded, source-hash-bound, and independently reviewed when policy
   requires it.
7. Deterministic patch checks pass.
8. Hardened sandbox validation passes.
9. GitHub App uses a short-lived installation token and creates a draft, not an automatic merge.
10. The full case timeline is auditable without storing secrets or unredacted tenant source.
