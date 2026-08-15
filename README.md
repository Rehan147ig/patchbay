# Patchbay — Governed API-Change Remediation Platform

[![CI](https://github.com/Rehan147ig/patchbay/actions/workflows/ci.yml/badge.svg)](https://github.com/Rehan147ig/patchbay/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![pnpm](https://img.shields.io/badge/pnpm-10.x-orange.svg)](https://pnpm.io/)
[![Prisma](https://img.shields.io/badge/Prisma-6.x-green.svg)](https://www.prisma.io/)

**Patchbay** is an enterprise-grade, policy-governed code remediation platform. When a third-party API or SDK releases a breaking change, deprecates a method, or updates a parameter, Patchbay automatically detects the release, maps the exact impact across your repositories using a commit-versioned **Software Intelligence Graph**, drafts AST-aware code migration pull requests, validates changes in an isolated sandbox, enforces policy-based approval gates, and opened governed draft PRs with full audit trails.

---

## 🏗️ System Architecture & Workflow Pipeline

Patchbay operates as an event-driven, multi-tier pipeline connecting external vendor events to customer software intelligence graphs and automated remediation workflows:

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                             WATCHTOWER EVENT INGESTION                                   │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│  [SDK Monitor]      cron: npm registry polling -> detect new version -> fetch changelog │
│  [API Monitor]      cron: OpenAPI spec fetch -> detect spec diffs -> analyze API changes │
│  [Event Pipeline]   webhook: POST /api/vendors/:slug/events (pb_agent_* bearer key)    │
└─────────────────────────────────────────────┬────────────────────────────────────────────┘
                                              │
                                              ▼
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                         SOFTWARE INTELLIGENCE GRAPH & MATCHING                           │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│  1. Ingestion:     Scan repository -> build commit-versioned GraphSnapshot (READY)      │
│  2. Graph Engine:   Extract AST nodes (MODULE, SYMBOL, API_CLIENT) & edges (INVOKES_API) │
│  3. Semver Engine: Match ReleaseRecord against RepositoryDependency (exact & range)     │
│  4. Impact Map:    Generate explainable match reasons & module-level evidence graph     │
└─────────────────────────────────────────────┬────────────────────────────────────────────┘
                                              │
                                              ▼
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                      GOVERNED REMEDIATION & MULTI-AGENT HARNESS                          │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│  1. Blast Radius:  Evaluate risk tags (PAYMENT, AUTH, PII, WEBHOOK, INFRASTRUCTURE)       │
│  2. AI Harness:    Vercel AI SDK + Mastra supervisor (ReleaseAnalyst -> Planner -> Reviewer)│
│  3. Patch Engine:  Apply AST-aware rules, verify source hashes & max diff budgets       │
│  4. Validation:    Execute allowlisted build/test suite in isolated container sandbox    │
│  5. Policy Decision: ALLOW_DRAFT_PR  |  REQUIRE_APPROVAL  |  ALLOW_PLAN_ONLY  |  DENY    │
│  6. Delivery:      GitHub App draft PR (installation access tokens + HMAC webhooks)     │
│  7. Audit Trail:   Append-only AuditEvent log with secret redaction                     │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## ✨ Key Features

- **Software Intelligence Graph (`packages/repo-analysis`)**:
  - Immutable, content-addressed `GraphSnapshot` per commit SHA.
  - Granular node vocabulary (`MODULE`, `SYMBOL`, `FUNCTION`, `DEPENDENCY`, `API_CLIENT`, `API_OPERATION`, `TEST`).
  - Strict edge vocabulary (`USES_PACKAGE`, `CREATES_CLIENT`, `INVOKES_API`, `EXPORTS`, `IMPORTS`, `TESTS`).
  - Fixed provenance (`EXTRACTED`, `RESOLVED`, `INFERRED`) with file path, line range, and source hash evidence.

- **Deterministic Semver & Matching Engine (`packages/domain`, `apps/worker`)**:
  - Zero-hallucination semver parser (`parseVersion`, `compareVersions`, `satisfiesRange`).
  - Automatic `classify-release` job for structured breaking change extraction.
  - Precision `match-release` job linking global releases to repository dependencies with zero false positives.

- **56-Connector Catalog & Declarative SDK (`packages/vendor-connectors`)**:
  - Pre-built connectors across 10 categories: AI/LLM, Cloud/Infra, Payments, Auth, Messaging, DB/Data, Web Frameworks, Search/Observability, CRM, and Generic OpenAPI.
  - Declarative `defineConnector()` SDK allowing new vendor connectors in ~40 lines of TypeScript.

- **Vercel AI SDK & Mastra Multi-Agent Harness (`packages/ai-harness`)**:
  - Provider registry supporting `mock`, `openai`, and custom models behind `AiProvider`.
  - Mastra supervisor workflow coordinating Release Analyst, Impact Analyst, Migration Planner, and Independent Reviewer agents.
  - Complete `AgentRun` and `AgentStep` persistence for token usage, latency, and cost accounting.

- **GitHub App & Real Repository Integration (`packages/git-provider`)**:
  - JWT minting (`node:crypto`) and installation access token exchange.
  - Atomic draft PR creation on remote GitHub repositories.
  - HMAC `sha256` webhook receiver (`/api/webhooks/github`) with delivery deduplication and monotonic PR status synchronization (`DRAFT → OPEN → MERGED/CLOSED`).

- **Container Sandbox Isolation (`packages/sandbox-runner`)**:
  - Allowlisted command execution with hard timeouts, memory/CPU bounds, and sanitized output capture.

- **Multi-Tenant Security & Governance**:
  - Direct `organizationId` foreign keys and database indexes across all operational models (`Repository`, `RemediationPlan`, `PullRequest`, `GraphSnapshot`, `AuditEvent`, etc.).
  - Declarative JSON policy engine with approval gates, confidence thresholds, and risk-tag overrides.
  - Append-only audit trail with automatic secret redaction.

---

## 📁 Monorepo Structure

```
patchbay/
├── apps/
│   ├── web/                     # Next.js 15 App Router dashboard & typed JSON API route handlers
│   └── worker/                  # BullMQ background worker (scan, analyze, graph-index, validate, create-pr)
├── packages/
│   ├── ai-harness/              # Vercel AI SDK + Mastra multi-agent workflow supervisor
│   ├── ai-provider/              # AiProvider interface (Mock & OpenAI-compatible drivers)
│   ├── audit/                   # Append-only AuditEvent builder & secret redaction
│   ├── db/                      # Prisma schema, client singleton, and database utilities
│   ├── domain/                  # Single source of truth: enums, semver engine, Zod schemas, errors, logger
│   ├── env/                     # Typed environment variable validation & secret management
│   ├── git-provider/            # GitProvider abstraction (LocalGitProvider, GitHubProvider, GitHubAppProvider)
│   ├── policy-engine/           # Deterministic policy decision engine (ALLOW/APPROVE/DENY)
│   ├── queue/                   # BullMQ queue definitions, job contracts, and Redis connection
│   ├── remediation-engine/      # AST-aware code transformation rules & unified diff generator
│   ├── repo-analysis/           # TypeScript compiler AST indexer & Software Intelligence Graph extractor
│   ├── sandbox-runner/          # Allowlisted command execution runner with timeouts & output bounds
│   ├── ui/                      # Accessible UI primitive components (Card, Button, Badge, Table, CodeBlock)
│   └── vendor-connectors/       # 56-connector catalog & declarative defineConnector SDK
├── docs/                        # Architecture, Watchtower, Agent Harness, and security documentation
└── fixtures/repositories/       # Legacy sample repositories for testing (openai-node-legacy, stripe-node-legacy, ...)
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

---

## 🧪 Verification & Testing

The repository enforces 100% clean quality gates across all 17 workspace packages:

```bash
# Typecheck all 17 monorepo packages (zero errors)
pnpm typecheck

# Run full Vitest suite (634 passing tests across 52 test files)
pnpm test

# Run ESLint (zero warnings)
pnpm lint

# Check Prettier formatting
pnpm format:check
```

---

## 🔐 Security & Governance Principles

1. **Draft PR Default**: Patchbay opens draft pull requests only; auto-merging is never enabled by default.
2. **Mandatory Validation**: Validation tests must pass before any pull request is submitted.
3. **Approval Gates**: Payment, Auth/Authorization, PII, Webhook Verification, Encryption, Secrets, and Infrastructure changes require explicit human approval.
4. **Command Allowlist**: Sandbox execution runs strictly allowlisted build and test commands; LLMs have zero shell access.
5. **Secret Redaction**: Sensitive keys and secrets are automatically redacted from logs, audit events, and AI contexts.
6. **Monotonic PR Sync**: GitHub webhook status updates synchronize PR states strictly forward (`DRAFT → OPEN → MERGED/CLOSED`).

---

## 📜 License

Distributed under the MIT License. See [`LICENSE`](LICENSE) for more information.
