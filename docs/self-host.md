# Self-hosting Patchbay (one organization)

This guide gets a technical founder running Patchbay for a single
organization, from an empty machine to a draft pull request. Every command,
port, and environment variable below was verified against `docker-compose.yml`,
`.env.example`, and `AGENTS.md` in this repository. If something disagrees with
those files, the code wins.

## 0. Prerequisites

- Node.js >= 22.0.0 with pnpm (per `package.json` engines; `corepack enable` or `npm i -g pnpm`)
- Docker with the compose plugin (for Postgres and Redis)
- One TypeScript repository that uses a DRAFT_PR-certified SDK
  (`openai`, `stripe`, `twilio`, `anthropic`, `aws-sdk`, or `supabase`)

```bash
git clone <this-repo> patchbay
cd patchbay
pnpm install
```

## 1. Postgres + Redis

```bash
docker compose up -d
```

`docker-compose.yml` starts exactly two services:

| Service     | Container name      | Host port | Container port | Credentials (dev only)                                       |
| ----------- | ------------------- | --------- | -------------- | ------------------------------------------------------------ |
| Postgres 16 | `patchbay-postgres` | **5434**  | 5432           | user `patchbay`, password `patchbay_dev_only`, db `patchbay` |
| Redis 7     | `patchbay-redis`    | **6380**  | 6379           | none                                                         |

Both ports are deliberately off the defaults so they don't clash with other
local stacks. The ports above must match your `DATABASE_URL` and `REDIS_URL`
(they do, if you copy `.env.example`).

## 2. Environment

```bash
copy .env.example .env   # Windows
# or: cp .env.example .env   # macOS/Linux
```

Required values:

```env
DATABASE_URL="postgresql://patchbay:patchbay_dev_only@localhost:5434/patchbay?schema=public"
REDIS_URL="redis://localhost:6380"
NODE_ENV=development
PORT=3000
DEV_AUTH_SECRET=<at least 32 characters>
DEMO_USER_EMAIL=demo@patchbay.dev
DEMO_USER_PASSWORD=dev-only
```

`DEV_AUTH_SECRET` is **required** outside production — session cookies are
HMAC-signed with it and login refuses to start without it. Generate one:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

`DEMO_USER_*` is the identity the seed script creates; `AI_PROVIDER=mock` is
the default and needs no credentials (the deterministic mock is fine for
self-hosting — everything below works with it).

### Git integration: choose one mode

| Mode                         | Env vars                                                                                  | What you get                                                                                     |
| ---------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **GitHub App** (recommended) | `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_WEBHOOK_SECRET`, `GITHUB_APP_SLUG` | Per-organization installs, exact-HEAD checkouts of your repos, real draft PRs, webhook ingestion |
| **PAT fallback**             | `GITHUB_TOKEN`, `GITHUB_REPOSITORY=owner/repo`                                            | Real draft PRs on that single repository (superseded by the App mode)                            |
| **None**                     | —                                                                                         | Offline demo: patches applied to the local `fixtures/repositories` copies, no GitHub calls       |

`GITHUB_APP_PRIVATE_KEY` is your GitHub App's PEM file **base64-encoded onto a
single line**. `GITHUB_APP_SLUG` is the public slug from the app's GitHub
settings URL (used to build the install link).

### Sandbox (validation) settings

```env
SANDBOX_TIMEOUT_MS=120000
SANDBOX_MAX_OUTPUT_CHARS=20000
SANDBOX_MODE=development          # development | test | production
SANDBOX_RUNTIME=process           # process (default) | container
SANDBOX_VALIDATION_MODE=hosted-docker
```

Honest summary of what each does (details in `.env.example`):

- `SANDBOX_VALIDATION_MODE=hosted-docker` (default) — validation commands run
  in the container sandbox. In production the worker refuses to start if the
  container runtime is unavailable (fail-closed).
- `SANDBOX_VALIDATION_MODE=github-checks-only` — Patchbay **never executes
  customer code on your host**. Validation runs are recorded as `SKIPPED`,
  which is **never** reported as `PASSED`; your CI (GitHub checks) is the
  sandbox. No container required.
- `SANDBOX_VALIDATION_MODE=process` — commands execute on the host; **local
  development only, rejected in production**. Not a multi-tenant sandbox.

## 3. Database

```bash
pnpm db:generate   # prisma generate
pnpm db:migrate    # apply committed migrations
pnpm db:seed       # idempotent demo data: organization, demo user,
                   # vendor catalog, and 4 fixture repositories with usages
```

The seed registers fixture repositories that already contain tracked usages:

- `billing-service` → Stripe
- `ai-assistant-service` → OpenAI
- `notification-service` → Twilio
- `auth-gateway` → Auth0 (plan-only; no patches)
- `claude-assistant-service` → Anthropic
- `aws-workers-service` → AWS SDK
- `supabase-backend-service` → Supabase

## 4. Run

```bash
pnpm dev
```

Starts both processes concurrently: web at **http://localhost:3000** and the
BullMQ worker (scan, analyze, plan, PR creation). Sign in with
`demo@patchbay.dev` / `dev-only`.

## 5. GitHub App install (for real draft PRs)

1. Create the app: GitHub → Settings → Developer settings → GitHub Apps →
   New GitHub App.
2. **Webhook URL:** `https://<your-public-host>/api/webhooks/github`
   (exact path; behind a reverse proxy for HTTPS).
3. **Webhook secret:** any long random string — put the same value in
   `GITHUB_APP_WEBHOOK_SECRET`.
4. **Permissions (least privilege):** Contents — Read & write; Pull
   requests — Read & write; Metadata — Read. Nothing else (no checks, no
   merges, no issues). Full rationale in `docs/github-app-listing.md`.
5. **Webhook events:** subscribe to `installation`, `pull_request`, `push`.
6. Generate a private key, download the PEM, base64-encode it into
   `GITHUB_APP_PRIVATE_KEY`.
7. Restart `pnpm dev`, then in the UI: `/settings/github` → **Install** →
   pick your organization/repository. The callback binds the installation to
   your signed-in user's organization.
8. `/repositories` → **Connect repository** (choose the installation and the
   repo). Then open the repository page and run **Scan** — the worker checks
   out default-branch HEAD through the installation token, replaces the usage
   inventory, and builds the graph snapshot.

Agent runs (analyst → planner → reviewer) only ever read release facts and
usage graphs from Patchbay's own database and the local fixture checkout —
they never hold GitHub tokens or credentials. Git access lives exclusively in
the git-provider layer: the GitHub App's installation access token is minted
server-side by the App itself (App JWT + installation token, scoped to the
installed repositories) and is used only to open draft PRs and check out
code; agents propose, the App opens the draft, and a human merges.

## 6. Get a draft PR (certified Node/TS kits only)

Patches are produced only for DRAFT_PR-certified Node/TypeScript
connectors: `openai`, `stripe`, `twilio`, `anthropic`, `aws-sdk`,
`supabase`. Everything else (Auth0, OpenAPI, Python) stops at assessment
or plan — no PR.

**Option A — offline demo (no GitHub needed, guaranteed path):** on the
`/demo` page run the `openai-migration` (or `stripe-metadata`) scenario. It
creates a change event against the fixture repositories and enqueues
`ANALYZE_CHANGE`:

1. Navigate to the change event at `/changes/:id` → click **Generate plan**
   (or from `/releases` click **Plan remediation**). This creates the remediation
   plan and navigates to `/remediations/:id`.
2. On `/remediations/:id` → if the change touches payments (e.g. Stripe) or
   requires approval, click **Approve** (approval is recorded and audited before
   PR creation).
3. Click **Open draft PR** → the `CREATE_PR` job validates the patch against the
   allowlist and creates the local mock draft PR. It is a **draft only — never
   auto-merged**.

**Option B — real GitHub repo:** after step 5 (install → connect → scan),
create a change event for the vendor (use the matching demo scenario or the
agent ingest endpoint, `POST /api/vendors/:slug/events` with a `pb_agent_*`
key issued from Settings), then repeat steps 1–3 above. Because the repository
was connected through the GitHub App, the draft PR opens on GitHub itself via
the installation token — still draft-only, still never merged.

## 7. Backup and restore

Back up the Postgres volume with `docker compose exec postgres pg_dump -U
patchbay -d patchbay > patchbay-backup.sql` (the Redis volume only holds queue
state and is safe to lose). To restore on a fresh install, start Postgres,
run `docker compose exec -T postgres psql -U patchbay -d patchbay <
patchbay-backup.sql`, then run `pnpm db:migrate` to catch up any schema
changes. Point-in-time recovery, multi-instance replication, and zero-downtime
migrations are outside this guide's scope.

## 8. What self-hosting does NOT give you

- **No hardened multi-tenant sandbox.** The local sandbox runner is not a
  hardened sandbox: `process` mode executes commands on your host and is
  rejected in production; production requires `SANDBOX_RUNTIME=container`.
  This deployment is for one organization on infrastructure you trust.
- **`github-checks-only` is not "passing".** In that mode Patchbay never runs
  your code and records validation as `SKIPPED` — never `PASSED`. Treat
  "skipped" as "unvalidated by Patchbay", and let your CI be the judge.
- **No SSO, no multi-tenant auth, no billing.** Auth is the dev session
  cookie; billing routes 503 unless you configure Stripe keys.
- **Six certified patch kits.** `openai`, `stripe`, `twilio`, `anthropic`,
  `aws-sdk`, `supabase` produce patches. The catalog is 50+ connectors but
  everything else — including all Python — is detect/assess only. Catalog
  presence is not an auto-fix.
- **No auto-merging, ever.** Patchbay only opens drafts and tracks their
  lifecycle via webhooks; a human merges.
- **No Firecracker-based isolation, no Kubernetes operator, no HA failover.**
  One Postgres, one Redis, one worker.
