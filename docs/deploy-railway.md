# Deploying Patchbay on Railway

A founder-sized deployment guide. Everything here is copy-pasteable and every
environment variable below is read by the code (`packages/env`, or documented
in `.env.example`). Two processes run in production, each on its own Railway
service:

| Service  | Process                                          | What it does                                             |
| -------- | ------------------------------------------------ | -------------------------------------------------------- |
| `web`    | `next start` (Next.js, port `PORT`)              | Dashboard, API routes, GitHub webhook                    |
| `worker` | BullMQ consumer (`tsx apps/worker/src/index.ts`) | Queue jobs: scans, analysis, validation, PRs, Watchtower |

Both processes share one Postgres and one Redis. The worker is **never** run
inside the Next.js server.

## Read this first (plain truths)

- **This is not a multi-tenant hardened sandbox.** Validation of customer
  code requires the Docker container runtime. Railway does not give you a
  Docker daemon inside your container, so run with
  `SANDBOX_VALIDATION_MODE=github-checks-only` (recommended below) or don't
  enable validation jobs. `SANDBOX_VALIDATION_MODE=process` is **rejected in
  production** by the code. `hosted-docker` on Railway works **only** if you
  actually run your own containerized worker elsewhere.
- **Sign-in.** In production the password/demo login endpoint returns 404 —
  that is intentional and fail-closed. Without GitHub OAuth keys
  (`GITHUB_CLIENT_ID` + `GITHUB_CLIENT_SECRET` + `NEXTAUTH_SECRET`) there is
  **no way to sign in**. Set those three to get "Continue with GitHub".
- **Billing.** Without `STRIPE_SECRET_KEY` the billing routes return 503 and
  every workspace stays FREE. That is the code's designed behavior.
- **Migrations, not seeds.** The container applies `prisma migrate deploy`
  before the web process starts. Demo credentials (`DEMO_USER_PASSWORD`,
  seed script) are **never** installed in production unless you opt in.
- **GitHub App keys are for real draft PRs + webhooks**; they are separate
  from OAuth sign-in keys above.
- **No fixtures in production.** The image does not ship `fixtures/` (the
  eval-corpus sample repos): connect a real GitHub repository via the GitHub
  App, never local seeded copies.

## Prerequisites

- The repo pushed to GitHub (`git remote add origin <your-repo-url>`).
- A Railway account (free tier is enough to try this).
- A GitHub App if you want webhooks/draft PRs (see Step 4).

## Step 1 — Postgres and Redis

In Railway: **New Project → Create New Project**, then **Create → Database →
PostgreSQL** and **Create → Database → Redis**.

Both plugins inject variables:

- Postgres plugin sets `DATABASE_URL` (used directly by Prisma).
- Redis plugin sets `REDIS_URL` (used directly by BullMQ/ioredis; the code
  also accepts `rediss://` URLs with TLS).

## Step 2 — Two services from one Dockerfile

The repo ships `Dockerfile`, `entrypoint.sh`, `.dockerignore` and
`railway.json`. Create **two services** pointing at the same repo, each with
**Root Directory = `.`** (the repo root). The build picks the process per
service:

- Service **web**: no extra config needed. The entrypoint applies migrations
  and starts `next start`. `RAILWAY_SERVICE_NAME` fallback means a service
  literally named `web` needs nothing else.
- Service **worker**: set **`APP_PROCESS=worker`** in its variables (or name
  the service `worker`). It starts the BullMQ consumer. `APP_PROCESS` is
  authoritative; the container refuses to start on any other value.

If you use `railway up` from the CLI, `railway.json` already pins the
Dockerfile builder and a restart policy. The health check is deliberately
**not** in `railway.json`: that file is shared by both services, and the
worker has no HTTP port to probe (see "Health check" below).

## Step 3 — Variables

Set these on **both** services (they share one queue and one database; the
worker needs the same credentials the web server uses). Every name is a real
name parsed by `packages/env` or read directly by the app.

| Variable                                                 | Value                                              | Notes                                              |
| -------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------- |
| `NODE_ENV`                                               | `production`                                       | Also baked into the image as a fallback.           |
| `DATABASE_URL`                                           | (from Postgres plugin)                             | Prisma; required.                                  |
| `REDIS_URL`                                              | (from Redis plugin)                                | BullMQ; required.                                  |
| `PORT`                                                   | (Railway sets it)                                  | Web listens on this.                               |
| `APP_PROCESS`                                            | `worker`                                           | Only on the worker service.                        |
| `NEXTAUTH_URL`                                           | `https://<your-web>.up.railway.app`                | OAuth redirect target.                             |
| `NEXTAUTH_SECRET`                                        | `openssl rand -base64 32`                          | Session signing.                                   |
| `GITHUB_CLIENT_ID`                                       | GitHub OAuth App client id                         | Both-or-neither with the secret.                   |
| `GITHUB_CLIENT_SECRET`                                   | GitHub OAuth App secret                            | Enables "Continue with GitHub".                    |
| `GITHUB_APP_ID`                                          | GitHub App id                                      | App id of your GitHub App.                         |
| `GITHUB_APP_PRIVATE_KEY`                                 | PEM, **base64-encoded single line**                | `base64 -w0 <pem>` — never paste the raw PEM.      |
| `GITHUB_APP_WEBHOOK_SECRET`                              | long random string                                 | HMAC verification of webhooks.                     |
| `GITHUB_APP_SLUG`                                        | e.g. `patchbay-prod`                               | Used for the "Install" link on `/settings/github`. |
| `SANDBOX_VALIDATION_MODE`                                | `github-checks-only`                               | Recommended — see Step 5.                          |
| `AI_PROVIDER`                                            | `mock` (default) or `openai` / `openai-compatible` | `mock` needs no credentials.                       |
| `OPENAI_API_KEY`                                         | (optional)                                         | Required if `AI_PROVIDER` is not `mock`.           |
| `STRIPE_SECRET_KEY`                                      | (optional)                                         | Unset ⇒ billing 503, plans stay FREE.              |
| `STRIPE_WEBHOOK_SECRET`                                  | (optional)                                         | Stripe webhook signing secret.                     |
| `STRIPE_PRICE_PRO_MONTHLY` / `STRIPE_PRICE_TEAM_MONTHLY` | (optional)                                         | Price ids.                                         |
| `EVIDENCE_STORE_DIR`                                     | `/data/evidence`                                   | Point at a Railway volume (see Step 6).            |
| `WATCHTOWER_POLLING_ENABLED`                             | `true` (default)                                   | Watchtower release polling.                        |
| `SANDBOX_TIMEOUT_MS`, `SANDBOX_MAX_OUTPUT_CHARS`         | optional                                           | Defaults are fine.                                 |
| `TRUSTED_PROXY_CIDRS`                                    | (optional, empty default)                          | Only trust `x-forwarded-for` from these CIDRs.     |

Explicitly **not** set: `DEV_AUTH_SECRET`, `DEMO_USER_EMAIL`,
`DEMO_USER_PASSWORD` — dev-only, ignored in production (and the password
login route 404s there).

## Step 4 — GitHub App (webhooks + real draft PRs)

1. Create a GitHub App (Settings → Developer settings → GitHub Apps → New).
2. Webhook URL: **`https://<your-web>.up.railway.app/api/webhooks/github`**
   (this exact route exists in the repo: `apps/web/src/app/api/webhooks/github/route.ts`).
3. Webhook secret: paste the same value you put in `GITHUB_APP_WEBHOOK_SECRET`.
4. Permissions — request exactly these (they match
   `docs/github-app-listing.md` and `packages/git-provider`):
   - **Contents: Read and write** (read files, create branches, write patched
     files into the draft-PR branch).
   - **Pull requests: Read and write** (create **draft** PRs).
   - **Metadata: Read** (required for any installation).
   - **No Checks API permission** — Patchbay has no code path that creates
     check runs.
5. Webhook events — subscribe to exactly **`installation`**, **`pull_request`**,
   and **`push`**. Any other event is acknowledged and ignored by the code.
6. Put the App id, slug, and the **base64-encoded** private key in the
   variables from Step 3.
7. Install the App on your organization/repo. Watch `GITHUB_APP_SLUG`
   render the install link on `/settings/github`.

`GITHUB_APP_ID` + `GITHUB_APP_PRIVATE_KEY` switch PR creation from local mock
PRs to real GitHub draft PRs, and enable webhook ingestion. They must be set
together (the env schema fails otherwise).

## Step 5 — Validation mode (read carefully)

Railway containers have no Docker daemon, so the hardened container sandbox
(`SANDBOX_RUNTIME=container`) cannot run here. The code is fail-closed:

- `SANDBOX_VALIDATION_MODE=process` → **rejected** in production at worker
  boot and at validation time.
- `SANDBOX_VALIDATION_MODE=hosted-docker` (the default) → the worker
  **refuses to start** when the container runtime is unavailable.
- `SANDBOX_VALIDATION_MODE=github-checks-only` → Patchbay **never executes
  customer code on this host**. Validation runs are recorded as **SKIPPED,
  never PASSED**, and the customer's GitHub CI is the validation sandbox.
  Draft PRs still require the policy gates.

For Railway: set `SANDBOX_VALIDATION_MODE=github-checks-only` on the worker.
If you need `hosted-docker`, run the worker on infrastructure that actually
has a Docker daemon (not Railway's runtime) — the image is just a Node
process, so it can run anywhere with the same variables.

## Step 6 — Volumes, scale, ops

- **Evidence store**: default is `./data/evidence` under the repo root,
  which is ephemeral in a container. Add a Railway volume mounted at
  `/data` and set `EVIDENCE_STORE_DIR=/data/evidence`.
- **Scale**: keep **one replica** of each service. Migrations run on the web
  service start (Prisma's `migrate deploy` is advisory-locked, but a single
  replica avoids racing it).
- **Health check**: `railway.json` deliberately ships **no** health check —
  it is shared by both services and the worker has no HTTP port, so a
  shared healthcheck would kill the worker. Railway applies
  `railway.json` to every service in the repo, so per-service overrides of
  the file are not possible; set it per service in the dashboard:
  - **web service**: Deploy → Health Check Path = `/` (any 2xx/3xx counts
    as healthy).
  - **worker service**: leave the HTTP health check **disabled** (no port).
    Its signal is the log line `"patchbay-worker starting"` and a green
    deploy.
- **Redis as cache**: all queue state lives in Redis; if you ever change the
  Redis plugin, both services must point at the same instance.
- **Secrets**: Railway variables are fine; never commit `.env`. The repo's
  `.gitignore` already excludes it.

## First-run sanity checklist

1. Both services deploy green (web + worker logs show clean boots).
2. `https://<web>/` loads and redirects to login.
3. Sign in with "Continue with GitHub" (OAuth keys set in Step 3).
4. GitHub App webhook delivery shows `200` in the App's recent deliveries.
5. Worker logs show `redis connection ok`.

## Render appendix (not Railway)

The same image and entrypoint run on Render (Docker runtime):

- Create two **Web Services** (not Background Workers — a Background Worker
  cannot use the Docker runtime) from the same repo.
- Both: **Docker** runtime, root directory `.`, then the variables from
  Step 3.
- Set `APP_PROCESS=worker` on the worker service.
- Render provides `PORT` automatically; add `NODE_ENV=production`.
- Add a disk mount at `/data` and `EVIDENCE_STORE_DIR=/data/evidence`.
- Health check path: `/` on the web service.
- Same validation-mode guidance as Step 5: `github-checks-only` unless you
  have real container infrastructure for the worker.

One caveat that applies everywhere: without GitHub OAuth keys there is no
login, and without Stripe keys there is no billing — the app is designed to
fail closed on both.
