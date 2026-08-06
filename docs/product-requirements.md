# Patchbay - Product Requirements

## 1. Product statement

When a third-party API or SDK changes, Patchbay detects the change, finds the exact affected
usages across connected repositories, generates a safe migration pull request for known bounded
patterns, runs verification, and records an auditable remediation trail.

Patchbay is a **governed remediation workflow**, not a generic chatbot, changelog summarizer, or
OpenAPI diff dashboard.

## 2. Personas

- **Engineering leader**: wants visibility, policy control, auditability, minimal interruption.
- **Platform engineer**: owns integration health, migration rules, CI verification.
- **Senior developer**: fixes the affected code, needs exact locations and confidence.

## 3. Core journey

1. User creates a workspace and connects/registers repositories.
2. User selects vendors to monitor.
3. A vendor change event arrives (SDK upgrade, method/signature change, parameter deprecation,
   configuration change, OpenAPI breaking change).
4. Patchbay normalizes and classifies the change (breaking? severity? category?).
5. Patchbay scans repositories and identifies affected files, imports, methods, endpoint
   references, likely owners, risk tags.
6. Patchbay calculates impact score (0-100) and confidence (0-100) with transparent rationale.
7. Patchbay creates a remediation plan (rule-based or AI-assisted, clearly labeled).
8. For known, bounded patterns, Patchbay generates a patch and runs allowlisted validation.
9. Policy decides: plan-only / validate / draft PR / require approval / deny.
10. If allowed, Patchbay creates a **draft** PR via the git provider.
11. Dashboard shows what changed, why it matters, affected files/services, patch details,
    validation results, confidence, policy decisions, approval status, audit history.

## 4. MVP scope

### In scope

- One organization/workspace; GitHub-architecture with local/mock adapter, offline demo.
- TypeScript/Node repos, npm manifests.
- Vendor catalog: Stripe, OpenAI, Twilio, Auth0, Generic OpenAPI.
- Manually created/imported change events; OpenAPI document diffing.
- Static impact analysis via TypeScript compiler API + lockfile parsing.
- Migration-rule engine with AST-aware, bounded transforms.
- AI-assisted planning via abstraction; deterministic mock default; Zod-validated output.
- Sandboxed validation via allowlisted commands with timeouts.
- Draft PR creation (local provider by default; GitHub scaffold behind env vars).
- Immutable audit trail (application-level append-only).
- Approval gates, confidence thresholds, JSON policies.

### Out of scope (MVP)

- Auto-merge. Touching production systems. Storing real credentials.
- Arbitrary LLM-driven command execution. Universal vendor/language coverage.
- Executing untrusted code without sandbox restrictions. Autonomous fixing of all changes.

### Default safety policy

- Create draft PRs only; never auto-merge.
- Passing validation is required before PR creation.
- Human approval required for: payments, authentication, authorization, PII, webhook
  verification, encryption, secrets, infrastructure.
- Each important action records an immutable audit event.

## 5. Scoring model

**Impact (0-100)**: source-change severity, exact usage count, production-path heuristic,
high-risk tags, exactness of symbol match, owner/test coverage when detected.

**Confidence (0-100)**: exact AST pattern match (+), known rule (+), tests covering changed
behavior (+), dynamic/ambiguous access (-), missing package version (-), high-risk tags (-).

**Policy thresholds**:

- Confidence < 70: plan only, no patch.
- 70-84: patch + validation; draft PR only if policy allows.
- 85+: patch + validation + draft PR, unless high-risk tags.
- Payment/auth/authorization/PII/webhook-sensitive routes: human approval required.
- Any failed validation: no PR creation.

Every score must be explainable in the UI (which factors moved it, how).

## 6. Vendor connectors

Common interface: ingest change, normalize, detect usage, generate rule-based patch, risk tags.

- **Stripe**: dependency/import/init detection; fixture migration rule (customer creation gains
  `metadata: { source: "app" }`); payment paths high risk; payment execution requires human review.
- **OpenAI**: dependency/import/init detection; fixture rule maps legacy `createChatCompletion`
  to `client.chat.completions.create`; patch only on exact AST match.
- **Twilio**: usage/import detection, `messages.create` detection; configuration/deprecation
  fixture event; messaging changes medium risk.
- **Auth0**: usage/import/middleware/config detection; auth changes high risk; explicit approval
  mandatory - never automatic PRs.
- **Generic OpenAPI**: paste old/new OpenAPI JSON; deterministic diff (removed endpoint, removed
  response property, changed property type, newly required field); impact mapping + plan only,
  no patch generation in the MVP.

## 7. Acceptance criteria

1. OpenAI fixture: analyzer finds `createChatCompletion`; impact = affected; rule engine diff;
   validation passes; local provider creates draft PR; audit trail written.
2. Auth0: usage found; impact assessed; policy requires approval; PR creation blocked pre-approval;
   audit captures the block.
3. Generic OpenAPI: removed response property detected; breaking normalized change; plan-only.
4. Safety: shell runner rejects non-allowlisted commands; AI cannot supply executable commands;
   failed validation blocks PR; sensitive risk tags require approval.
5. UI: Playwright OpenAI demo flow completes; remediation diff + validation visible; Auth0 policy
   gating visible.

## 8. Non-functional requirements

- Deterministic first, AI second; explainability everywhere; bounded transformations.
- Credentials server-side only; secret redaction in logs/audit/AI context.
- Local runner explicitly documented as not production-hardened.
- No fake metrics; seed data labeled "Demo data". No dead buttons/routes.
