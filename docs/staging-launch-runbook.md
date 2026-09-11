# Staging Launch Runbook

Staging is the dress rehearsal for pilot: same code, same gates, isolated
data. Companion docs: `pilot-readiness.md` (trust/subprocessors),
`restore-evidence.md` (rehearsal log), `kms-rotation-drill.md`,
`production-readiness-report.md` (gate evidence), `self-host.md`.

## 1. Environment separation

| Concern                | dev                 | staging                                          | production                 |
| ---------------------- | ------------------- | ------------------------------------------------ | -------------------------- |
| Database               | local Postgres 5434 | **separate** Postgres instance/DB                | managed Postgres + PITR    |
| Redis                  | local 6380          | **separate** Redis instance                      | managed Redis              |
| GitHub App             | —                   | **separate staging App** (own ID/key/slug)       | separate prod App          |
| Webhook secret         | dev-only            | **unique per env** (`GITHUB_APP_WEBHOOK_SECRET`) | unique per env             |
| KEKs (`PATCHBAY_KEK*`) | dev-only            | **unique per env**, offline backup               | managed KMS/secret manager |
| Callback URLs          | `localhost:3000`    | staging origin                                   | prod origin                |
| AI provider            | `mock`              | `mock` unless testing a provider                 | operator choice            |

Rule: no production secret or callback is ever usable in staging. Verify by
inspection before every rehearsal (`printenv | grep -iE 'prod|live'` must show
nothing staging-adjacent; staging values must differ from prod values).

## 2. Required environment variables (staging)

```bash
NODE_ENV=production
PORT=3000
DATABASE_URL="postgresql://patchbay:<staging-password>@<staging-pg-host>:5432/patchbay?schema=public"
REDIS_URL="redis://:<staging-password>@<staging-redis-host>:6379"
DEV_AUTH_SECRET=<32+ random hex>            # node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
NEXTAUTH_SECRET=<32+ random hex>
DEMO_USER_EMAIL=demo@patchbay.dev
DEMO_USER_PASSWORD=<staging-only password>  # enables E2E demo login
AI_PROVIDER=mock
SANDBOX_VALIDATION_MODE=github-checks-only  # staging default: never execute customer code
SANDBOX_MODE=production
GITHUB_APP_ID=<staging app id>
GITHUB_APP_PRIVATE_KEY=<staging base64 PEM>
GITHUB_APP_SLUG=<staging-app-slug>
GITHUB_APP_WEBHOOK_SECRET=<staging-only secret>
EVIDENCE_STORE_DIR=/var/patchbay/evidence
ALERT_WEBHOOK_URL=<paging webhook>          # DLQ pages loudly; unset = log only
```

## 3. Secret / KMS setup

1. Generate KEKs: `openssl rand -base64 32` → `PATCHBAY_KEK` (+ kid
   `PATCHBAY_KEK_KID`); keep PREVIOUS pair only during a rotation window.
2. Back up KEKs **offline, twice**. KEK loss is unrecoverable: sealed values
   (`SecretStore` envelopes, `ContractSource.configEncrypted`) can never open
   again.
3. Rotation + emergency revocation: `docs/kms-rotation-drill.md`. Agent-key
   rotation is per-org enrollment (`POST /api/vendors/:slug/agent-key`
   re-issue moves current→previous); revocation clears both hashes and flips
   the enrollment to `REVOKED`.
4. Never commit secrets: Gitleaks runs in CI (`Secret scan` job, required).

## 4. PostgreSQL: migrate, backup, restore

```bash
pnpm install --frozen-lockfile
pnpm db:generate
pnpm --filter @patchbay/db exec prisma migrate deploy   # append-only; RLS policies + WORM trigger ship with schema
pnpm db:seed                                             # idempotent demo data (staging only, never prod customer data)

# Backup (nightly minimum for staging; Postgres 15+):
pg_dump "$DATABASE_URL" -F custom -f "patchbay-$(date +%F).dump"

# Restore rehearsal (fresh target, quarterly + before pilot GA):
createdb patchbay_restore
pg_restore -d patchbay_restore patchbay-<date>.dump
DATABASE_URL="<restore-url>" pnpm --filter @patchbay/db exec prisma migrate deploy  # must be a no-op at latest
psql "<restore-url>" -c 'select count(*) from "Organization";'  # row counts must match source
# Then boot the app against the restored DB and run §6 smoke tests.
# Record timestamp, duration (RTO), and row-count diffs in docs/restore-evidence.md.
```

RLS note: policies ride with the schema, but the app role must be
non-superuser (superusers bypass RLS even with FORCE) — see negative suite
`packages/db/src/rls-tenant-isolation.test.ts`.

## 5. Redis setup

Managed Redis 7+ with password (`REDIS_URL` with credentials, loopback or
private network only). No backup needed: queues, PR slots, concurrency
counters, and heartbeats are ephemeral — in-flight jobs retry via BullMQ on
restart. Verify: `redis-cli -u "$REDIS_URL" ping` → `PONG`.

## 6. Evidence-store configuration

`EVIDENCE_STORE_DIR` on durable storage (same backup window as Postgres;
content-addressed objects are immutable and deduplicated). Snapshot it with
every DB dump — a restored DB whose hashes no longer resolve has attestation
gaps. Verify: pick a `ValidationArtifact.stdoutUri` and `readRawEvidence`
round-trips (the WP13 drill asserts exactly this).

## 7. GitHub App setup + webhook verification

1. Create the **staging** App (separate from prod): Contents + Pull requests
   (read/write), Metadata (read); webhook URL → staging `/api/webhooks/github`.
2. Install into the test organization; confirm installation appears in
   `/settings/github` and `GET /api/github/installations/[id]/repositories`.
3. Verify signature path: send a signed `ping` (HMAC-SHA256 over raw body with
   the staging webhook secret) → 200 received; resend identical
   `x-github-delivery` → `duplicate: true`; corrupt one signature byte → 401.
4. Uninstall cleanup: removing the installation must suspend sync without
   orphaning tenant data (verify org rows remain, installation row suspended).

## 8. Health / readiness / liveness

| Probe                                | Expects                                               | On failure                                          |
| ------------------------------------ | ----------------------------------------------------- | --------------------------------------------------- |
| `GET /api/health/live`               | 200 `{status:"ok"}` — no DB/Redis touch               | Process is down; orchestrator restarts              |
| `GET /api/health`                    | 200 ok, or 503 `degraded` with per-dependency flags   | Stop routing traffic; dependency (not app) is down  |
| `GET /api/operations/queues` (ADMIN) | `workers[]` has a fresh heartbeat; DLQ counts visible | Start/repair worker; triage dead letters via Replay |

## 9. Seed data (staging only)

`pnpm db:seed` → 1 org, 9 vendors, 8 repos, 4 contract sources, 6 lifecycle
cases, 13 outcomes, 7 gates, 1 validation profile. Secret scan of `seed.ts`
must stay clean (no tokens/keys — dev agent key is a hash of a documented
dev-only value). Never seed demo data into production.

## 10. Smoke tests (post-deploy, in order)

```bash
pnpm verify:lockfile && pnpm verify:capability-matrix && pnpm format:check && pnpm lint && pnpm typecheck
pnpm test:corpus                                   # 36/36 certification gate
E2E_STAGING=1 E2E_WEBHOOK_SECRET=<staging secret> \
E2E_DEMO_EMAIL=demo@patchbay.dev E2E_DEMO_PASSWORD=<staging password> \
  pnpm exec playwright test staging-golden-path --project=chromium
```

Golden path asserts one correlation ID across: demo login → agent-key issue →
signed agent event → demo change → analysis → plan → validation → second-human
approval → draft PR artifact → check_run ingest → audit export → dashboard
states; plus duplicate-delivery, invalid-signature, logged-out-401, and
VIEWER-403 negatives. Without `E2E_STAGING=1` the spec SKIPS with setup
instructions instead of passing vacuously.

## 11. Rollback

- **App**: redeploy the previous image/commit; migrations are append-only, so
  old code runs against the migrated schema (new nullable columns/tables are
  ignored by old code).
- **Migration rollback notes**: `20260907000000_vendor_enrollment` — `DROP
TABLE "OrganizationVendorEnrollment"`; legacy `Vendor.agentKeyHash*`
  columns were left in place precisely so reverted code keeps serving;
  enrollments created after migrate are orphaned and keys must be re-issued.
- **Data**: restore from the latest verified dump (§4); evidence dir from the
  same window; KEKs from offline backup (never from the dump).

## 12. Incident response

1. **Kill switch**: Operations → capability gate → Suspend (ADMIN), or
   `POST /api/capability-gates`; suspended gates fail PR/validation enqueue
   closed until restored. Audit shows who/when/why.
2. **Dead letters**: Operations → Replay (freshness-guarded, single-winner);
   `POST /api/operations/replay`. Correlate via dead-letter correlation ID →
   worker logs → traces → audit export.
3. **Queue saturation / worker loss**: `/api/operations/queues` (depth, DLQ,
   heartbeats, outcome mirror); restart worker; jobs retry via BullMQ.
4. **Key compromise**: rotate agent keys per enrollment (previous-key window
   keeps agents alive); KEK compromise follows `kms-rotation-drill.md`;
   record `reason:key_compromise` audit events.
5. **On-call**: assign an owner before pilot; route `ALERT_WEBHOOK_URL` to
   paging (Slack/PagerDuty); review DLQ every business day during pilot.

## 13. DLQ replay, deletion & retention

- Replay: authorized, freshness-checked (`run still QUEUED/RUNNING/FAILED`,
  plan has no PR, repo ACTIVE), idempotent (`replay:<deadLetterId>` job id +
  OPEN→REPLAYED conditional claim).
- Deletion: tenant data deletes cascade off `Organization`; audit rows are
  WORM (append-only by trigger — deletion requires the break-glass procedure
  in `worm-db.test.ts`, never an API).
- Retention: validation artifacts 90d (`VALIDATION_ARTIFACT_RETENTION_DAYS`,
  shared log objects survive while referenced), agent payloads 90d, graph
  snapshots latest-5 + 24h incomplete, monthly delivery quotas per plan tier.

## 14. Go / no-go criteria (pilot)

| Check                                           | Pass                                           | Fail                                    | Not run                                      |
| ----------------------------------------------- | ---------------------------------------------- | --------------------------------------- | -------------------------------------------- |
| Gates (format/lint/typecheck/test/corpus/build) | all exit 0                                     | any red → fix, no waiver                | infra missing → record as skip, rerun        |
| Live DB suites (RLS, WORM, drills, enrollment)  | green against staging PG                       | red → block                             | no PG → block (not a skip)                   |
| E2E golden path                                 | traceable draft PR + evidence, negatives green | any unexplained red → block             | worker/sandbox absent → explicit skip, rerun |
| Restore rehearsal                               | RTO recorded, row counts match                 | untested → block GA (pilot may proceed) | —                                            |
| Secrets audit                                   | per-env separation verified, scans green       | any prod-in-staging → block             | —                                            |
| Browser pass                                    | wizard + 8 views clicked                       | —                                       | not run → block GA (pilot may proceed)       |

**Go for controlled staging/design-partner testing** when all Pass/Fail rows
above are Pass (skips only where the table allows). **No-go for unrestricted
production or public launch** until GA residuals close (see
`production-readiness-report.md` §7).
