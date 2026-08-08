# Patchbay

**Governed API-change remediation.** When a third-party API or SDK changes, Patchbay detects the
change, finds the exact affected usages across connected repositories, generates a safe migration
pull request for known, bounded patterns, runs verification, and records an auditable remediation
trail.

This repository contains a local-development, production-shaped MVP. It runs fully offline with a
deterministic mock AI provider and a local (mock) git provider - no API keys required.

## Product scope

The MVP supports:

- One organization/workspace with seeded demo data ("Acme SaaS"), org-scoped change/plan data
- Per-vendor **agent mode**: vendors authenticate with `pb_agent_*` keys and push change events
  through `POST /api/vendors/:slug/events` without a dashboard session
- Local fixture repositories (Stripe, OpenAI, Twilio, Auth0, generic OpenAPI client)
- Manually created or imported vendor change events (including OpenAPI document diffs)
- Static TypeScript impact analysis (TypeScript compiler API)
- Rule-based migration patches for known patterns
- **56 connector catalog** covering AI/LLM, cloud/infra, payments, auth, messaging, data/DB,
  web frameworks, search, observability, and CRM SDKs (see [Connectors](#connectors))
- Declarative connector SDK (`defineConnector`) so any vendor can author a connector in ~40 lines
- Deterministic AI-assisted plan drafting through an abstraction (mock by default;
  OpenAI-compatible provider optional)
- Allowlisted validation command execution with timeouts
- Draft pull-request creation via a local mock git provider (real GitHub scaffolding behind env vars)
- JSON policy engine with approval gates and confidence thresholds
- Full audit trail

The MVP does **not**: auto-merge PRs, modify production systems, store real credentials, execute
arbitrary shell commands, promise universal vendor coverage, or claim autonomous safety for
high-risk changes.

## Architecture (summary)

See [docs/architecture.md](docs/architecture.md) for the full picture.

Patchbay is a **pnpm monorepo** — services and packages are split so each can be
built, tested, and deployed independently:

```
apps/web       Next.js dashboard + typed JSON API route handlers
apps/worker    BullMQ job consumer (scan, analyze, validate, create-pr)
packages/domain          enums, Zod schemas, typed errors, logger (zero deps)
packages/db               Prisma schema + client singleton
packages/audit            AuditEvent builder + secret redaction
packages/ui               accessible UI primitives
packages/queue            shared BullMQ queue def + Redis connection
packages/vendor-connectors  56-connector catalog + defineConnector SDK
packages/repo-analysis    TypeScript AST indexing → IntegrationUsage inventory
packages/remediation-engine  deterministic migration rules → patches + diffs
packages/policy-engine    deterministic policy decisions (allow/approve/deny)
packages/sandbox-runner   allowlisted command execution with timeouts
packages/git-provider     GitProvider interface; LocalGitProvider + GitHubProvider
packages/ai-provider      AiProvider interface; MockAiProvider + OpenAI-compatible
fixtures/repositories     sample legacy repos (openai-node-legacy, stripe-node-legacy, …)
```

The web and worker are the deployable services; the engine packages are pure
functions with no DB/network, so they stay independently testable and can be
published as libraries (the distribution story).

Key safety properties:

- Draft PRs only; never auto-merge.
- Validation must pass before any PR creation.
- Human approval required for payment, auth/authorization, PII, webhook verification,
  encryption, secrets, and infrastructure changes.
- Validation commands come from a fixed allowlist; AI can never execute commands.
- Every important action writes an append-only `AuditEvent`.

## Connectors

Patchbay ships a **56-connector catalog** of vendor-specific migration knowledge, plus a
declarative SDK for authoring new ones.

**Connector SDK** (`packages/vendor-connectors/src/sdk.ts`): `defineConnector()` turns a
declarative spec (identifiers, change rules, patch suggestions) into a full connector — a
vendor or community member can add their SDK in ~40 lines with no knowledge of the rest of
the codebase. Identifiers support globs (e.g. `@google-cloud/*`).

**Catalog** (`packages/vendor-connectors/src/registry.ts`):

| Group                  | Connectors                                                                                    |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| AI / LLM               | openai, anthropic, gemini, mistral, deepseek, cohere, groq, replicate, langchain, huggingface |
| Cloud & infra          | aws-sdk, google-cloud, azure-sdk, vercel, cloudflare, terraform, kubernetes, digitalocean     |
| Payments               | stripe, paypal, square, plaid, adyen, lemon-squeezy                                           |
| Auth & identity        | auth0, clerk, okta, keycloak, next-auth, passport                                             |
| Messaging & comms      | twilio, slack, sendgrid, discord, telegram, socket.io                                         |
| Data & DB              | prisma, drizzle, typeorm, sequelize, mongodb, mongoose, redis                                 |
| Web frameworks         | express, react, next, vue, trpc                                                               |
| Search & observability | elasticsearch, algolia, sentry                                                                |
| CRM & product          | salesforce, hubspot                                                                           |
| Generic                | generic-openapi (OpenAPI document diffs)                                                      |

Each connector encodes: which raw payloads it understands (`supports`), how a change event
normalizes into typed change rows (`normalizeChange`), and which patch rules apply to affected
usage symbols (`buildPatchSuggestions`). Auth/payment/webhook-sensitive changes are
risk-tagged and produce advisory-only patches requiring human review.

## Local setup

Requirements: Node.js >= 22, pnpm 10, Docker (with Compose).

```bash
git clone <this-repo> && cd patchbay
pnpm install
cp .env.example .env          # defaults work for local development
docker compose up -d          # postgres + redis
pnpm db:generate              # generate Prisma client
pnpm db:migrate               # apply committed migrations
pnpm db:seed                  # seed demo data (idempotent)
pnpm dev                      # web on http://localhost:3000, worker alongside
```

First-time note: `pnpm install` may take a few minutes. If the Docker daemon is not running,
start Docker Desktop first; `docker compose ps` should show both services healthy.

## Environment variables

See `.env.example` for the complete list with comments. Essentials:

| Variable             | Purpose                                                     | Local default            |
| -------------------- | ----------------------------------------------------------- | ------------------------ |
| `DATABASE_URL`       | PostgreSQL                                                  | matches docker-compose   |
| `REDIS_URL`          | Redis                                                       | `redis://localhost:6380` |
| `DEV_AUTH_SECRET`    | signs the dev session cookie — **required** (no default)    | generate one             |
| `DEMO_USER_EMAIL`    | seeded demo admin identity                                  | `demo@patchbay.dev`      |
| `DEMO_USER_PASSWORD` | seeded demo password — **required** for login (no fallback) | set one                  |
| `AI_PROVIDER`        | `mock` (default), `openai`, or `openai-compatible`          | `mock`                   |
| `OPENAI_API_KEY`     | required when `AI_PROVIDER` is not `mock`                   | empty                    |
| `GITHUB_APP_*`       | optional real GitHub integration                            | empty = local provider   |

## Demo

Sign in at `http://localhost:3000/login` (one-click demo user), then open `/demo`:

1. **OpenAI SDK migration** - change event → analysis detects legacy `createChatCompletion`
   → rule-based patch → validation passes → policy allows → local mock draft PR → audit trail.
2. **Auth0 configuration change** - impact detected, plan generated, policy blocks PR creation
   until an admin approves.
3. **Generic OpenAPI response field removed** - diffed from pasted documents, impact assessed,
   plan-only outcome (no patch).
4. **Agent mode ingest** - an ADMIN issues a vendor agent key (shown once, e.g.
   `pb_agent_dev_openai` for the seeded OpenAI vendor), then
   `POST /api/vendors/openai/events` with `Authorization: Bearer <key>` enqueues the same
   analyze pipeline as a manual change; only a sha256 hash of the key is stored.

Full walkthrough with expected outputs: [docs/demo-script.md](docs/demo-script.md).
Reset demo state: `pnpm db:reset` (or the "Reset demo data" action on `/demo`).

## Testing

- `pnpm test` - unit/integration tests (Vitest). Covers analyzer fixtures, rule engine diffs,
  policy gating, sandbox allowlist, audit redaction, AI output validation.
- `pnpm e2e` - Playwright happy-path test for the OpenAI demo flow.

## Safety boundaries (local MVP)

- The bundled sandbox runner is a local development tool, **not** a hardened multi-tenant
  sandbox. It runs allowlisted commands with timeouts and output caps, but does not provide
  kernel-level isolation.
- The dev auth (seeded demo user + signed cookie) is for local development only.
- The mock git provider writes into temporary local workspaces; nothing is pushed anywhere.
- Secrets are redacted from logs, audit events, and AI context.

## Known limitations

- TypeScript/Node + npm manifests only; other ecosystems unsupported.
- Static (repository-folder based) analysis; no live GitHub content analysis in the MVP.
- Connector migration rules encode known breaking changes for each SDK; the vendor-specific
  facts are community-verifiable but not exhaustively validated against every SDK version.
- Change-event and remediation-plan data is org-scoped in code, but the deployment is a single
  tenant; tenant isolation is designed for but not multi-tenant hardened.
- Agent ingest keys are bearer secrets stored only as hashes; key management (rotation,
  revocation UI) is minimal in the MVP.
- Generic OpenAPI connector produces impact mapping and plans only - no patch generation.
- Windows development is supported; sandbox commands run through `cmd.exe /c`.

## Future production requirements

- Real GitHub App auth, real PR creation, permissions-scoped tokens, token rotation.
- Hardened multi-tenant sandbox (container isolation, resource limits, egress control).
- Real auth provider (Clerk/Auth.js/SSO) replacing dev sessions.
- Managed queue/worker deployment, structured logging shipping, audit-log immutability
  (append-only store / WORM), metrics and alerting.
- Full ecosystem coverage (Python, Go, etc.) behind the same interfaces.

See [docs/implementation-plan.md](docs/implementation-plan.md) for phase status and
[docs/threat-model.md](docs/threat-model.md) for the security analysis.
