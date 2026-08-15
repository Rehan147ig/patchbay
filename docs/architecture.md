# Patchbay — System Architecture

## 1. Overview & Monorepo Structure

Patchbay is a high-assurance, policy-governed code remediation platform. It is structured as a **pnpm monorepo** separating deployable applications (`apps/web`, `apps/worker`) from pure, DB-free domain and engine packages (`packages/*`).

```
                    ┌─────────────────────────────┐
                    │        apps/web (Next.js)   │
                    │  dashboard (RSC) + route    │
                    │  handlers (typed JSON API)  │
                    └──────┬──────────────┬───────┘
                           │              │
                   packages/domain, db,   │
                   audit, env, ui         │  enqueue jobs
                           │              ▼
                    ┌──────┴──────┐  ┌──────────────┐      ┌─────────┐
                    │  postgres   │  │  apps/worker │◄────►│  redis  │
                    │  (Prisma)   │  │  (BullMQ)    │      └─────────┘
                    └─────────────┘  └──┬───────────┘
                                        │ uses pure engine packages
    ┌───────────────────────────────────┼────────────────────────────────┐
    │ packages/repo-analysis            │ packages/ai-harness            │
    │ packages/remediation-engine       │ packages/ai-provider           │
    │ packages/policy-engine            │ packages/git-provider          │
    │ packages/vendor-connectors        │ packages/sandbox-runner        │
    └───────────────────────────────────┼────────────────────────────────┘
                                        ▼
                             fixtures/repositories (legacy sample repos)
```

---

## 2. Package Responsibilities & Boundaries

- **`packages/domain`**: Single source of truth for domain enums, semver engine (`semver.ts`), Zod input schemas, custom error classes, and JSON logging with `AsyncLocalStorage` correlation IDs. Zero external runtime dependencies.
- **`packages/env`**: Typed environment variable parsing (`env.ts`) and secret redaction utilities.
- **`packages/db`**: Prisma schema, client singleton, multi-tenant row-scoping helpers (`org-scope.ts`), and seed script.
- **`packages/audit`**: Append-only `AuditEvent` builder and secret redaction helper.
- **`packages/vendor-connectors`**: 56-connector catalog, OpenAPI diff normalizers, and declarative `defineConnector` SDK.
- **`packages/repo-analysis`**: Static TypeScript AST compiler analyzer, lockfile parser, and commit-versioned **Software Intelligence Graph** extractor (`graph.ts`).
- **`packages/remediation-engine`**: Deterministic migration rules, unified diff generator, and H2/H8 evaluation corpus runner.
- **`packages/policy-engine`**: Declarative JSON policy decision evaluator (`ALLOW_DRAFT_PR`, `REQUIRE_APPROVAL`, `ALLOW_PLAN_ONLY`, `DENY`).
- **`packages/ai-harness`**: Vercel AI SDK wrapper, Zod `PatchPlan` validation, cost/token accounting, and Mastra multi-agent workflow supervisor.
- **`packages/ai-provider`**: Abstract `AiProvider` interface with `MockAiProvider` (default) and `OpenAiCompatibleProvider` drivers.
- **`packages/sandbox-runner`**: Container sandbox runner executing allowlisted build/test commands with timeouts and output bounds.
- **`packages/git-provider`**: `GitProvider` interface with `LocalGitProvider` (mock), `GitHubProvider` (PAT), and `GitHubAppProvider` (JWT + installation access tokens).

---

## 3. End-to-End Watchtower & Remediation Pipeline

```
 ┌─────────────────────────────────────────────────────────────────────────────────────────┐
 │                           1. EVENT INGESTION & WATCHTOWER                               │
 ├─────────────────────────────────────────────────────────────────────────────────────────┤
 │ • Watchtower polling: npm registry releases & vendor OpenAPI spec diffs                  │
 │ • Agent mode ingestion: POST /api/vendors/:slug/events (pb_agent_* bearer key)          │
 │ • Webhook ingestion: POST /api/webhooks/github (HMAC sha256 signature verification)     │
 └────────────────────────────────────────────┬────────────────────────────────────────────┘
                                              │
                                              ▼
 ┌─────────────────────────────────────────────────────────────────────────────────────────┐
 │                        2. SOFTWARE INTELLIGENCE GRAPH & MATCHING                        │
 ├─────────────────────────────────────────────────────────────────────────────────────────┤
 │ • scan-repository: extracts AST usages & indexes dependencies (commitSha)              │
 │ • graph-index: extracts immutable GraphSnapshot (nodes: MODULE, SYMBOL; edges: INVOKES)│
 │ • classify-release: normalizes release facts into method renames & breaking rules       │
 │ • match-release: matches release against dependency inventory using strict semver      │
 └────────────────────────────────────────────┬────────────────────────────────────────────┘
                                              │
                                              ▼
 ┌─────────────────────────────────────────────────────────────────────────────────────────┐
 │                     3. GOVERNED REMEDIATION & MULTI-AGENT HARNESS                       │
 ├─────────────────────────────────────────────────────────────────────────────────────────┤
 │ • Blast Radius Analysis: maps risk tags (PAYMENT, AUTH, PII, WEBHOOK, INFRASTRUCTURE)  │
 │ • AI Harness: Mastra workflow (ReleaseAnalyst -> ImpactAnalyst -> Planner -> Reviewer)  │
 │ • Patch Engine: applies AST-aware replacements, verifies source hashes & diff budgets    │
 │ • Sandbox Validation: executes allowlisted build/test commands in isolated container     │
 │ • Policy Engine: evaluates decision (ALLOW_DRAFT_PR, REQUIRE_APPROVAL, DENY)            │
 │ • Delivery: opens draft PR via GitHubAppProvider with installation access tokens        │
 │ • Audit: appends AuditEvent log with secret redaction                                    │
 └─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Key Subsystem Details

### 4.1 Software Intelligence Graph (`packages/repo-analysis`)

- Creates immutable `GraphSnapshot` records per repository commit SHA (`READY` status).
- Extracted nodes: `REPOSITORY`, `FILE`, `MODULE`, `SYMBOL`, `FUNCTION`, `CLASS`, `DEPENDENCY`, `PACKAGE`, `API_CLIENT`, `API_OPERATION`, `TEST`.
- Extracted edges: `CONTAINS`, `EXPORTS`, `IMPORTS`, `CALLS`, `RESOLVES_TO`, `USES_PACKAGE`, `CREATES_CLIENT`, `INVOKES_API`, `TESTS`.
- Fixed provenance classes: `EXTRACTED` (100%), `RESOLVED` (99/95%), `INFERRED` (85/90/80%).

### 4.2 Multi-Agent Workflow Supervisor (`packages/ai-harness`)

- Coordinates 4 agent roles:
  1. **Release Analyst**: Normalizes trusted release evidence into breaking change facts.
  2. **Impact Analyst**: Queries pre-indexed `GraphSnapshot` subgraphs for affected callsites.
  3. **Migration Planner**: Generates Zod-validated `PatchPlan` proposals bound to source hashes.
  4. **Independent Reviewer**: Compares patch diffs against risk tags and policy requirements.
- Logs every execution as `AgentRun` and `AgentStep` for latency, token count, and USD cost tracking.

### 4.3 GitHub App & Delivery Layer (`packages/git-provider`)

- Mints RS256 App JWTs via `node:crypto` (`createAppJwt`), exchanging them for short-lived installation access tokens.
- Creates atomic draft PRs (`patchbay/remediation-...`) on default branches.
- Webhook receiver `/api/webhooks/github` verifies `x-hub-signature-256`, deduplicates deliveries by `x-github-delivery`, and synchronizes PR status monotonically (`DRAFT → OPEN → MERGED/CLOSED`).

### 4.4 Multi-Tenant Row Isolation (`packages/db`)

- Every tenant-owned database table includes a direct `organizationId` foreign key and database index (`Repository`, `RepositoryScan`, `RemediationPlan`, `PullRequest`, `GraphSnapshot`, `AuditEvent`, etc.).
- `org-scope.ts` provides explicit organization-bounding helpers for queries across route handlers and worker jobs.

---

## 5. Security & Isolation Boundaries

- **Command Allowlist**: Only `pnpm install`, `pnpm test`, `pnpm typecheck`, `pnpm lint`, `npm ci`, `npm test` are permitted in sandbox execution.
- **Draft PRs Only**: Patchbay never auto-merges pull requests.
- **Human Approval**: Mandatory for payment, auth, PII, webhook, encryption, secrets, and infrastructure code changes.
- **Secret Redaction**: Secret keys, tokens, and credentials are redacted from logs, audit events, and AI contexts.
