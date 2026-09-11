# Staging Golden-Path Evidence — release verification

- **Commit SHA tested:** `4de43e5` (`feat/production-hardening`), plus the
  uncommitted test-only fixes listed under §5 (verification ran WITH them; see
  §6). All production source files are byte-identical to `4de43e5`.
- **Environment classification:** local (Windows 11, Node v22.12.0, pnpm 10.34.5,
  Docker Desktop backend for port relay; `AI_PROVIDER` unset → mock).
- **Migration version applied:** 49/49, latest `20260908000000_repository_snapshot`
  applied live via `prisma migrate deploy` (was the single pending migration).
- **Real vs mocked:** §1 gates are mock/FS-backed unit proof except where noted;
  §2 PG drills ran against a REAL PostgreSQL 15 container (no mocks). Redis
  drills are BLOCKED (host Docker daemon wedged — §4). No staging GitHub App,
  org, or secrets exist anywhere in this run — nothing was faked.

## 1. Local release gates (Phase B, on `4de43e5`)

| Command                                              | Result                                                                                                                                           |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm db:generate`                                   | PASS                                                                                                                                             |
| `pnpm verify:lockfile` (`install --frozen-lockfile`) | PASS (up to date)                                                                                                                                |
| `pnpm verify:capability-matrix`                      | PASS (`Capability matrix check: OK`)                                                                                                             |
| `pnpm format:check`                                  | PASS                                                                                                                                             |
| `pnpm lint` (`--max-warnings 0`)                     | PASS                                                                                                                                             |
| `pnpm typecheck` (20/20 workspace projects)          | PASS                                                                                                                                             |
| `pnpm test` (full suite)                             | **174 files passed / 0 failed / 5 skipped files; 1644 tests passed / 0 failed / 27 skipped** (re-run after the sandbox split, §1 analysis below) |
| `pnpm test:corpus`                                   | PASS 36/36 — proven twice: standalone (122s) and in-suite (all 36 green in the full run below)                                                   |
| `pnpm build` (Next.js 16.3.2, 100+ routes)           | PASS (3 pre-existing Turbopack tracing warnings in `repo-analysis/lockfile.ts`, informational only)                                              |

Full-suite failure analysis across two runs (nothing waived, nothing hidden):

- Run 1 (on `a3cf93e` + uncommitted fixes): 3× `agent-plan.test.ts` mock gap
  (`resolveExpectedCommitSha` touched an unmocked `prisma.graphSnapshot`
  delegate) — genuine gap, fixed by extending the mock + migrating to the
  fail-closed contract + 1 new `$0`-spend regression test; 1× corpus coverage
  gate 30s timeout under parallel load (28.7s standalone → load contention).
- Run 2 (on `4de43e5` + §5 fixes): 1642 passed / 1 failed — new single failure
  `sandbox-runner.test.ts > provenance > classifies command failures and
timeouts` (`sandbox-runner.test.ts:263`, 20s budget). Root cause, proven: the
  test ran two sequential `npm test` child-process spawns under ONE shared 20s
  budget; in isolation the same test takes 8s and passes 41/41. Under full-suite
  parallel load (11 workers, sibling suites spawning npm/node/tsc concurrently)
  the two spawns jointly exceeded 20s. Machine-level CPU contention, not a logic
  defect — the assertions themselves never failed.
- Correction (coverage-preserving, per-case strictness unchanged): split the one
  `it` into `classifies command failures` + `classifies timeouts`, each keeping
  the identical 20s budget and identical assertions. This is isolation, not a
  raised timeout: one slow spawn can no longer starve the other, and neither
  case is allowed a millisecond more than before. No production file touched.
- Run 3 (after the split): **174/174 files, 1644/1644 tests, 0 failures.**
  `classifies command failures` 3.1s + `classifies timeouts` 15.4s, corpus
  coverage gate 23.5s — all inside budget. The 5 skipped files / 27 skipped
  tests are the live-DB/Redis suites (skip by design without dotenv env; proven
  live separately in §2 where dependencies exist).
- Split-soundness review (per release instruction): production timeout is per
  `runValidation()` command, not an aggregate multi-command deadline —
  `runValidation(command, cwd, options)` executes exactly one command per call
  (`packages/sandbox-runner/src/index.ts`), and the worker profile loop
  (`apps/worker/src/jobs/run-validation.ts`) applies the profile `timeoutMs`
  per command with no cross-command deadline accumulator. The 20s figure was a
  vitest harness guard over two independent single-command runs, so splitting
  into two identical-assertion/identical-budget cases preserves the contract
  exactly (neither case gained a millisecond).

## 2. Live PostgreSQL 15 + Redis 7 proof (Phase 2)

Docker services per `docker-compose.yml`: `db` (postgres:15-alpine, host 5434),
`redis` (redis:7-alpine, host 6380, requirepass). Env via
`npx dotenv -e .env` (+ `REDIS_URL=redis://:patchbay_dev_only@127.0.0.1:6380`
override file for Redis suites — `.env` carries no Redis password).
Provenance note: these live runs executed when HEAD was `a3cf93e` plus the
`4de43e5` test-only content as uncommitted files; every non-test file is
identical across `a3cf93e`, `4de43e5`, and the current tree, so the proof
transfers without re-running (re-running PG drills now is impossible anyway —
see B1; the daemon was already wedged).

| Check                                                                           | Result                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prisma migrate deploy` (49/49 incl. snapshot migration)                        | PASS (applied live)                                                                                                                                                                                                                                                                                                                                              |
| Migration artifact proof (pg_catalog query)                                     | PASS — table `RepositorySnapshot`; RLS enabled+FORCED; policy `RepositorySnapshot_tenant_isolation`; 7 indexes (pkey, unique repo+sha, 3 composite, expires, graph); 4 `repositorySnapshotId` columns + inbound FKs on AgentRun/PatchArtifact/RemediationAttempt/ValidationRun; 3 outbound FKs; `_prisma_migrations` head = `20260908000000_repository_snapshot` |
| `pnpm db:seed` (idempotent demo data)                                           | PASS (org-acme, 9 vendors, 8 repos, 6 cases, 13 outcomes, 7 gates)                                                                                                                                                                                                                                                                                               |
| `wp13-drills.test.ts` (real PG)                                                 | PASS 3/3 (full loop, duplicate invariance, kill switch)                                                                                                                                                                                                                                                                                                          |
| `rls-tenant-isolation.test.ts` (real PG, NOSUPERUSER `patchbay_rls_probe` role) | PASS 4/4 — incl. “covers every organization-owned table”, which now covers the new `RepositorySnapshot` table                                                                                                                                                                                                                                                    |
| `worm-db.test.ts` (real PG)                                                     | PASS 4/4 (UPDATE/DELETE rejected, wipe rolls back, history intact)                                                                                                                                                                                                                                                                                               |
| `test:redis-integration` (conformance + PR-slot, real Redis 7)                  | **PASS 27/27, 0 failed, 0 skipped** — 13 P0-C concurrency/fairness + 11 P0-B PR-slot safety + 3 conformance (2×1000-round exact-limit races at 1000/1000, 0 violations; PR-slot path 1000/1000, 0 violations), live `patchbay-redis` (redis:7-alpine, healthy) via passworded `REDIS_URL`                                                                        |

## 3. Snapshot security regression proof — 64/64 + sandbox 42/42

Consolidated unit run (mock/FS-backed, no network): `snapshot.test.ts` 6 ·
`snapshot-binding.test.ts` 7 · `error-safety.test.ts` 3 ·
`repository-snapshot.test.ts` 10 · `agent-workflow.test.ts` 8 ·
`agent-plan.test.ts` 4 · `policy.test.ts` 26 — **64 passed / 0 failed**; plus
`sandbox-runner.test.ts` alone **42 passed / 0 failed / 6 skipped**
(container tests skip without a daemon), and all of the above green again
inside the full-suite Run 3.

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

**B1 — RESOLVED: Docker recovered, Redis 7 proven live (was: wedged daemon).**

- History (kept for the record): `docker ps` hung 4× across ~1h; `compose up`
  and `restart` hung; two backends fought (stale PID 15616 squatting ports +
  stub PID 10076); Redis:6380 accepted TCP but never handshook. Operator quit
  Desktop fully (both PIDs reaped, ports free), one fresh instance started.
- Recovery proof, in order: `docker ps` answers —
  `patchbay-db Up (healthy)`, `patchbay-redis Up (healthy)` (containers 6 days
  old, volumes intact, auto-recovered); `docker compose up -d db redis` clean;
  `docker compose ps` shows both `Up (healthy)` with 5434/6380 mappings;
  protocol-level `PING` via passworded URL → exactly `PONG`;
  `prisma migrate status` → `Database schema is up to date!` (49/49 intact).
- `test:redis-integration` → **3 files, 27 passed, 0 failed, 0 skipped**
  (13 P0-C + 11 P0-B + 3 conformance; exact-limit races 1000/1000 ×3, 0
  violations; note the true total is 27, not the earlier 24 estimate). The
  `ECONNREFUSED 127.0.0.1:1` stderr lines are the deliberate outage tests (B5 /
  disposable-client) proving fail-closed behavior — by design, not failures.
  The earlier `:6379` loop is gone (fixed by honoring `REDIS_URL`).
- Side note: `pnpm test` without env never reaches Redis (suites skip by design);
  the endless `ECONNREFUSED 127.0.0.1:6379` spam in that mode came from the eager
  `connection` singleton (`packages/queue/src/index.ts`, infinite retries,
  intended for the worker) plus hardcoded `:6379` test clients — the latter fixed
  in §5. Production behavior intentionally untouched.

**B2 — Staging golden path: credentials/org/App absent (existence-checked twice, values never read).**
`E2E_STAGING`, `E2E_WEBHOOK_SECRET`, `E2E_DEMO_EMAIL/PASSWORD`, `GITHUB_APP_ID/PRIVATE_KEY/SLUG/WEBHOOK_SECRET`,
`GITHUB_TOKEN/REPOSITORY` — all ABSENT. Nothing faked; the spec self-skips.

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
     (one CID across login → agent-key → signed event → analysis → snapshot
     plan → validation → second-human approval → draft PR → check_run → audit
     export, plus duplicate/signature/401/403 negatives and the Phase-D
     negatives: commit-advance, ambiguous-anchor, expired-snapshot).
  7. `pg_dump` → restore rehearsal with RTO + row counts in
     `docs/restore-evidence.md`.

## 5. Code changes made during verification (uncommitted unless noted)

Committed as `4de43e5` (approved): `agent-plan.test.ts` mock-gap fix + fail-closed
migration + `$0`-spend regression test; both `redis-pr-slot-integration.test.ts`
files (`REDIS_URL` honored, CI default preserved); this evidence doc (v1).
Uncommitted now (test-only, for review — no merge/push/rebase/reset/commit
without explicit authorization):

1. `packages/sandbox-runner/src/sandbox-runner.test.ts` — split one coupled `it`
   into two with identical assertions and identical 20s per-case budgets (§1);
   split-soundness reviewed: production timeout is per `runValidation()` command
   (`packages/sandbox-runner/src/index.ts`, one command per call; worker profile
   loop in `apps/worker/src/jobs/run-validation.ts` applies `timeoutMs` per
   command, no aggregate deadline), so no aggregate-budget test exists to retain.
2. `apps/worker/src/jobs/agent-plan.test.ts` — mock typing fix (`as never` on the
   impl functions) for `tsc` strictness; type-assertions erase at runtime, so the
   full-suite result transfers exactly (agent-plan re-ran 4/4 after the fix).
   No merges, rebases, resets, deletions, weakened assertions, skipped gates, or
   production-behavior changes. Preserved untracked files untouched:
   `docs/KT_POST_WP13_FOR_GEMINI.md`, `docs/PERPLEXITY-PROBLEM-VALIDATION-BRIEF.md`.
   `M apps/web/next-env.d.ts` is a pure `pnpm build` side effect (left untouched).

## 6. Provenance note

HEAD is `af12bd5`; working tree adds only this file (v3: CI-green §7b evidence
plus the mandated verdict), the `next-env.d.ts` build side effect (untouched),
and the two preserved briefs. Commits since `4de43e5`: `1210f36`
(metrics real-column fix), `b3b7fac` (e2e credentials/tour/wasm), `d864e99`
(next/sharp CVE bump), `cdc08d2`/`8c3edd9` (CI worker step, js-yaml override),
`ad1df33` (worker lifetime fix). No production source file differs from
`af12bd5`.

## 7. GitHub Actions CI runs (production-gates)

### 7a. Run for `2dda6b1` — e2e red (credential mismatch, fixed since)

- Push run https://github.com/Rehan147ig/patchbay/actions/runs/34261070707 was
  superseded by PR run https://github.com/Rehan147ig/patchbay/actions/runs/34261075415
  (same head SHA `2dda6b1`, `pull_request` event) via the workflow concurrency
  group (`cancel-in-progress: true`) — an infra preemption, not a code result.
  The PR run is operative: **completed, conclusion `failure`, single failing
  step `Browser end-to-end tests`**; every other step green (setup, containers,
  checkout, pnpm/Node, install, Prisma generate, migrations incl.
  `20260908000000`, seed, static gates, unit+integration suite, corpus, live
  PG/Redis drills, build, Playwright install).
- Failing-step log (`--log-failed`): 5 failed / 1 skipped. All 5 failures are
  identical: form fills succeed, `Sign in to console` clicks, then
  `page.waitForURL(/\/overview/)` → `Test timeout of 300000ms exceeded`
  (`openai-demo.spec.ts:13`, `outcomes.spec.ts:13,32`,
  `settings-autonomy.spec.ts:13,25`). `staging-golden-path` correctly SKIPPED
  (no `E2E_STAGING`). Traces/artifacts uploaded per the workflow upload step.
- Root cause (test/env defect, no production change needed): the login route
  (`apps/web/src/app/api/auth/login/route.ts`) compares the submitted password
  against server env `DEMO_USER_PASSWORD` (fail-closed 401 otherwise; no stored
  hash — seed creates users without passwords). CI sets
  `DEMO_USER_PASSWORD: ci-demo-password` (`.github/workflows/production-gates.yml`
  env), but all 5 browser specs hardcode `.fill("dev-only")` (the local-dev
  value, matching local `.env`). Result: deterministic 401 in CI → no
  `location.assign("/overview")` → 5-minute timeout ×5. Locally green because
  local env uses the dev value. The `1e0828b` selector fix is proven working —
  fills/clicks succeed; only the credential is wrong.
- Proposed genuine fix (NOT applied — awaiting explicit authorization; no
  weakened assertions, no production change): read credentials from env with
  local defaults in the 3 spec files, exactly the convention
  `staging-golden-path.spec.ts:35-36` already uses
  (`E2E_DEMO_EMAIL ?? "demo@patchbay.dev"`, `E2E_DEMO_PASSWORD ?? "dev-only"`),
  and add `E2E_DEMO_EMAIL: demo@patchbay.dev` /
  `E2E_DEMO_PASSWORD: ci-demo-password` to the CI Browser-e2e step env (mirrors
  runbook §10). Local behavior with unset `E2E_*` stays byte-identical to today.

### 7b. Run for `af12bd5` — production-gates GREEN (exact pushed SHA)

- Push run https://github.com/Rehan147ig/patchbay/actions/runs/34331833011
  (head SHA `af12bd5c84eb9f9b81aedf58c52d22a2c4728c8f`): **completed,
  conclusion `success`** — every step green: setup, containers (PG15/Redis7
  services), checkout, pnpm/Node, install, Prisma generate, migrations incl.
  `20260908000000`, seed, static gates, unit+integration suite, corpus, live
  PG/Redis drills, build, Playwright install, **Browser end-to-end tests**
  (openai-demo full chain incl. VALIDATED + draft PR, outcomes 2/2,
  settings-autonomy 2/2, staging-golden-path correctly skipped), artifact
  upload. The sibling PR run also succeeded the same morning.
- Companion Security workflow on the same tree: semgrep/gitleaks/deepsec green,
  `pnpm audit --prod` clean (Next 16.3.3 + sharp ^0.35.4 cleared the two
  critical RCEs); OSV-Scanner still flags vitest 3.2.7 GHSA-82fw-gwwq-j7x9
  (moderate 5.9, dev-only test runner — major upgrade to 4.1.11 deferred with
  justification) after the js-yaml ^4.3.2 override cleared GHSA-2883-xcg3-v3hh.
  OSV is a separate workflow from production-gates; recorded here so the
  verdict below is not misread as "all CI workflows green".

## Final verdict: LOCAL_AND_CI_READY; STAGING_GOLDEN_PATH_BLOCKED

Local gates green (174/174 files, 1644/1644 tests, 36/36 corpus, typecheck,
build, format, lint); live-PG gates green (migration artifact + 11/11 drills);
live-Redis gates green (27/27, 0 failed, 0 skipped); snapshot/policy
regressions green (64/64 + sandbox 42/42); production-gates green on exact SHA
`af12bd5` (run 34331833011, all steps incl. browser e2e). The beta verdict
(`READY_FOR_CONTROLLED_BETA`, draft-PR-only + human approval + no auto-merge +
allowlist + narrow pack, no compliance claims) is explicitly NOT granted: real
staging GitHub App proof (Phase D — B2 checklist) remains mandatory and has not
run. No compliance certification (PCI/RBI/FCA/SOC 2) is claimed — none assessed.
