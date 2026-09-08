# Staging Golden-Path Evidence — release verification

- **Commit SHA tested:** `a3cf93e` (`feat/production-hardening`), plus uncommitted
  working-tree test fixes listed under §5 (verification ran WITH them; see §6).
- **Environment classification:** local (Windows 11, Node v22.12.0, pnpm 10.34.5,
  Docker Desktop backend for port relay; `AI_PROVIDER` unset → mock).
- **Migration version applied:** 49/49, latest `20260908000000_repository_snapshot`
  applied live via `prisma migrate deploy` during this run (was the single
  pending migration; `migrate status` confirmed 48 pre-applied).
- **Real vs mocked:** §1 gates are mock/FS-backed unit proof except where noted;
  §2 PG drills ran against a REAL PostgreSQL 15 container (no mocks). Redis
  drills are BLOCKED (host Docker daemon wedged — §4). No staging GitHub App,
  org, or secrets exist anywhere in this run — nothing was faked.

## 1. Local release gates (Phase 1)

| Command                                              | Result                                                                                              |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `pnpm db:generate`                                   | PASS                                                                                                |
| `pnpm verify:lockfile` (`install --frozen-lockfile`) | PASS (up to date)                                                                                   |
| `pnpm verify:capability-matrix`                      | PASS (`Capability matrix check: OK`)                                                                |
| `pnpm format:check`                                  | PASS                                                                                                |
| `pnpm lint` (`--max-warnings 0`)                     | PASS                                                                                                |
| `pnpm typecheck` (20/20 workspace projects)          | PASS                                                                                                |
| `pnpm test` (full suite)                             | 1638 passed / 4 failed / 27 skipped — see §5 for the 4 (all resolved below, no production change)   |
| `pnpm test:corpus` (standalone re-run)               | PASS 36/36 (122s)                                                                                   |
| `pnpm build` (Next.js 16.3.2, 100+ routes)           | PASS (3 pre-existing Turbopack tracing warnings in `repo-analysis/lockfile.ts`, informational only) |

Full-suite failure analysis (all root-caused, none waived):

- 3× `apps/worker/src/jobs/agent-plan.test.ts` — genuine gap exposed by the
  `a3cf93e` snapshot preamble: `resolveExpectedCommitSha`
  (`apps/worker/src/jobs/agent-plan.ts:373`) touches `prisma.graphSnapshot`,
  absent from the test's prisma mock → `TypeError: Cannot read properties of
undefined (reading 'findFirst'/'findUnique')`. Fixed by extending the mock
  (graphSnapshot/repositorySnapshot/gitHubInstallation delegates + real temp
  fixture dir) and migrating the tests to the intended fail-closed contract,
  plus 1 new regression test. Re-run: **4/4 PASS** (incl. new
  `SNAPSHOT_UNAVAILABLE $0-spend` test).
- 1× `eval-corpus` coverage gate — `Test timed out in 30000ms`
  (`checkCertifiedPatchCoverage`, `eval-corpus.test.ts:175`) under full-suite
  parallel load (corpus+engine+semantic suites run concurrently). Standalone
  re-run on the same HEAD: **36/36 PASS**, coverage gate 28.7s (just under the
  30s per-test limit). Load contention, not a code defect; no production or
  test file changed for it.

## 2. Live PostgreSQL 15 + Redis 7 proof (Phase 2)

Docker services per `docker-compose.yml`: `db` (postgres:15-alpine, host 5434),
`redis` (redis:7-alpine, host 6380, requirepass). Env via
`npx dotenv -e .env` (+ `REDIS_URL=redis://:patchbay_dev_only@127.0.0.1:6380`
override file for Redis suites — `.env` carries no Redis password).

| Check                                                                           | Result                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prisma migrate deploy` (49/49 incl. snapshot migration)                        | PASS (applied live this run)                                                                                                                                                                                                                                                                                                                                     |
| Migration artifact proof (pg_catalog query)                                     | PASS — table `RepositorySnapshot`; RLS enabled+FORCED; policy `RepositorySnapshot_tenant_isolation`; 7 indexes (pkey, unique repo+sha, 3 composite, expires, graph); 4 `repositorySnapshotId` columns + inbound FKs on AgentRun/PatchArtifact/RemediationAttempt/ValidationRun; 3 outbound FKs; `_prisma_migrations` head = `20260908000000_repository_snapshot` |
| `pnpm db:seed` (idempotent demo data)                                           | PASS (org-acme, 9 vendors, 8 repos, 6 cases, 13 outcomes, 7 gates)                                                                                                                                                                                                                                                                                               |
| `wp13-drills.test.ts` (real PG)                                                 | PASS 3/3 (full loop, duplicate invariance, kill switch)                                                                                                                                                                                                                                                                                                          |
| `rls-tenant-isolation.test.ts` (real PG, NOSUPERUSER `patchbay_rls_probe` role) | PASS 4/4 — incl. “covers every organization-owned table”, which now covers the new `RepositorySnapshot` table                                                                                                                                                                                                                                                    |
| `worm-db.test.ts` (real PG)                                                     | PASS 4/4 (UPDATE/DELETE rejected, wipe rolls back, history intact)                                                                                                                                                                                                                                                                                               |
| `test:redis-integration` (conformance + PR-slot, real Redis 7)                  | **BLOCKED** — see §4                                                                                                                                                                                                                                                                                                                                             |

## 3. Snapshot security regression proof (Phase 3) — 64/64

One consolidated run, 7 files, **64 passed / 0 failed** (mock/FS-backed unit
proof, no network):
`snapshot.test.ts` 6 · `snapshot-binding.test.ts` 7 · `error-safety.test.ts` 3 ·
`repository-snapshot.test.ts` 10 · `agent-workflow.test.ts` 8 ·
`agent-plan.test.ts` 4 · `policy.test.ts` 26.

1. **A→B pinning:** `buildSnapshotForRepository` throws `SnapshotUnavailableError`
   without `expectedCommitSha` (no HEAD fallback, zero checkout); injected-provider
   test proves checkout receives the ANALYZED sha while `resolveHeadSha` reports
   the advanced head (`checkedOut == [analyzedSha]`, never the advanced SHA).
2. **Anchors:** zero matches → stale-throw; default single match → applies;
   3 matches with default → `matches 3 locations; expected exactly 1`; explicit
   `expectedOccurrences: 3` → exactly 3 deterministic replacements; wrong count
   declaration → throws. No artifact/PR on any failure path.
3. **Unavailable/oversized:** `agent-plan.test.ts` proves the pre-model
   `SNAPSHOT_UNAVAILABLE` path — job returns normally, `agentStep.create` never
   called ($0 spend), attempt `SKIPPED/SNAPSHOT_UNAVAILABLE`, run `FAILED` with
   `costEstimateCents: 0`, case → `PLAN_ONLY`. Zero-edit → `PLAN_ONLY`, partial
   invalidation → `INVALIDATED` (never `PATCH_PROPOSED`).
4. **Expired:** checkout of past-`expiresAt` rows throws (marks `EXPIRED`
   best-effort, no patch/PR); `expireRepositorySnapshots()` flips past-due
   `READY` → `EXPIRED` (wired into the 6h retention sweep in
   `apps/worker/src/index.ts`).

## 4. Blockers (exact reproduction)

**B1 — Redis 7 container wedged; Docker daemon control plane wedged (BLOCKS Redis drills + any staging boot).**

- `docker ps` → hangs >120s (tried twice). `docker compose up -d db redis` →
  hangs >240s (only the `version is obsolete` warning prints). `docker restart
patchbay-redis` → hangs >150s.
- `netstat -ano | findstr "6380 5434"` → listeners held by `com.docker.backend.exe`
  (PID 15616) + `wslrelay.exe` (PID 4728): Docker Desktop's relay is alive, but
  the Redis container behind it accepts TCP and never answers the handshake
  (bare ioredis `connect()`+`ping()` with 8s race → `connect TIMEOUT`, with and
  without password; a wrong password would fail fast with WRONGPASS, so the
  process is wedged, not misconfigured). PG behind the same relay answers
  normally — the failure is Redis-container-specific plus a wedged daemon.
- Recovery (operator, host-level, no repo change): restart Docker Desktop →
  `docker compose up -d db redis` → `redis-cli -a patchbay_dev_only -p 6380 ping`
  must print `PONG` → re-run
  `npx dotenv -e <live.env> -- pnpm test:redis-integration` (expect 24 passed:
  13 conformance + 11 PR-slot, 0 skipped).
- Side note: `pnpm test` without env never reaches Redis (suites skip by design);
  the endless `ECONNREFUSED 127.0.0.1:6379` spam in that mode comes from the
  eager `connection` singleton (`packages/queue/src/index.ts:44`, infinite
  retries, intended for the worker) plus previously hardcoded `6379` test
  clients — the latter fixed in §5. Production behavior intentionally untouched.

**B2 — Staging golden path: STAGING_BLOCKED (no credentials, no org, no App).**
Verified by env presence check (existence only, values never read): `E2E_STAGING`,
`E2E_WEBHOOK_SECRET`, `E2E_DEMO_EMAIL/PASSWORD`, `GITHUB_APP_ID/PRIVATE_KEY/SLUG/WEBHOOK_SECRET`,
`GITHUB_TOKEN/REPOSITORY` — all ABSENT. Nothing was faked; the spec
self-skips without them by design.

- Operator checklist (per `docs/staging-launch-runbook.md` §§2,7,10):
  1. Provision isolated staging PG15 + Redis7 (separate from dev 5434/6380).
  2. Create a **staging** GitHub App (Contents + Pull requests read/write,
     Metadata read; webhook URL → staging `/api/webhooks/github`); record App ID,
     base64 PEM, slug, and a staging-only webhook secret.
  3. Create a disposable private test org/repo; install the staging App there.
  4. Set server env: `DATABASE_URL`, `REDIS_URL`, `DEV_AUTH_SECRET`,
     `NEXTAUTH_SECRET`, `DEMO_USER_EMAIL/PASSWORD` (staging-only),
     `AI_PROVIDER=mock`, `SANDBOX_VALIDATION_MODE=github-checks-only`,
     `GITHUB_APP_ID/PRIVATE_KEY/SLUG/WEBHOOK_SECRET`, `EVIDENCE_STORE_DIR`,
     `ALERT_WEBHOOK_URL`.
  5. `pnpm install --frozen-lockfile && pnpm db:generate &&
pnpm --filter @patchbay/db exec prisma migrate deploy && pnpm db:seed`
  6. `pnpm dev` (web :3000 + worker), then
     `E2E_STAGING=1 E2E_WEBHOOK_SECRET=<same-as-server>
 E2E_DEMO_EMAIL=demo@patchbay.dev E2E_DEMO_PASSWORD=<same-as-server>
 pnpm exec playwright test staging-golden-path --project=chromium`
     (asserts one CID across login → agent-key → signed event → analysis →
     snapshot plan → validation → second-human approval → draft PR →
     check_run → audit export, plus duplicate/signature/401/403 negatives).
  7. `pg_dump` → restore rehearsal with RTO + row counts in
     `docs/restore-evidence.md`.

## 5. Code changes made during verification (uncommitted, for review)

1. `apps/worker/src/jobs/agent-plan.test.ts` — genuine-defect fix (see §1):
   extended the prisma mock (graphSnapshot/repositorySnapshot/gitHubInstallation),
   real temp fixture dir for snapshot-backed runs, migrated 3 tests to the
   fail-closed contract, **+1 new regression test** (pre-model
   `SNAPSHOT_UNAVAILABLE`, $0 spend, `PLAN_ONLY`). No production file touched.
2. `packages/queue/src/redis-pr-slot-integration.test.ts` +
   `apps/worker/src/jobs/redis-pr-slot-integration.test.ts` — genuine defect:
   hardcoded `redis://127.0.0.1:6379` test clients (and B8 child env) bypassed
   `REDIS_URL`, looping forever on ECONNREFUSED off-CI. Now
   `process.env.REDIS_URL ?? "redis://127.0.0.1:6379"` (CI behavior identical).
   Test-only; production code untouched.
3. This file (`docs/STAGING-GOLDEN-PATH-EVIDENCE.md`) — new.

No merges, rebases, resets, deletions, weakened assertions, skipped gates, or
production-behavior changes. Preserved untracked files untouched:
`docs/KT_POST_WP13_FOR_GEMINI.md`, `docs/PERPLEXITY-PROBLEM-VALIDATION-BRIEF.md`.
No commit/push performed (awaiting explicit instruction).

## 6. Provenance note

This run executed at working tree `a3cf93e` **plus** the §5 test-only changes
(uncommitted). `git status --short` at report time shows only the §5 files above, plus `M
apps/web/next-env.d.ts` (pure `pnpm build` side effect: `.next/dev/types` →
`.next/types` import paths, left untouched per mission rules), plus the two
preserved untracked briefs and this file. No production source file differs
from `a3cf93e`.

## Final verdict: STAGING_BLOCKED

Local gates green (incl. 36/36 corpus, build, 64/64 snapshot/policy proof),
live PG15 proof green (migration artifact + 11/11 drills with NOSUPERUSER RLS
and WORM enforcement), snapshot security regressions demonstrated. Promotion to
controlled beta is blocked solely by missing staging infrastructure: wedged
host Redis/Docker daemon (B1) and absent staging credentials/org/App (B2).
“Controlled beta” here means draft-PR-only, human approval required, no
auto-merge, repository allowlist, narrow connector pack. No compliance
certification (PCI/RBI/FCA/SOC 2) is claimed — none was assessed.
