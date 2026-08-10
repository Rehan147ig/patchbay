# Patchbay — Development Ledger

Status as of this commit. Everything under **DONE** is implemented, tested, and
passing (`pnpm typecheck`, `pnpm lint`, `pnpm test` = 260 tests). Everything
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

## PENDING (needs money / credentials / infra)

### Critical path (the product is not sellable without these)

- [ ] **GitHub App depth** — check runs, review comments, commit signing, PR merge (policy-gated),
      token rotation/revocation UI.
      (Install flow, webhooks, draft PRs, and OAuth sign-in are DONE — see above.)
- [ ] **Sandbox hardening** — container/microVM isolation per validation run,
      network egress control, resource limits. Current code explicitly says
      "NOT a hardened multi-tenant sandbox".
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
