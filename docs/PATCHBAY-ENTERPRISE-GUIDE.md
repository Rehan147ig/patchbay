# Patchbay — Enterprise Architecture & Product Guide

This is the authoritative guide for Patchbay: system architecture, multi-tenant database isolation, governance, integration setup, testing, and production roadmap.

---

## 1. Executive Summary

Patchbay is an automated, policy-governed code migration engine designed for TypeScript monorepos and multi-repository organizations. When API vendors release breaking SDK changes or deprecate parameters, Patchbay scans target repositories, maps affected call sites via AST analysis, generates rule-based patch diffs, validates patches in isolated sandboxes, enforces organization-level governance rules, and opens draft Pull Requests via GitHub App installations with an immutable append-only audit log.

---

## 2. Architecture & Data Model

```
                    ┌─────────────────────────┐
                    │ Next.js 15 Web Dashboard │
                    │   (apps/web - RBAC UI)  │
                    └────────────┬────────────┘
                                 │
     ┌───────────────────────────┼───────────────────────────┐
     ▼                           ▼                           ▼
┌──────────────┐       ┌──────────────────┐       ┌─────────────────────┐
│ Auth Layer   │       │ PostgreSQL 16    │       │ BullMQ Queue        │
│ NextAuth OAuth│      │ (Prisma 6 + RLS) │       │ (apps/worker engine)│
└──────────────┘       └──────────────────┘       └──────────┬──────────┘
                                                             │
                  ┌──────────────────────────────────────────┴──────────────────────────┐
                  ▼                                          ▼                          ▼
     ┌────────────────────────┐                 ┌───────────────────────┐  ┌────────────────────────┐
     │ @patchbay/repo-analysis│                 │ @patchbay/git-provider│  │ @patchbay/policy-engine│
     │  (AST & Lockfiles)     │                 │ (GitHub App Tokens)   │  │ (Governance & Risk)   │
     └────────────────────────┘                 └───────────────────────┘  └────────────────────────┘
```

### Multi-Tenant Database Isolation

Every tenant-owned operational record stores a direct `organizationId` with foreign keys to `Organization` and dedicated database indexes:

- `User`, `Repository`, `RepositoryScan`, `IntegrationUsage`, `ImpactAssessment`, `ImpactAssessmentUsage`, `RemediationPlan`, `PatchArtifact`, `ValidationRun`, `PullRequest`, `Approval`, `Policy`, `AuditEvent`, `GitHubInstallation`, `VendorChangeEvent` (nullable, stamped for tenant events), `WebhookDelivery` (optional).

Global shared data remains un-scoped:

- `Vendor`, `NormalizedChange` (scoped transitively through the change event).

---

## 3. GitHub App Integration Architecture

1. **Authentication**: App RS256 JWT minted via `node:crypto` (`createAppJwt`), exchanged for short-lived installation access tokens scoped to customer organization installations.
2. **Branching & PR Creation**: Atomic Git tree operations create a stable branch (`patchbay/remediation-${planId}`) and open a draft Pull Request with unified diff patches.
3. **Webhook Ingestion**: `/api/webhooks/github` verifies inbound HMAC signatures (`sha256`), processes installation lifecycle events, and syncs PR status (`DRAFT`, `OPEN`, `MERGED`, `CLOSED`) to the database with `AuditAction.PR_STATUS_SYNCED`.
4. **Idempotency Guard**: `remediationPlanId` carries a `@unique` database constraint on `PullRequest` to prevent duplicate PR creation across worker retries.

---

## 4. Quality Verification & Testing

The workspace enforces 100% clean status across all 14 monorepo packages:

```bash
# Refresh Prisma Client types
pnpm db:generate

# Run database migrations with tenant backfills
pnpm db:migrate

# Typecheck all 14 workspace packages (zero errors)
pnpm typecheck

# Run full Vitest suite (260 passing tests across 24 test files)
pnpm test

# Lint check (zero ESLint warnings)
pnpm lint

# Prettier format check
pnpm format:check
```

---

## 5. Enterprise Roadmap & Gaps to Production

1. **E1: Ephemeral Container Execution Plane**: Transition `sandbox-runner` from host `child_process.spawn` to Docker / gVisor microVM container sandboxes with strict CPU, memory, timeout, and network egress limits.
2. **E2: Database Row-Level Security (RLS)**: Apply transaction-scoped PostgreSQL RLS policies matching `current_setting('app.current_organization_id')`.
3. **E3: Cloud Deployment**: Deploy Web UI + BullMQ Worker to Railway / Render with managed Postgres (Neon/Supabase) and Redis (Upstash).
4. **E4: Enterprise Compliance Exports**: Add CSV/JSON audit export endpoints and downloadable PDF compliance verification reports per remediation plan.
