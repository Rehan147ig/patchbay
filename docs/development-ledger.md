# Patchbay — Development Ledger

Status as of this commit. Everything under **DONE** is implemented, tested, and
passing (`pnpm typecheck`, `pnpm lint`, `pnpm test` = 245 tests). Everything
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

### CI / supply chain

- `ci.yml` actions pinned to verified commit SHAs.
- `deepsec.yml` PR-review workflow (NIM route via Pi agent, pinned actions).

## PENDING (needs money / credentials / infra)

### Critical path (the product is not sellable without these)

- [ ] **Real GitHub App** — install flow, webhooks (push/PR/release), check
      runs, review comments, real draft PRs, commit signing.
      (`packages/git-provider/src/github-provider.ts` is a scaffold.)
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

1. Real GitHub App + real auth → pilot with 1–2 orgs.
2. Sandbox hardening → unblocks enterprise + auto-merge.
3. AI-generated patches + feedback loop → the differentiator.
4. Slack + SARIF + webhooks → cheap, high-perception integrations.
5. Connector marketplace + AI-generated connectors → the moat.
6. Open-core the scanner, sell the platform.
