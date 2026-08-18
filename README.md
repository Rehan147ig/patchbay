# Patchbay — Governed API-Change Remediation Platform

[![CI](https://github.com/Rehan147ig/patchbay/actions/workflows/ci.yml/badge.svg)](https://github.com/Rehan147ig/patchbay/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![pnpm](https://img.shields.io/badge/pnpm-10.x-orange.svg)](https://pnpm.io/)
[![Prisma](https://img.shields.io/badge/Prisma-6.x-green.svg)](https://www.prisma.io/)

**Patchbay** is a neutral, policy-governed API-change remediation platform. When a vendor releases a
breaking SDK update, deprecates a method, or updates an API specification, Patchbay detects the release
via its Release Watchtower, proves TypeScript AST usages across your repositories using a commit-versioned
**Software Intelligence Graph**, and opens reviewable draft pull requests when a certified rule pack exists
(OpenAI, Stripe, Twilio for Node/TS today; Auth0 and Generic OpenAPI for reviewable planning; 56-connector
catalog for detection and impact assessment).

Patchbay validates all code edits in an isolated sandbox runner, enforces policy-based approval gates
(payments, auth, webhooks), opens governed draft PRs that are never auto-merged, and immutably audits
every decision — with an outcome-learning capability kill switch driving reliability.

> **For AI coding agents**: start at [`AGENTS.md`](AGENTS.md) — it is the canonical orientation
> document (repo layout, non-negotiable rules, verification commands, architecture rules).

---

## 🏗️ System Architecture

```mermaid
flowchart TB
    subgraph Ingest["1 · EVENT INGESTION"]
        SW[Watchtower pollers<br/>npm registry + OpenAPI diffs]
        AE[Agent ingest<br/>POST /api/vendors/:slug/events<br/>pb_agent_* bearer key]
        WH[GitHub App webhook<br/>POST /api/webhooks/github<br/>HMAC sha256 + replay window]
    end

    subgraph Graph["2 · SOFTWARE INTELLIGENCE GRAPH"]
        SCAN[scan-repository<br/>TS AST + lockfile inventory]
        GX[graph-index<br/>immutable GraphSnapshot<br/>per commit SHA]
        CLS[classify-release<br/>breaking change facts]
        MATCH[match-release<br/>strict semver matching]
    end

    subgraph Remediate["3 · GOVERNED REMEDIATION"]
        CASE[RemediationCase<br/>policy-first blast radius]
        HARNESS[AI harness<br/>analyst → planner → reviewer]
        PATCH[Patch engine<br/>AST-aware + hash-verified]
        VALIDATE[Sandbox validation<br/>allowlisted commands only]
        POLICY[Policy engine<br/>ALLOW / APPROVE / DENY]
        PR[Draft PR via GitHub App]
    end

    subgraph Learn["4 · OUTCOME LEARNING (WP10)"]
        OUTCOME[(PrOutcome<br/>linked to versions/evidence)]
        FEEDBACK[Feedback UI<br/>/outcomes dashboard]
        SLO[SLO rollups<br/>@patchbay/operations]
        GATE[(CapabilityGate<br/>auto-suspend kill switch)]
    end

    SW --> GX
    AE --> GX
    WH --> PR
    SCAN --> GX
    GX --> CLS
    CLS --> MATCH
    MATCH --> CASE
    CASE --> HARNESS
    HARNESS --> PATCH
    PATCH --> VALIDATE
    VALIDATE --> POLICY
    POLICY --> PR
    PR -- "merged / closed (webhook)" --> OUTCOME
    PR -- "human verdict" --> FEEDBACK
    OUTCOME --> SLO
    SLO --> GATE
    GATE -- "suspends enqueue" --> HARNESS
    GATE -- "suspends enqueue" --> VALIDATE
```

### End-to-end remediation flow (one breaking release)

```mermaid
sequenceDiagram
    participant R as npm registry / vendor API
    participant W as Watchtower worker
    participant G as GraphSnapshot (Postgres)
    participant H as AI harness
    participant S as Sandbox runner
    participant P as Policy engine
    participant GH as GitHub App
    participant A as AuditEvent

    R->>W: new version released
    W->>G: classify + match against repo dependencies
    G-->>W: affected repositories + usage subgraph
    W->>W: create RemediationCase (blast radius, policy snapshot)
    W->>H: plan migration (ReleaseAnalyst → Planner → Reviewer)
    H-->>W: Zod-validated PatchPlan (source-hash bound)
    W->>S: run allowlisted validation commands
    S-->>W: pass/fail + sanitized output
    W->>P: policy decision (risk tags, approvals)
    P-->>W: ALLOW_DRAFT_PR | REQUIRE_APPROVAL | DENY
    W->>GH: open draft PR (installation token)
    GH-->>W: webhook on merged/closed
    W->>W: record PrOutcome + SLO evaluation
    W->>A: append audit events (redacted) at every step
```

### AST extraction & Software Intelligence Graph

```mermaid
flowchart LR
    REPO[fixtures/repositories<br/>sample TS repos] --> TS[TypeScript compiler<br/>ts.createProgram]
    TS --> USAGE[usage extraction<br/>IntegrationUsage]
    TS --> GRAPH[graph extractor<br/>nodes + edges]
    TS --> LOCK[lockfile parser<br/>dependencies]

    USAGE --> SNAPSHOT[(GraphSnapshot<br/>immutable, commit-versioned)]
    GRAPH --> SNAPSHOT
    LOCK --> INVENTORY[(RepositoryDependency<br/>exact + range pins)]

    SNAPSHOT --> IMPACT[Impact analyst<br/>subgraph queries]
    INVENTORY --> SEMVER[strict semver engine<br/>zero-hallucination]

    subgraph NodeVocabulary["node vocabulary"]
        N1[MODULE / SYMBOL / FUNCTION / CLASS]
        N2[DEPENDENCY / PACKAGE / API_CLIENT]
        N3[API_OPERATION / TEST / FILE]
    end

    subgraph EdgeVocabulary["edge vocabulary"]
        E1[IMPORTS / EXPORTS / CALLS / CONTAINS]
        E2[USES_PACKAGE / CREATES_CLIENT / INVOKES_API]
        E3[RESOLVES_TO / TESTS]
    end

    subgraph Provenance["provenance classes"]
        P1[EXTRACTED 100%]
        P2[RESOLVED 99/95%]
        P3[INFERRED 85/90/80%]
    end
```

### Outcome learning loop (WP10)

```mermaid
flowchart TB
    MERGED[PR merged / closed] --> WH2[GitHub webhook<br/>env-gated]
    WH2 --> REC[recordPrOutcome<br/>single writer]
    FEED[User feedback<br/>/outcomes dashboard] --> REC
    REC --> LINK[link rule-pack / extractor /<br/>model / prompt / snapshot /<br/>validation / policy]
    REC --> EVAL[enqueue evaluate-capability-health]
    EVAL --> METRICS[merge rate, FP rate,<br/>agent latency p95 · 30d window]
    METRICS -- "below thresholds" --> SUSPEND[SUSPEND CapabilityGate]
    SUSPEND -- "draft-pr / validate fail closed" --> GATE
    METRICS -- "healthy" --> GATE[(CapabilityGate<br/>ACTIVE)]
    GATE -- "admin restore" --> ADMIN[POST /api/capability-gates]
```

---

## ✨ Key Features

- **Software Intelligence Graph (`packages/repo-analysis`)**:
  - Immutable, content-addressed `GraphSnapshot` per commit SHA.
  - Granular node vocabulary (`MODULE`, `SYMBOL`, `FUNCTION`, `DEPENDENCY`, `API_CLIENT`, `API_OPERATION`, `TEST`) and strict edge vocabulary (`USES_PACKAGE`, `CREATES_CLIENT`, `INVOKES_API`, `EXPORTS`, `IMPORTS`, `TESTS`).
  - Fixed provenance (`EXTRACTED`, `RESOLVED`, `INFERRED`) with file path, line range, and source hash evidence.
  - TypeScript via the compiler API (strongest L3 path) plus Python L1 via `web-tree-sitter` (WASM).

- **Deterministic Semver & Matching Engine (`packages/domain`, `apps/worker`)**:
  - Zero-hallucination semver parser (`parseVersion`, `compareVersions`, `satisfiesRange`).
  - `classify-release` and `match-release` jobs linking global releases to repository dependencies with zero false positives.

- **56-Connector Catalog & Declarative SDK (`packages/vendor-connectors`)**:
  - Pre-built connectors across 10 categories (AI/LLM, Cloud/Infra, Payments, Auth, Messaging, DB/Data, Web Frameworks, Search/Observability, CRM, Generic OpenAPI).
  - Declarative `defineConnector()` SDK — a new vendor connector in ~40 lines of TypeScript.
  - Connector **certification registry** (`getCapability`, `requireCertified`) gating PLAN/VALIDATE/DRAFT_PR capability levels (WP9).

- **AI Harness (`packages/ai-harness`, `packages/ai-provider`)**:
  - Provider registry (`mock` default, `openai`, custom) behind `AiProvider`.
  - Deterministic workflow supervisor: Release Analyst → Impact Analyst → Migration Planner → Independent Reviewer, with `AgentRun`/`AgentStep` persistence (tokens, latency, cost), replay from failures, and a Mastra-contract adapter as the swap point.
  - Planner/reviewer performance measurement (`measureWorkflow`) with PASS/FAIL thresholds.

- **Governed Remediation Pipeline (`apps/worker`, engine packages)**:
  - `RemediationCase` lifecycle (`OBSERVED → … → MERGED/CLOSED`) with append-only `RemediationCaseEvent` timeline.
  - AST-aware patch generation with source-hash verification and diff budgets (`packages/remediation-engine`).
  - Allowlisted sandbox validation (`packages/sandbox-runner`) — LLMs have zero shell access.
  - Declarative policy gates for payment/auth/PII/webhook/infrastructure changes (`packages/policy-engine`).

- **GitHub App & Real Repository Integration (`packages/git-provider`)**:
  - JWT minting + installation access tokens, atomic draft PR creation.
  - HMAC `sha256` webhook receiver with delivery deduplication, replay window, and monotonic `DRAFT → OPEN → MERGED/CLOSED` PR status sync.

- **Outcome Learning & Enterprise Operations (WP10)**:
  - `PrOutcome` records every terminal PR with full version/evidence/policy linkage; merged outcomes terminalize their case.
  - `/outcomes` dashboard: SLO cards (merge rate, false positive rate, detection latency p95, validation pass rate, agent failure rate, cost per successful remediation) + one-click human feedback classification.
  - Capability kill switch: worker auto-suspends a vendor's `DRAFT_PR` gate when SLOs degrade; `draft-pr`/`validate` routes fail closed while suspended; admin restore via Settings.
  - Enterprise controls: admin export (no raw agent inputs/outputs), org data deletion with an immutable `data.deleted` audit marker, and 90-day agent-run retention purge (audited).

- **Multi-Tenant Security & Governance**:
  - Direct `organizationId` foreign keys + indexes across all operational models; `withOrgContext` row-scoping helpers.
  - Append-only `AuditEvent` trail with automatic secret redaction; correlation IDs on every request.

---

## 📁 Monorepo Structure

```
patchbay/
├── apps/
│   ├── web/                     # Next.js 15 App Router dashboard & typed JSON API route handlers
│   └── worker/                  # BullMQ background worker (scan, analyze, graph-index, validate, create-pr, evaluate-capability-health, purge-agent-runs)
├── packages/
│   ├── ai-harness/              # AI workflow supervisor (analyst → planner → reviewer) + measurement
│   ├── ai-provider/             # AiProvider interface (Mock & OpenAI-compatible drivers)
│   ├── audit/                   # Append-only AuditEvent builder & secret redaction
│   ├── billing/                 # Stripe subscription plans/caps (SDK-free REST client)
│   ├── db/                      # Prisma schema, client singleton, org row-scoping, seed
│   ├── domain/                  # Single source of truth: enums, semver, Zod schemas, errors, logger
│   ├── env/                     # Typed environment variable validation & secret management
│   ├── git-provider/            # GitProvider abstraction (Local, GitHub PAT, GitHub App)
│   ├── operations/              # WP10: SLO rollups, capability health, retention purge (DB-free)
│   ├── policy-engine/           # Deterministic policy decisions (ALLOW/APPROVE/DENY)
│   ├── queue/                   # BullMQ queue definitions, job contracts, Redis connection
│   ├── remediation-engine/      # AST-aware transformation rules & unified diff generation
│   ├── repo-analysis/           # TS compiler API AST indexer + Python L1 + graph extractor
│   ├── sandbox-runner/          # Allowlisted command execution with timeouts & output bounds
│   ├── ui/                      # Accessible UI primitives (Card, Button, Badge, Table, CodeBlock)
│   └── vendor-connectors/       # 56-connector catalog, certification registry, defineConnector SDK
├── docs/                        # architecture.md, CTO execution plan, agent-harness roadmap, ledger, threat model
├── fixtures/repositories/       # Legacy sample repositories for analysis/testing
└── e2e/                         # Playwright specs (apps/web/e2e)
```

---

## ⚡ Quick Start & Development Setup

### Prerequisites

- **Node.js**: `>= 22.0.0`
- **pnpm**: `>= 10.0.0`
- **Docker**: Docker Desktop or Docker Engine (with Compose)

### 1. Clone & Install

```bash
git clone https://github.com/Rehan147ig/patchbay.git
cd patchbay
pnpm install
```

### 2. Configure Environment & Start Services

```bash
cp .env.example .env          # Default local values work out of the box
docker compose up -d          # Starts PostgreSQL (port 5434) and Redis (port 6380)
```

### 3. Initialize Database & Seed Demo Data

```bash
pnpm db:generate              # Generate Prisma Client
pnpm db:migrate               # Apply committed database migrations
pnpm db:seed                  # Seed Acme SaaS organization & vendor catalog
```

### 4. Launch Development Environment

```bash
pnpm dev                      # Starts Next.js web app (http://localhost:3000) & BullMQ worker
```

> Playwright (`pnpm e2e`) starts its own web server on port 3000 — stop any other process
> listening on 3000 first, and keep the worker running for job-processing flows.

---

## 🧪 Verification & Testing

The repository enforces clean quality gates across all 18 workspace projects (2 apps + 16 packages):

```bash
# Typecheck all 18 projects (zero errors)
pnpm typecheck

# Run full Vitest suite (925 passing tests across 86 test files)
pnpm test

# ESLint, zero warnings
pnpm lint

# Prettier check
pnpm format:check

# Production build
pnpm build

# Playwright end-to-end (demo happy path + outcomes dashboard)
pnpm e2e
```

> **Note on `[id]` route tests:** Vitest treats `[id]` in paths as a glob character class, so
> route tests under `apps/web/src/app/api/**/[id]/**` are excluded from `pnpm test`. Run them with
> the temp config: `pnpm vitest run --config vitest.wp10.config.ts` (aliases `@` and `server-only`).

---

## 🧭 Guided Tour for External Agents

- **Orientation**: [`AGENTS.md`](AGENTS.md) — repo layout, non-negotiable engineering rules, commands, architecture rules.
- **Architecture**: [`docs/architecture.md`](docs/architecture.md) — package boundaries, subsystems, security boundaries.
- **Product/execution**: [`docs/PATCHBAY-CTO-EXECUTION-PLAN.md`](docs/PATCHBAY-CTO-EXECUTION-PLAN.md) — work-package statuses (WP1–WP10).
- **AI harness**: [`docs/PATCHBAY-AGENT-HARNESS-ROADMAP.md`](docs/PATCHBAY-AGENT-HARNESS-ROADMAP.md) and `docs/PATCHBAY-AGENT-HARNESS-IMPLEMENTATION-REPORT.md`.
- **Watchtower**: [`docs/RELEASE-WATCHTOWER.md`](docs/RELEASE-WATCHTOWER.md) — release ledger, adapters, queue topology.
- **Development history**: [`docs/development-ledger.md`](docs/development-ledger.md) — what shipped per work package, with test counts.
- **Threat model**: [`docs/threat-model.md`](docs/threat-model.md) — security boundaries and assumptions.

---

## 🔐 Security & Governance Principles

1. **Draft PR Default**: Patchbay opens draft pull requests only; auto-merging is never enabled.
2. **Mandatory Validation**: Validation must pass before any PR is submitted; only allowlisted commands run in the sandbox.
3. **Approval Gates**: Payment, Auth/Authorization, PII, Webhook, Encryption, Secrets, and Infrastructure changes require explicit human approval.
4. **Command Allowlist**: LLMs have zero shell access; sandbox runs strictly allowlisted build/test commands with timeouts.
5. **Secret Redaction**: Secrets are redacted from logs, audit events, and AI contexts; credentials live server-side only.
6. **Monotonic PR Sync**: GitHub webhook status updates move strictly forward (`DRAFT → OPEN → MERGED/CLOSED`).
7. **Fail-Closed Capabilities**: SLO-degraded vendor capabilities are auto-suspended and require admin restore.
8. **Local-Dev Honesty**: The bundled sandbox and dev authentication are local-development tools, not hardened multi-tenant infrastructure — stated in docs and UI.

---

## 📜 License

Distributed under the MIT License. See [`LICENSE`](LICENSE) for more information.
