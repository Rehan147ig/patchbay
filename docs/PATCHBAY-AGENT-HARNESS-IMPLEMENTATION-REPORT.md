# Patchbay Agent Harness — Implementation Report

Detailed report of the work done against
[`docs/PATCHBAY-AGENT-HARNESS-ROADMAP.md`](PATCHBAY-AGENT-HARNESS-ROADMAP.md).

Status: **code-complete and verified end-to-end for Phases H0–H3 (first version)**
(all checks green: `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm test` = 517 tests / 40 files).

---

## 1. Objective

The roadmap defines the Patchbay Agent Harness as the control plane for
external-change detection → customer software intelligence graph → deterministic
impact engine → bounded agent harness → deterministic patch + policy gates →
isolated validation → draft PR + human approval.

The work completed in this session delivered the foundation the roadmap
dependencies on first:

- **Software Intelligence Graph** (schema, deterministic extractor, baseline +
  push-webhook incremental indexing, tenant-scoped read API)
- **Deterministic release classification and matching** (semver engine, vendor
  migration rules, `ReleaseRepositoryMatch`, explainable match reasons)
- **Release Watchtower surface** (record/classify/match API + `/releases`
  dashboard showing exactly _why_ a repository is affected, without an LLM —
  the roadmap's H0 exit criterion)

Everything was built as the roadmap's "Executed Decision" prescribes: evidence-first
Node/TypeScript over speculative platform build. No graph DB, no Kubernetes, no
Mastra, no Vercel AI SDK — each is deferred until the deterministic loop is proven.

---

## 2. Gap Analysis (as the session started)

| Roadmap area        | Present at start                         | Missing at start                          | Delivered                                                    |
| ------------------- | ---------------------------------------- | ----------------------------------------- | ------------------------------------------------------------ |
| Graph schema        | —                                        | No snapshot/node/edge/evidence/job models | ✅ migration `20260811184049_software_intelligence_graph`    |
| Dependency data     | `RepositoryDependency` table existed     | No persistence from scan                  | ✅ `scan-repository` persists commit-keyed rows              |
| Repository analysis | Package/API-usage TS analysis            | No persistent, deterministic graph        | ✅ `packages/repo-analysis/src/graph.ts`                     |
| Release data        | `VendorProduct`, `ReleaseRecord` existed | No classification, no matching            | ✅ `classify-release`, `match-release` workers               |
| Dashboard           | Repos/changes/remediations views         | No release view, no graph evidence view   | ✅ `/releases`, `/releases/[id]`, graph evidence in API + UI |
| Durable jobs        | BullMQ worker, correlation ids           | Graph/matching job types                  | ✅ 3 new job processors registered                           |

---

## 3. Deliverables by Roadmap Phase

### Phase H0 (prove one closed loop) — delivered

One openai repo (`ai-assistant-service`, fixture `fixtures/repositories/openai-node-legacy`)
now closes the loop without any LLM:

```
scan (dependency inventory) → graph-index (READY snapshot)
→ record release openai 3.3.0 / 4.0.0 → classify (deterministic facts)
→ match (exact/range) → why-affected evidence (graph) → /releases UI
```

Exit criterion met: **a developer can see exactly why one repository is
affected without an LLM** (match reason + per-module graph evidence rows).

### Phase H1 (production graph ingestion) — delivered

- **Schema** (`packages/db/prisma/schema.prisma`):
  - `GraphSnapshot` (org-scoped, `@@unique([repositoryId, commitSha, extractionVersion])`)
  - `GraphNode` (kind, stableKey, displayName, filePath, startLine/endLine,
    propertiesJson, contentHash, `@@unique([snapshotId, kind, stableKey])`)
  - `GraphEdge` (kind, provenance, confidence, evidenceJson)
  - `GraphSourceEvidence` (nodeId/edgeId links, extractor, extractorVersion, sourceHash)
  - `GraphIndexJob` (mode, status, changedPaths, correlationId, error, timings)
  - Enums mirrored in `packages/domain/src/enums.ts` (drift test covers them).
- **Deterministic extractor** (`packages/repo-analysis/src/graph.ts`,
  `extractGraph({ rootDir, trackPackages })`):
  - Node vocabulary: `repo:root`, `file:`, `module:`, `dep:`, `pkg:@version`,
    `client:pkg:ctor`, `api:pkg:symbol`, `test:`, `sym:rel:name`.
  - Edge vocabulary: USES_PACKAGE, RESOLVES_TO, CREATES_CLIENT, INVOKES_API,
    IMPORTS, EXPORTS, TESTS.
  - Provenance classes: `EXTRACTED` (100), `RESOLVED` (99/95), `INFERRED` (85/90/80)
    with fixed confidences; every edge carries evidence with file/line/, extractor,
    source hash.
  - Content addressing: file sha256 for FILE/MODULE/TEST nodes; deterministic
    `factHash` (sha256 of `key|kind|JSON(properties)`) for synthetic nodes —
    same repo + same commit always yields identical output (no timestamps/randomness).
  - `collectModuleExports` 3-pass fixed point so only tracked bindings get EXPORTS edges.
- **Indexing jobs** (`apps/worker/src/jobs/graph-index.ts`):
  - BASELINE on demand (`POST /api/repositories/[id]/graph-index`).
  - INCREMENTAL on GitHub `push` webhook (changed-file union from `commits.*`.
    modified/added/removed), persisted on the job as `changedPaths`.
  - **Snapshot reuse**: an existing READY snapshot for the same `commitSha` +
    extractionVersion is reused (audit `graph.index.reused`) — unchanged commits
    cost no re-extraction.
  - New snapshots are immutable: created `INDEXING`, nodes/edges/evidence written
    via chunked `createMany` + `skipDuplicates` (10 000/batch) with explicit
    `randomUUID()` ids and edge-evidence link map, then atomically `READY`.
  - Idempotent on retry; audits `graph.index.*` throughout.
- **Graph query API** (`packages/db/src/graph-reads.ts` +
  `GET /api/repositories/[id]/graph?package=<name>`):
  - `latestSnapshot` (READY-only), `impactByKind`, `packageImpact` — for a package:
    the resolved version, declared ranges, client/api-operation counts and **every
    using module** with its edge kinds and evidence density.
  - All queries bounded by `organizationId` + `repositoryId`; never reads
    non-READY snapshots.

### Phase H2 (reliable impact engine) — delivered

- **Semver engine** (`packages/domain/src/semver.ts`): `parseVersion`,
  `compareVersions`, `satisfiesRange` (exact, `*`, `^`, `~`, `>=`/`<=`/`>`, `<`,
  `"x - y"` spans; null/opaque inputs never guessed). 8 unit tests.
- **Classification** (`apps/worker/src/jobs/classify-release.ts`):
  - `KNOWN_MIGRATIONS` table keyed `package|toMajor`; openai→4 ships today
    (method renames `createChatCompletion`→`chat.completions.create`,
    `createCompletion`→`completions.create`, `createEmbedding`→`embeddings.create`,
    response-unwrap `.data`).
  - Uses the existing connector via `getConnector(vendorSlug).normalizeChange`
    with `sourceType: "release-record"`.
  - Deterministic `ReleaseClassification` (method DETERMINISTIC, confidence 95,
    breakdown per dimension, `requiresHumanReview` when breaking), `ReleaseRecord`
    transitions OBSERVED → CLASSIFIED.
  - Facts include `changeDrafts` with rule attribution (`rule`, `breaking`,
    `affectedSymbols`) — the explainability contract for the dashboard.
- **Matching** (`apps/worker/src/jobs/match-release.ts`):
  - Candidates from `RepositoryDependency` by `packageName`; match when the
    `resolvedVersion` equals the released version **or** the released version
    satisfies the declared range.
  - `ReleaseRepositoryMatch` rows (`skipDuplicates`, chunked) with an explainable
    `matchReason`, e.g. `repository resolved openai to 3.3.0 (the released version)`.
  - Positive bias is avoided: 4.0.0 against a repo pinned to 3.3.0 with range
    `^3.3.0` produces **zero** matches (verified live).
- **Release API** (`/api/releases`, `GET /api/releases/[id]`):
  - POST records `ReleaseRecord` (VendorProduct upsert, content hash for
    dedupe), enqueues classify + match, audits; duplicate recording is
    idempotent (HTTP 200, existing id, no re-enqueue).
  - GET detail joins matches with per-match `packageImpact` evidence so the UI
    can render "why affected" from graph facts.
- **H2 fixture corpus** (`packages/remediation-engine/src/corpus.test.ts`): a
  replay CI gate covering openai→4, stripe→13, twilio→4 against their real
  fixture repositories. Runs the full deterministic relay (analyzer →
  connector normalization → engine patch) and asserts recall (expected patch
  files produced) and precision (no extra files patched). The gate caught a
  real gap: the stripe connector's suggestion replaced a symbol with itself,
  so the engine produced no patch — fixed by making the stripe rule an
  explicit metadata-required feature-adoption insert.

### Phase H3 (AI SDK plan generation, first version) — delivered

- **`packages/ai-harness`** (new): `runPlanner` / `runReviewer` / `buildPlannerRequest`
  / `hashInput` (schema-canonical sha256) / `bindSourceHashes` (placeholder →
  real file sha256, unknown files invalidated) / `estimateCostCents`
  (deterministic: mock is free, priced models are proportional). Output always
  parsed through `patchPlanSchema` / `reviewVerdictSchema` before it can touch
  state; per-run `budgetCents` enforces spending before persistence.
- **Provider surface** (`packages/ai-provider`): `generatePatchPlan` +
  `reviewPatchPlan` on `AiProvider`; shared typed `chatJson` helper; plan and
  review prompt templates as files; deterministic `MockAiProvider` planner
  (edits derived from trusted migration-rule drafts matched against graph
  modules) and independent reviewer (approves only plans that address the
  affected modules; vetoes breaking plans with no edits).
- **`AgentRun` / `AgentStep`** (migration `20260812025413_agent_runs`): run
  lifecycle (QUEUED → RUNNING → SUCCEEDED | FAILED | BUDGET_EXCEEDED |
  CANCELLED), budget/token/cost accounting, `redactedInputDigest` replay
  identity, per-step digests and latency, model + prompt template version on
  every run. No chain-of-thought, no secrets.
- **`agent-plan` worker job**: three recorded steps — ANALYST
  (`getAffectedUsageSubgraph` bounded graph query), PLANNER (one model call,
  id-bound plan), REVIEWER (independent call, same evidence + plan). Audits on
  started/completed/failed/cancelled/budget-exceeded; cancel-aware checks
  before each step.
- **API**: `POST /api/releases/[id]/plan` (idempotent per match, returns the
  existing run on replay), `GET /api/runs`, `GET /api/runs/[id]` (steps +
  verdict + bound plan), `POST /api/runs/[id]/cancel`.
- **Verified live**: seeded openai fixture repo (graph READY) → release →
  classification → match → agent run → SUCCEEDED with 1 hash-bound edit on
  `src/chat/chat-service.ts`, independent review approved, 3 recorded steps,
  digest set, 0 cost, 0 invalidated.

### Dashboard (H0/H2 exit visibility)

- `/releases` — observed releases newest-first, status pill, breaking/review
  badges from facts, per-org match counts, inline record-release form
  (`components/record-release-form.tsx`).
- `/releases/[id]` — classification card (confidence, breaking, review
  requirement), change-draft list with rule attribution, and per-repository
  why-affected evidence (matching repo → resolved/declared range/commit →
  graph modules with edge kinds).
- Nav updated (`components/nav.tsx`).

### Platform changes required to make the above run

- `apps/web/next.config.ts`: `serverExternalPackages` now includes
  `@patchbay/{db,domain,audit,queue,repo-analysis}` — bundling `@patchbay/domain`
  pulled its `node:async_hooks` logger into webpack and failed with
  "Unhandled scheme" for Node builtins.
- `ORG_SCOPED_MODELS` extended with the 5 graph models; `packages/db` and
  `packages/domain` index exports added.
- Audit actions: `graph.index.queued|started|completed|failed|reused`,
  `release.recorded|classified|classification_failed|matched|match_failed`.
- Job types: `GRAPH_INDEX`, `CLASSIFY_RELEASE`, `MATCH_RELEASE` registered in
  the worker.

---

## 4. Test Suite

| Suite                                                        | Count          | Notes                                                                                                                 |
| ------------------------------------------------------------ | -------------- | --------------------------------------------------------------------------------------------------------------------- |
| Full `pnpm test`                                             | 517 (40 files) | all passing                                                                                                           |
| Graph extractor (`packages/repo-analysis/src/graph.test.ts`) | 7              | openai fixture structure, client/API nodes, import + package resolution, determinism, synthetic repo, undeclared deps |
| Semver (`packages/domain/src/semver.test.ts`)                | 8              | parse/compare/satisfies                                                                                               |
| Match worker (`apps/worker/src/jobs/match-release.test.ts`)  | 5              | exact, range, no-match, audit, skipDuplicates                                                                         |
| Static gates                                                 | clean          | `pnpm format`, `pnpm lint` (0 warnings), `pnpm typecheck` (15/15 packages)                                            |

---

## 5. Live End-to-End Verification

Run against the seeded demo stack (web + worker, PostgreSQL + Redis) using a
minted dev session + CSRF over real HTTP:

1. `POST /api/repositories/r-ai/scan` → worker completes; dependency inventory
   persisted (openai `^3.3.0` → resolved 3.3.0).
2. `POST /api/repositories/r-ai/graph-index` (BASELINE) → worker extracts and
   commits snapshot **25 nodes / 41 edges**, READY. Second trigger on the same
   commit **reuses** the snapshot (`graph.index.reused` audit).
3. `GET /api/repositories/r-ai/graph?package=openai` →
   `{ resolvedVersion: "3.3.0", declaredRanges: "package.json@^3.3.0",
clientCount: 2, apiOperationCount: 2, modules: [
  src/chat/chat-service.ts (INVOKES_API, USES_PACKAGE),
  src/embeddings/embedding-service.ts (INVOKES_API, USES_PACKAGE),
  src/index.ts (CREATES_CLIENT, USES_PACKAGE),
  src/lib/openai-client.ts (CREATES_CLIENT, USES_PACKAGE) ] }`.
4. `POST /api/releases` openai 3.3.0 (previous 3.2.1):
   - classification facts: adapter openai, breaking false, SDK_VERSION_UPGRADE
     draft, confidence 95, no human review;
   - matched 1 repository, reason `repository resolved openai to 3.3.0 (the
released version)`; detail endpoint returns the 4 evidence-linked modules.
5. `POST /api/releases` openai 4.0.0 (previous 3.3.0):
   - classification facts: breaking true, 5 drafts — 3 method renames (+ each
     `affectedSymbols`), response-unwrap, plus version bump; rulesApplied
     `["migration"]`, `requiresHumanReview: true`;
   - matched **0** repositories (repo pins 3.3.0; range `^3.3.0` does not admit
     4.0.0) — desired precision, no false positives.
6. Duplicate recording of 3.3.0 → HTTP 200 with the existing release id, no
   duplicate jobs/audits.

---

## 6. Deviations from the Roadmap (documented, pragmatic)

1. **Incremental extraction is commit-level, not file-level.** Push webhooks
   record `changedPaths` on the job, but extraction re-runs the full fixture and
   reuses the READY snapshot when the commit SHA is unchanged (the roadmap's
   steps 3–4 — hash changed files, re-extract affected importers — are the next
   step). The roadmap itself says "Start with full snapshots for small
   repositories."
2. **No `AMBIGUOUS` provenance emitted yet** — the extractor only produces
   EXTRACTED/RESOLVED/INFERRED, matching current rule certainty.
3. **`repo:root` evidence requires a primary manifest** (e.g. package.json).
4. **Fixture-backed repositories**: extraction resolves via
   `repository.metadata.fixture`; real GitHub App checkouts are Phase H5 scope.
5. **Graph per snapshot, not incremental node reuse** across snapshots — reuse
   is at snapshot granularity (content-addressed hashes make per-node reuse
   straightforward later).
6. **Phase H4 (session H9) uses a Mastra-contract adapter, not `@mastra/core`.**
   The typed step/transition/parallel-wave/gate/replay surface is implemented
   deterministically in `packages/ai-harness/src/workflow.ts` and invoked by the
   `agent-plan` and `agent-replay` BullMQ jobs; the real Mastra dependency stays
   deferred (roadmap risk table: BullMQ/Postgres remain the workflow authority).
   Swapping in `@mastra/core` later requires no worker change.

## 7. Risks & Mitigations (per non-negotiable rules)

| Risk                            | Status/Mitigation                                                                                                          |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Cross-tenant graph reads        | Every query is `organizationId`-bounded; cross-org → 404/validation error; RLS remains a defense-in-depth future layer     |
| Graph precision (alert fatigue) | Deterministic-only facts with provenance/confidence; evidence-linked edges; H2 fixture corpus is the next evaluation gated |
| Model never guesses             | No AI in this loop; releases require explicit recording/evidence; semver is null-opaque                                    |
| Unbounded growth of snapshots   | Content hashes + README reuse; retention policy pending (roadmap ops requirement)                                          |
| Worker idempotency              | `skipDuplicates`, unique content keys, audit on every transition                                                           |

## 8. Next Best Step (from the report in `development-ledger.md`)

1. **Per-file content-hash skip with importer/caller re-extract** for push
   events (roadmap incremental indexing steps 3–4).
2. **H2 fixture corpus** (historical release + repo snapshots) to report
   match precision/recall against the roadmap's ≥95% recall / ≥90% precision
   launch targets.
3. `ReleaseEvidence`/`DetectionRun` adapter ingest + scheduling so recording is
   event-driven from trusted sources (roadmap: Watchtower supplies evidence —
   a model never discovers a release by guessing).
4. Then, per roadmap order: single typed AI planner (AI SDK, Phase H3) → Mastra
   reviewer workflow (H4) — only after the deterministic loop above is measured.

> Update (session H9): H3 and H4 are delivered — H4 as a Mastra-contract adapter
> (`agent-plan`/`agent-replay` BullMQ jobs, release/impact analysts in parallel,
> planner → reviewer, plan/review evaluation gates, manual replay via
> `POST /api/runs/[id]/replay`). Full detail in the development ledger.

---

_Report generated from verified implementation state: all static gates green,
517 tests passing, live E2E evidence in §5. Companion ledger entry:
`docs/development-ledger.md` → "Software intelligence graph (roadmap Phases H0–H2)"._
