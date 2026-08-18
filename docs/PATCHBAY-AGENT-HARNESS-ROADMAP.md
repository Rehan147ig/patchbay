# Patchbay Agent Harness Roadmap

## Purpose

Patchbay is not another generic coding agent. Its purpose is to detect an external software
change, prove whether a customer is affected, propose a limited remediation, validate it in an
isolated environment, and open a governed draft pull request.

The **Patchbay Agent Harness** is the complete control plane for that workflow. A patch-generation
agent is only one constrained participant inside it.

```text
External vendor change
  -> Release Watchtower
  -> global release ledger
  -> customer software intelligence graph
  -> deterministic impact engine
  -> bounded agent harness
  -> deterministic patch and policy gates
  -> isolated validation
  -> draft PR and human approval
```

This document is the implementation plan for everything still needed after the current Watchtower
and task-submission work. It deliberately favors an evidence-first Node/TypeScript launch over a
large, speculative platform build.

## Executive Decision

**Build this architecture with changes.**

The core hypothesis is valid: a maintained software graph makes external-change detection and
remediation much cheaper and more accurate than cloning and asking an LLM to rediscover every
repository at release time. However, Patchbay should not initially build a dedicated graph
database, Kubernetes platform, universal language analysis, or an unconstrained agent swarm.

The smallest credible product is:

1. Three deeply supported Node SDKs: OpenAI, Stripe, and Twilio.
2. JavaScript and TypeScript dependency and AST intelligence.
3. A PostgreSQL-backed, commit-versioned impact graph.
4. One durable worker pipeline, with a small fixed Mastra workflow where it adds judgment.
5. Vercel AI SDK structured generation and tools behind Patchbay-owned authorization.
6. Container-isolated validation and draft PRs requiring policy or human approval.

## Current Repository Reality

The existing monorepo already supplies a meaningful part of the control plane:

| Area                | Present now                                                           | Remaining                                                                          |
| ------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Web/API             | Next.js dashboard, typed routes, auth, CSRF, role checks              | graph/impact views and agent-run visibility                                        |
| Durable jobs        | BullMQ worker, Redis, correlation IDs, audit trail                    | graph indexing, matching, and durable agent-run orchestration                      |
| Release data        | `VendorProduct`, `ReleaseRecord`, `ReleaseEvidence`, `DetectionRun`   | production source adapters, scheduling, release classification                     |
| Dependency data     | commit-keyed `RepositoryDependency` table                             | real repository inventory extraction and semver matching                           |
| Repository analysis | TypeScript-oriented package and API-usage analysis                    | persistent graph snapshots, incremental AST indexing, more languages               |
| Remediation         | deterministic rules, plan artifacts, approval/policy flow             | constrained patch application from agent plans                                     |
| AI                  | mock provider and OpenAI-compatible plan drafting with Zod validation | AI SDK, Mastra harness, cost/trace persistence, evaluations                        |
| Validation          | allowlisted commands and container runtime option                     | remote repository checkout, dependency cache controls, stronger isolation at scale |
| Git delivery        | GitHub App/provider flow and draft PR lifecycle                       | live end-to-end repository remediation hardening                                   |

The current schema has no `GraphSnapshot`, graph node, graph edge, source-evidence, or agent-run
models. The current AI provider calls an OpenAI-compatible chat endpoint directly; it is not yet
using Vercel AI SDK or Mastra. The current sandbox is a valuable first container boundary, but it
is not yet a multi-tenant microVM execution service.

## Non-Negotiable Architecture Rules

- A model never discovers a release by guessing. Watchtower supplies trusted evidence.
- A model never searches an entire tenant graph or repository. Patchbay supplies a bounded
  evidence subgraph and scoped source context.
- One upstream release is global; repository impacts, plans, and validation records are tenant
  owned.
- Every graph fact has repository, commit SHA, extractor version, source location, confidence, and
  content hash.
- AI agents do not receive shell access, Docker access, GitHub credentials, cloud credentials, or
  secret values.
- AI plans are proposals. Deterministic code applies patches, enforces source-hash preconditions,
  and validates them before any PR is created.
- BullMQ and PostgreSQL own durable retries and state. AI framework state must never become the
  recovery authority.

## The Three Memory Systems

These data types must stay separate.

| System         | Meaning                            | Source of truth                                                | Examples                                                    |
| -------------- | ---------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------- |
| Software graph | What exists in customer software   | PostgreSQL graph tables plus content-addressed source evidence | dependency, symbol, import, API call, queue topic           |
| Agent memory   | Non-authoritative learned guidance | tenant-scoped memory records with TTL/versioning               | custom wrapper note, prior test requirement                 |
| System state   | What Patchbay is doing             | PostgreSQL and BullMQ                                          | release observed, job running, approval pending, PR created |

Never place a full codebase or graph in Mastra memory. An agent receives a query result and the
minimum source excerpts necessary for its current step.

## Software Intelligence Graph

### Why it exists

Watchtower answers: "a trusted vendor release occurred." The graph answers: "which exact code,
services, tests, and owners are affected at this repository commit?"

It is an **impact graph**, not a generic search index or a vector database.

```text
Release -> vendor product -> package -> repository dependency
        -> import/client -> API usage -> symbol -> caller -> test/service
```

### Initial relational model

Add graph tables in `packages/db/prisma/schema.prisma`; keep the public contracts in
`packages/domain`.

```text
GraphSnapshot
  id, organizationId, repositoryId, commitSha, extractionVersion,
  status, rootTreeHash, createdAt, completedAt

GraphNode
  id, organizationId, repositoryId, snapshotId, kind, stableKey,
  displayName, filePath, startLine, endLine, propertiesJson, contentHash

GraphEdge
  id, organizationId, repositoryId, snapshotId, fromNodeId, toNodeId,
  kind, provenance, confidence, evidenceJson

GraphSourceEvidence
  id, organizationId, repositoryId, snapshotId, nodeId/edgeId,
  filePath, startLine, endLine, extractor, extractorVersion, sourceHash

GraphIndexJob
  id, organizationId, repositoryId, snapshotId, mode, status,
  changedPathsJson, correlationId, error, timingsJson
```

Use globally unique node IDs but always store and filter by `organizationId`. Edge endpoints must
belong to the same organization and snapshot. PostgreSQL RLS is a future defense-in-depth layer;
application authorization and explicit organization-scoped queries are required from day one.

### Initial node and edge vocabulary

Do not create arbitrary labels. Start with a small, queryable vocabulary.

| Nodes                                             | Edges                                                    |
| ------------------------------------------------- | -------------------------------------------------------- |
| Repository, File, Module, Symbol, Function, Class | CONTAINS, EXPORTS, IMPORTS, CALLS, EXTENDS               |
| Dependency, Package, VendorProduct, ReleaseRecord | DECLARES, RESOLVES_TO, USES_PACKAGE, AFFECTED_BY         |
| ApiClient, ApiOperation, ConfigurationKey         | CREATES_CLIENT, INVOKES_API, READS_CONFIG                |
| Test, Service, QueueTopic, Database               | TESTS, BELONGS_TO_SERVICE, PUBLISHES, CONSUMES, ACCESSES |

Every edge is one of `EXTRACTED`, `RESOLVED`, `INFERRED`, or `AMBIGUOUS`:

- `EXTRACTED`: direct syntax fact, such as an import or literal method call.
- `RESOLVED`: deterministic cross-file/package resolution.
- `INFERRED`: rule-based or AI-assisted conclusion, never enough by itself for automated changes.
- `AMBIGUOUS`: dynamic behavior that needs review.

### PostgreSQL first

Use PostgreSQL for the first production graph:

- composite indexes on `(organizationId, repositoryId, snapshotId, kind)`;
- composite indexes on `(organizationId, snapshotId, fromNodeId)` and `toNodeId`;
- unique `(snapshotId, kind, stableKey)` for idempotent extraction;
- bounded recursive CTEs for 2-6 hop impact paths;
- summary tables for high-frequency queries such as package-to-usage and symbol-to-test;
- object storage for raw source snapshots and large AST artifacts, never database blobs.

Do not adopt Neo4j at launch. Reconsider only after measured evidence that bounded impact traversals
cannot meet a p95 target of 500 ms with PostgreSQL, or after cross-repository queries require deep,
unbounded traversal that cannot be materialized efficiently. A graph database is not a substitute
for a precise schema, provenance, or tenant authorization.

### Incremental indexing

1. On repository connection, create a full baseline `GraphSnapshot` for the default branch.
2. On a validated Git push webhook, fetch only the changed-file list and commit SHA.
3. Hash each changed file. Skip extraction when the content hash is unchanged.
4. Re-extract changed files and directly affected importers/callers.
5. Upsert nodes and edges into a new immutable snapshot, reusing unchanged content-addressed facts.
6. Atomically mark the snapshot `READY`; impact queries only use the latest ready snapshot.
7. Retain a small snapshot history for reproducibility and PR evidence, then expire under tenant
   retention policy.

Start with full snapshots for small repositories and path-level incremental updates for active
repositories. Do not promise incremental whole-program semantic analysis in v1.

### Graph API, not database access for agents

Implement Patchbay-owned tools that enforce tenant scope, result limits, redaction, and audit:

```text
findAffectedRepositories(releaseRecordId)
getRepositoryDependencyFacts(repositoryId, commitSha)
getAffectedUsageSubgraph(matchId, maxHops)
getScopedSourceContext(snapshotId, filePaths, lineRanges)
getValidationEvidence(remediationPlanId)
```

The graph service must reject cross-organization IDs, unready snapshots, unlimited traversals,
binary files, generated files, and secret-bearing content. Tool results should contain stable IDs
and evidence links, not raw unrestricted repository trees.

## Language Strategy

Greptile currently advertises full support for Python, JavaScript, TypeScript, Go, Elixir, Java,
C, C++, C#, Swift, PHP, and Rust, with lower-quality support for other languages. That demonstrates
market demand for broad codebase understanding, not a requirement for Patchbay to launch broadly.

Patchbay support must be expressed as a matrix, not one vague "language supported" badge:

| Capability                  | L0: inventory         | L1: structural graph | L2: semantic impact              | L3: safe remediation              |
| --------------------------- | --------------------- | -------------------- | -------------------------------- | --------------------------------- |
| Meaning                     | manifests/config only | AST symbols/imports  | vendor API usages and call paths | supported patch + validation rule |
| JS/TS                       | launch                | launch               | launch                           | launch for three SDKs             |
| Python                      | next                  | next                 | selected SDKs                    | after fixtures/evals              |
| Go                          | later                 | later                | selected SDKs                    | later                             |
| Java/C#                     | later                 | later                | selected SDKs                    | later                             |
| Rust/PHP/Swift/Elixir/C/C++ | inventory first       | opportunistic        | only on vendor demand            | not planned initially             |

Use Tree-sitter for language-independent syntax extraction: files, imports, declarations, literal
calls, and configuration structure. It is sufficient for broad L1 coverage. It is not sufficient
for high-confidence L2/L3 changes in dynamic languages, reflection-heavy systems, or compiled
languages requiring type resolution. Add language-specific semantic analyzers only when a vendor
and customer cohort justify them:

- TypeScript: TypeScript compiler API, already aligned with the repository.
- Python: LibCST or a typed AST/type-checker path for selected SDK patterns.
- Go: `go/packages` and `go/types` in a dedicated worker.
- Java: JDT or compiler-backed analysis, not regex or generic AST alone.
- C#: Roslyn worker.

Vendor support and language support are separate. "OpenAI Node migration supported" is a real
claim; "TypeScript supported" alone is not.

## Graphify Decision

**Reference and evaluate; do not embed or copy it as Patchbay's core runtime.**

Adopt these ideas:

- deterministic local/isolated AST extraction;
- explainable graph edges with extracted versus inferred provenance;
- graph query before broad repository reading;
- a graph artifact useful for debugging and evaluation.

Do not adopt these as product requirements:

- a general-purpose graph of every media/document type;
- a graph UI before impact queries work;
- a local CLI as Patchbay's production indexing architecture;
- making graph retrieval the agent's unrestricted data plane.

Build a narrow adapter only if Graphify output accelerates experiments. Production Patchbay needs
tenant-scoped, commit-versioned graph records and a migration-impact vocabulary that it owns.

## Agent Harness

### Responsibility boundaries

```text
BullMQ + PostgreSQL: durable state, retry, idempotency, audit
Mastra workflow: bounded delegation and step sequencing
Vercel AI SDK: model/provider interface, structured generation, typed tools
Patchbay services: authorization, graph access, policy, patching, sandbox, GitHub writes
```

Avoid nesting agent loops. Do not build "Mastra parent -> AI SDK parent -> Mastra child." BullMQ
starts a single Mastra workflow for an eligible remediation job. Mastra invokes agents; agents use
AI SDK-backed model calls and Patchbay-owned tools.

### Initial workflow

The parent is a deterministic workflow with explicit transitions, not an autonomous supervisor.

```text
1. Release analyst: normalize only trusted release evidence.
2. Impact analyst: ask graph tools for affected dependency/API facts.
3. Migration planner: emit a typed, source-hash-bound patch plan.
4. Patch engine: apply only allowed edits and preconditions.
5. Sandbox: run fixed validation commands.
6. Reviewer: compare release evidence, diff, and validation evidence.
7. Policy engine: decide deny, plan-only, approval, or draft PR.
```

The first version can use one model call for steps 1-3 and a second independent reviewer call.
Split into more agents only when eval data proves an improvement. Parallelism is useful for
independent review dimensions, not for decorative complexity.

### Agent permissions

| Participant     | Allowed                             | Prohibited                                 |
| --------------- | ----------------------------------- | ------------------------------------------ |
| Release analyst | release evidence                    | source modification, shell, GitHub         |
| Impact analyst  | bounded graph and source facts      | broad repo search, writes, secrets         |
| Planner         | migration rules and scoped excerpts | shell, Docker, PR creation                 |
| Reviewer        | plan, diff, validation evidence     | patch modification, GitHub writes          |
| Patch engine    | deterministic file edits            | LLM decisions, network credentials         |
| Sandbox         | allowlisted build/test commands     | host access, secrets, unrestricted network |

### AI SDK contract

Replace the direct chat-completions implementation only behind the existing `AiProvider` interface.
Use AI SDK for:

- provider registry and future routing/failover;
- Zod schema-backed structured outputs;
- narrow, typed Patchbay tool definitions;
- request/response IDs, token usage, latency, model ID, and cost accounting;
- timeouts, maximum steps, retries, and cancellation;
- test fakes that reproduce model outputs and tool failures.

Persist an `AgentRun` and `AgentStep` record for every run. Store prompt/template version,
redacted input digest, model/provider, tool calls, output schema result, token usage, cost estimate,
correlation ID, and terminal status. Store no chain-of-thought and no secret values.

### Mastra decision

**Use Mastra only after graph impact data and a stable AI SDK plan call exist.** It is appropriate
for the bounded analyst/planner/reviewer workflow, tooling, traces, and eval support. It must not
replace BullMQ retries, Prisma state transitions, authorization, or policy decisions. A failed
Mastra step reports a typed failure to the worker; BullMQ controls retry/backoff and idempotency.

**Status (session H9):** the workflow layer is now implemented as a Mastra-contract adapter
(`packages/ai-harness/src/workflow.ts`, `defineWorkflow` + `run`/`replay`, transitions, parallel
waves, gate evaluation) driven by the `agent-plan`/`agent-replay` BullMQ jobs. The `@mastra/core`
dependency remains deferred: the adapter's step/transition contract is the same surface a real
Mastra flow would use, and swapping it in requires no worker change — only the adapter's
execution backend.

**Status (WP8 — decision made with measurement):** `measureWorkflow`
(`packages/ai-harness/src/measure.ts`) plus the worker `bench` CLI now measures
the planner/reviewer sequence (wall + provider latency, tokens, cost, classified
failures, PASS/FAIL thresholds). Mock-mode baseline: planner wall p95 10.2 ms,
reviewer p95 1.4 ms — harness overhead only. The measurement shows the AI SDK
model call is the entire latency/cost surface; **`@mastra/core` remains
deferred** — it would add orchestration without reducing complexity or
improving quality/cost. The contract adapter stays the exact swap point, and
the fixed role sequence (release analyst → impact analyst → migration planner
→ independent reviewer) with per-role Patchbay-owned tool allowlists is
already enforceable in the worker if adoption is ever justified. Mastra never
owns retries, policy, authorization, approval waits, database access,
shell/Docker access, or GitHub writes.

**Status (WP9 — delivered):** connector capability certification is now a
hard gate. `requireCertified(slug, level)` (kit checks from `PLAN` up: release
sources, normalization, matcher, usage analysis, migration rules, fixtures,
validation profile, policy defaults, owner, metrics — surfaced as
`certifiedAt`/`rulePackVersion`/corpus/`validationProfile` in the capability
contract) gates the `draft-pr` route (`DRAFT_PR`) and the `validate` route
(`VALIDATE`, previously ungated). `GET /api/vendors?minLevel=` and the
settings dashboard expose the certified surface. Python L1 landed via
`web-tree-sitter` (WASM — the native binding crashes Node on Windows):
`pyproject.toml`/`requirements*.txt` manifests plus import/call-chain usage
extraction merge into `analyzeRepository`. L1 only; LibCST transforms for
certified OpenAI/Stripe/Twilio patterns stay gated on proven demand.
TypeScript/JavaScript remains the strongest L3 path via the TS compiler API.

**Status (WP10 — delivered, local core):** the harness now closes the loop
with outcome learning and enterprise operations. `PrOutcome` records every
terminal PR (merged/closed + human classification) linked to rule-pack/
extractor/model/prompt-template versions, graph snapshot, validation run, and
policy decision; the env-gated GitHub webhook ingests merge/close events and
the `/outcomes` dashboard collects human feedback with one click. From those
outcomes, `@patchbay/operations` computes SLO rollups (merge rate, false
positive rate, detection p95, plan acceptance, sandbox pass rate, agent
failure/budget, cost per successful remediation, time to remediation) and the
worker job `evaluate-capability-health` auto-suspends a vendor's `DRAFT_PR`
kill switch when merge rate < 50%, FP rate > 50%, or latency p95 > 60s over a
30-day window — the `draft-pr`/`validate` routes fail closed while suspended,
and only an admin restore reopens. Retention (90-day raw-payload purge,
audited), ADMIN export (agent inputs/outputs excluded) and org data deletion
(immutable `data.deleted` marker) complete the ops surface. Live GitHub
deliveries and live model spend remain env-gated; the next milestones are
replay controls, spend caps, sandbox concurrency, and repository/vendor
opt-in knobs.

## Patch and Validation Design

The model returns a declarative `PatchPlan`, never executable commands:

```text
PatchPlan
  releaseRecordId, graphSnapshotId, repositoryId, expectedCommitSha
  edits[]: filePath, expectedSourceHash, operation, AST precondition, replacement
  validationProfile, rationale, confidence, requiresHumanReview
```

The deterministic engine verifies repository ownership, source hash, allowed path, AST
precondition, max file count, max diff lines, vendor rule applicability, and policy before applying
anything. Any mismatch invalidates the plan and returns it to review; it never tries to "fix it
creatively" on its own.

The current container runtime is a good v1 validation backend. Strengthen it with read-only base
images, non-root user, dropped Linux capabilities, no host mounts, output/CPU/memory/PID limits,
network disabled by default, short-lived credentials if a package registry must be reached, and
fully disposable workspaces. Kubernetes can schedule these jobs later, but a Kubernetes pod is not
in itself strong isolation for hostile customer code. Adopt microVM isolation when arbitrary code,
untrusted dependencies, or enterprise deployment requirements exceed the container threat model.

## Delivery Sequence

### Phase H0: prove one closed loop

- Use the existing OpenAI legacy fixture and rule.
- Persist one repository dependency inventory from a real GitHub App snapshot.
- Create a minimal TypeScript graph containing dependency, file, import, client, method-call, and
  test nodes.
- Match a global `ReleaseRecord` to one repository and show the evidence subgraph in the dashboard.
- No Mastra yet; use the existing `AiProvider` mock and deterministic patch flow.

**Exit:** a developer can see exactly why one repository is affected without an LLM.

### Phase H1: production graph ingestion

- Add graph snapshot, node, edge, and source-evidence migrations.
- Implement full baseline indexing and GitHub push incremental jobs.
- Parse `package.json`, pnpm/npm lockfiles, and TypeScript syntax into idempotent facts.
- Add graph query API/service with tenant checks, limits, traces, and tests.
- Implement semver/package-to-usage matching from `ReleaseRecord` to `IntegrationUsage`.

**Exit:** vendor releases query pre-existing indexed facts rather than initiating broad scans.

### Phase H2: reliable impact engine

- Add deterministic vendor change rules linking release facts to package ranges and API symbols.
- Produce `ReleaseRepositoryMatch` records only for matching dependency and usage evidence.
- Add confidence calculation and explainability UI.
- Build a historical release/repository fixture corpus and precision/recall metrics.

**Exit:** supported OpenAI, Stripe, and Twilio changes achieve high match precision before AI is
enabled.

### Phase H3: AI SDK plan generation

- Introduce AI SDK inside a new `packages/ai-harness` package behind `AiProvider`.
- Define `PatchGenerationInput` and `PatchPlan` schemas in `packages/domain`.
- Add `AgentRun`/`AgentStep`, quotas, budget limits, cancellation, and replay fixtures.
- Make one planner produce a plan-only proposal; retain deterministic patch application.

**Exit:** every model output is typed, auditable, bounded, replayable, and harmless without a
deterministic engine decision.

### Phase H4: Mastra workflow and independent review

- Add a Mastra workflow adapter invoked by a BullMQ job.
- Implement release analyst, impact analyst, planner, and reviewer with separate tool allowlists.
- Parallelize only independent analysis/review calls.
- Add failure mapping, manual replay, and evaluation gates before policy can permit a draft PR.

**Exit:** the agent harness improves accepted plan quality over the single planner in measured
fixtures.

**Status: DELIVERED (session H9).** The Mastra workflow _contract_ (typed steps, per-step tool
allowlists, parallel waves, explicit success/failure transitions, failure mapping, evaluation
gates, manual replay from a failure boundary) is implemented as a deterministic, unit-tested
adapter in `packages/ai-harness/src/workflow.ts` and invoked by the `agent-plan` and
`agent-replay` BullMQ jobs; `POST /api/runs/[id]/replay` triggers manual replay. Deviation
documented in §Mastra decision below: the `@mastra/core` dependency itself stays deferred —
BullMQ/Postgres remain the durable workflow authority, and the adapter deliberately mirrors the
Mastra step/transition/parallel surface so a real `@mastra/core` flow can replace it behind the
same contract later.

### Phase H5: hardened remote validation and PR delivery

- Replace fixture-only validation with short-lived GitHub App checkouts.
- Enforce per-organization sandbox concurrency, spend budgets, and artifact retention.
- Add package registry egress policy and dependency-cache integrity controls.
- Create draft PRs with release, graph, model, policy, and validation evidence.

**Exit:** an opt-in customer can receive an end-to-end draft PR automatically for a supported
change.

### Phase H6: expand deliberately

- Add Python only after Node release-quality metrics are met.
- Add Go and Java/C# based on paying customer/vendor demand.
- Add architecture edges from OpenAPI, Terraform/Kubernetes, queue configuration, and service
  catalog metadata.
- Evaluate a dedicated graph database only with measured workload evidence.

## Product and Operations Requirements

- Per-organization repository limit, queue concurrency, sandbox-minute budget, AI token budget,
  graph-storage quota, and retention policy.
- Default to draft PRs. Auto-merge requires explicit organization opt-in, a protected branch,
  passing validation, and a narrow policy class.
- Release polling is event-driven where possible; fallback polling uses ETags, cursors,
  `If-Modified-Since`, and content hashes. Monitoring is 24/7; LLM inference is not.
- Store global release facts once. Tenant matches and all customer graph data remain isolated.
- Provide data-export and deletion jobs for graph snapshots, agent memory, source artifacts, and
  audit retention according to the organization policy.

## Evaluation and Launch Metrics

Create a replay corpus per supported vendor: release evidence, repository snapshot, expected
dependency and API matches, expected policy outcome, expected patch, and validation result.

| Metric                                            | Launch target                          |
| ------------------------------------------------- | -------------------------------------- |
| npm release detection latency                     | under 15 minutes                       |
| dependency match recall                           | above 95% in fixtures                  |
| affected-usage match precision                    | above 90% in fixtures                  |
| automatic patch validation for supported patterns | above 80%                              |
| false-positive alert rate                         | below 10%                              |
| unsafe patch/tenant-boundary failures             | zero tolerated                         |
| draft-PR acceptance rate                          | above 60% after enough customer volume |

Never use merge rate alone as the quality metric. Track rejection reasons: wrong impact match,
wrong patch, insufficient tests, policy rejection, stale repository, or customer preference.

## Risks

| Priority | Risk                                                         | Mitigation                                                                             |
| -------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| CRITICAL | Cross-tenant graph/source disclosure                         | scope every query, RLS defense-in-depth, authorization tests, audit                    |
| CRITICAL | Arbitrary-code sandbox escape or secret exposure             | no host mounts/secrets, network deny, immutable images, microVM path                   |
| HIGH     | AI proposes an unsafe or stale patch                         | source hashes, AST preconditions, diff budgets, deterministic policy, draft PR default |
| HIGH     | Low graph precision creates alert fatigue                    | narrow vendor rules, evidence thresholds, fixture replay, human approval               |
| HIGH     | Trying to support every language/vendor delays product proof | capability matrix and demand-driven expansion                                          |
| MEDIUM   | Mastra duplicates durable orchestration                      | BullMQ/Postgres remain the workflow authority                                          |
| MEDIUM   | PostgreSQL traversal slows at scale                          | bounded paths, summaries, benchmarks before graph DB adoption                          |
| MEDIUM   | Vendor release evidence is incomplete                        | multiple trusted adapters, provenance, review-only confidence classes                  |
| LOW      | A competitor copies the agent pattern                        | compound proprietary value from release rules, graph facts, outcomes, and policy data  |

## What Is Defensible

Agents, AST parsers, and graph tables are reproducible components. The credible moat is their
compound feedback loop:

```text
verified vendor release
  + precise dependency/API impact facts
  + vendor-specific migration rules
  + accepted/rejected patch history
  + validation outcomes
  + customer policy preferences
  = increasing remediation precision and trust
```

This is differentiated from a dependency updater because the trigger is an external semantic
change and the output is evidence-backed remediation. It is differentiated from an AI code reviewer
because Patchbay begins before a developer opens a PR: it discovers that a vendor change requires
action, then proves and performs the safe next step.

## Final Recommendation

Build the architecture, but in this order: **Node/TypeScript impact graph -> deterministic matching
-> single typed AI planner -> constrained validation -> reviewer workflow -> broader languages and
infrastructure.**

Do not build Kubernetes, Neo4j, broad agent memory, a universal language platform, or a large agent
swarm before Patchbay can repeatedly deliver one high-confidence, validated draft PR for a supported
OpenAI, Stripe, or Twilio change.
