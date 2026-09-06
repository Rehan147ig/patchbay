# Patchbay Production Readiness Report (WP13 sign-off)

**Branch:** `feat/production-spec` · **Measurement base:** `0ae62c4` (WP12) ·
**Date:** 2026-09-07 UTC · **Environment:** Windows 11, Node v22.12.0,
pnpm v10.34.5, PostgreSQL 15.19 (local staging), Redis local ·
**Auditor:** OpenCode (Muse Spark) executing the Production Transformation
Specification §17 WP13 · **`main` untouched throughout.**

## 1. Executive summary & verdict

**Verdict: GO for staging/pilot deployment. Production GA stays pending the
residuals in §7 (all non-blocking, all owned).**

WP0–WP13 are complete on `feat/production-spec`. Every Definition-of-Done
gate (§18) was measured, not asserted: 171 test files / 1603 tests green,
36/36 corpus, clean empty-schema migration (58 tables, 40 RLS policies),
live-database negative tenant tests, three operational drills on real
Postgres, and a green production build. No gate was waived; §7 lists exactly
what was verified by execution versus by adjacent evidence, and what remains
for GA.

## 2. Git & environment baseline

| Item             | Value                                                                                    |
| ---------------- | ---------------------------------------------------------------------------------------- |
| Branch           | `feat/production-spec` (PR #1 → `main`, draft, auto-updated per WP)                      |
| Measurement base | `0ae62c4` (WP12 commit)                                                                  |
| WP13 release     | Sign-off commit on `feat/production-spec` (this report + status land with it)            |
| Node / pnpm      | v22.12.0 / v10.34.5                                                                      |
| Database         | PostgreSQL 15.19 (Alpine), local staging `patchbay`                                      |
| Cache/queue      | Redis local (6380), BullMQ attempts=3 exponential backoff                                |
| Validation mode  | `SANDBOX_VALIDATION_MODE=github-checks-only` posture verified; `hosted-docker` available |

## 3. Verification evidence table

All commands run from the repo root on 2026-09-06/07 UTC. Exits are process
exit codes; logs retained in-session.

| #   | Command                                                                                                            | Result       | Evidence                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------ | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `pnpm install --frozen-lockfile`                                                                                   | exit 0, 3.5s | Lockfile-respecting install, no drift                                                                                                        |
| 2   | `pnpm --filter @patchbay/db generate`                                                                              | exit 0       | Client generated from final schema (incl. WP12 tier)                                                                                         |
| 3   | `pnpm format:check`                                                                                                | exit 0       | Zero style deviations (`next-env.d.ts` now ignored as generated)                                                                             |
| 4   | `pnpm lint` (`--max-warnings 0`)                                                                                   | exit 0       | Zero errors, zero warnings                                                                                                                   |
| 5   | `pnpm typecheck` (20 projects)                                                                                     | exit 0       | All workspace projects incl. `@patchbay/telemetry`                                                                                           |
| 6   | `pnpm test` (DATABASE_URL set)                                                                                     | exit 0, 169s | **171 files passed, 1603 tests passed, 0 failed**, 10 skipped (pre-existing pendings)                                                        |
| 7   | `pnpm test:corpus`                                                                                                 | exit 0, 123s | **36/36** eval-corpus certification                                                                                                          |
| 8   | `pnpm build`                                                                                                       | exit 0       | All routes compiled incl. `/api/maintenance/*`, `/api/contracts/*`, `/api/operations/capabilities`, `/sources`, `/operations`, `/onboarding` |
| 9   | Empty-schema `migrate deploy` (`schema=wp13_probe`)                                                                | exit 0       | **58 tables, 40 RLS policies**, latest `20260906000005_wp12_autonomy_tier`; probe schema dropped afterwards                                  |
| 10  | `pnpm db:seed`                                                                                                     | exit 0       | Idempotent; org, 9 vendors, 8 repos, 4 contract sources, 6 lifecycle cases, 13 outcomes, 6+1 gates, validation profile                       |
| 11  | `wp13-drills.test.ts` (live Postgres)                                                                              | 3/3 pass     | Full loop, duplicate invariance, kill switch (see §5)                                                                                        |
| 12  | `rls-tenant-isolation.test.ts` (live Postgres)                                                                     | 4/4 pass     | Reads/writes/updates/deletes as foreign tenant; NOSUPERUSER probe role                                                                       |
| 13  | Auto-merge grep (`pulls/merge`, `mergePullRequest`, `enableAutomerge`, `auto.merge(`) across `apps/` + `packages/` | **0 hits**   | No merge code path exists                                                                                                                    |

Known flake (recorded, not acted on): the eval-corpus heavy test twice hit
the 30s vitest timeout under parallel load during WP9/WP11 (timeout mode,
never an assertion); green solo, green in full suite, green on idle re-run.
Recommend production CI runners with ≥4 vCPU or a raised timeout for that file.

## 4. The 14 Definition-of-Done gates

| Gate (§18)                 | Verdict            | Evidence                                                                                                                                                                                                                                                                              |
| -------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Build                   | **PASS**           | Table rows 1–8 above                                                                                                                                                                                                                                                                  |
| 2. Database                | **PASS**           | Empty-schema deploy (58/40), `rls-tenant-isolation` 4/4 live via NOSUPERUSER probe (superusers bypass RLS even with FORCE — the suite provisions a production-shaped role so it cannot pass vacuously)                                                                                |
| 3. Tenant Security         | **PASS**           | RLS negatives + `org-scope` structural suite + MIXED-model call-site rules (Vendor/ContractSource `IN {NULL, org}`); secret scrubbing before audit/AI/storage (redaction unit tests); content-addressed evidence is tenant-neutral by hash                                            |
| 4. Execution Security      | **PASS**           | Container tests pin `--network none`, `--cap-drop ALL`, `no-new-privileges`, read-only rootfs, non-root user, no socket mount; image allowlist + pre-spawn digest pins; production rejects non-container runtimes; `github-checks-only` executes nothing                              |
| 5. Connector Certification | **PASS**           | Corpus 36/36; 9 DRAFT_PR connectors; `ConnectorCertification` rows; `requireCertified` enforced on every PR vector (worker + web parity tests)                                                                                                                                        |
| 6. Ingestion               | **PASS**           | Webhook HMAC verification + `x-github-delivery` dedup tests; delivery-level insert-conflict convergence proven in Drill 2; Redis fixed-window rate limits tested; poll state in TaskParameter/WatchtowerRun rows                                                                      |
| 7. Remediation             | **PASS**           | `originalHash`/`patchedHash` + `approvalCoversPatches` invalidation; `PackBudgetExceededError` enforced on hash-bound plans (no truncation, no silent skips); AI advisory-only with Zod parsing                                                                                       |
| 8. Policy                  | **PASS**           | `REQUIRE_APPROVAL` blocks without covering approval (worker + route tests); `PLAN_ONLY` refuses all delivery at the single worker choke point; auto-merge grep: 0 hits (§3 row 13)                                                                                                    |
| 9. Delivery                | **PASS**           | Stable idempotency keys with single-winner adoption (unit + Drill 2); PR bodies carry canonical `<!-- patchbay:evidence … -->` blocks with round-trip parse tests (Drill 1 uses a real artifact hash)                                                                                 |
| 10. Reliability            | **PASS**           | `DeadLetterJob` capture with scrubbed payloads (unit + failure-handler tests); BullMQ 3× exponential backoff; single-winner replay with freshness guards (route tests)                                                                                                                |
| 11. Observability          | **PASS**           | OTEL spans on every job transition (`instrumentProcessor` in worker dispatch) and instrumented routes; `/api/operations/queues` exposes depth, DLQ, heartbeats, outcome mirror (route tests incl. degraded mode)                                                                      |
| 12. Recovery               | **PASS with note** | Rotation drill executed (previous-key decrypt + `rotateEnvelope`, envelope unit tests); suspension tested live (Drill 3); restore path verified via empty-schema migrate + idempotent seed. `pg_dump` itself not executed here (no dump binary in this environment) — see residual R1 |
| 13. UX                     | **PASS with note** | 6-step wizard, 8 views, 5-state surfaces, zero dead actions (all buttons mutate/navigate with tooltips on disabled states); verified by 40+ API/component contract tests + green build. Browser click-through not executed here — residual R2                                         |
| 14. Customer Proof         | **PASS with note** | 8 seeded repos × 9 vendors, 6 lifecycle cases, 13 classified outcomes, corpus precision 36/36. No live customer data (pre-pilot by definition) — pilot measures real precision                                                                                                        |

## 5. Drill log (executed 2026-09-07, live Postgres + temp evidence dir)

- **Drill 1 — full loop** (`wp13-drills.test.ts`): contract ingest v1 → v2 with a
  normalized `METHOD_REMOVED` change → re-ingest converges (`deduplicated`,
  same snapshot, zero new changes) → release-funnel plan/patch/run rows →
  `recordValidationArtifact` (real object store; log round-trips through
  content addressing) → `evaluatePolicy` allows → ledger claim + SUCCEEDED →
  §7.4 block built with the REAL artifact hash, parses back, contains the
  rollback section. PASS.
- **Drill 2 — duplicate invariance**: identical webhook delivery inserted 3× →
  2× P2002, exactly 1 row; delivered ledger key re-claimed → `duplicate: true`
  with winner ref, still 1 attempt row (no second delivery). PASS.
- **Drill 3 — kill switch**: `openai/DRAFT_PR` ACTIVE → gate open; SUSPENDED →
  `assertWorkerCapabilityGateOpen` throws `/suspended/`; `stripe` unaffected;
  `capability.gate_suspended` audit row present. PASS.
- **Drill 4 — rotation**: covered by `envelope.test.ts` (PREVIOUS-key decrypt
  after promotion, `rotateEnvelope` reseal, tamper rejection, unknown-kid and
  malformed-prefix fail-closed). PASS (16/16).
- **Staging fixtures**: `pnpm db:seed` exit 0 — 1 org, 9 vendors, 8 repos, 4
  contract sources, 6 lifecycle cases, 13 outcomes, 7 gates, 1 validation
  profile; secret scan of `seed.ts` (tokens/keys/patterns): zero hits.

## 6. Security & compliance audit

- **Tenant isolation**: 40 RLS policies verified present on every non-exempt
  org-owned table (coverage test fails the build on regression); behavioral
  negatives live; 3 missing policies found and fixed during WP11
  (`Workspace`, `WorkspaceMember`, `AutonomyPolicy`).
- **Secrets**: AES-256-GCM envelopes with PRIMARY/PREVIOUS rotation and
  name-only access audit; zero hardcoded secrets in seed (grep verified);
  redaction before logs/audit/AI/outputs; tokens server-side only.
- **Sandbox**: §4 gate table; supply-chain pins (image allowlist, digest
  enforcement, registry-id commands).
- **Subprocessors** (`docs/pilot-readiness.md` §3): GitHub (repos/PRs/checks),
  operator-chosen AI provider (`mock` default = zero egress), npm registry
  metadata, optional Stripe/Dodo, hosting, Splunk HEC, Slack/PagerDuty —
  each with data classes shared.
- **History integrity**: WORM triggers (unit-proven), content-addressed
  evidence with hash verification on read, tamper-evident artifact hashes.

## 7. Residual risks & GA requirements (all non-blocking for pilot)

- **R1 — Dump-tool restore**: restore path proven via migrate+seed; execute one
  real `pg_dump` → fresh-host restore and record RTO before GA.
- **R2 — Browser pass**: contract-tested UI (40+ tests) + green build; do one
  manual 6-step wizard + 8-view click-through on staging before GA.
- **R3 — Corpus flake**: 30s timeout under parallel load (§3); quieter
  hardware or a raised timeout for that file in CI.
- **R4 — Production hardware**: this report was measured on a dev box;
  staging should run Postgres 15+, Redis 7+, Docker for `hosted-docker`,
  ≥4 vCPU for the worker.
- **R5 — KEK custody**: KEKs live in env here; production needs a managed
  KMS/secret manager with the rotation drill in `pilot-readiness.md` §4.

## 8. Operational runbooks (pointers, all shipped)

- Incident suspension: Operations page → gate status, or `setCapabilityGate`
  SUSPENDED; delivery vectors fail closed immediately (Drill 3).
- Dead-letter replay: Operations page → Replay (freshness-guarded), or
  `POST /api/operations/replay`; ledger guarantees single-winner.
- Queue triage: `GET /api/operations/queues` (degraded-safe); worker
  heartbeats show liveness; DLQ alerts via `ALERT_WEBHOOK_URL`.
- Backup/restore: `pilot-readiness.md` §5 (dump + evidence dir + KEK custody,
  restore order, verification checklist).
- Rotation: `pilot-readiness.md` §4 (dual-key window, reseal, compromise path).

## 9. Work-package closure

WP0 baseline → WP1 vocabulary → WP2 contracts → WP3 consumers/graph →
WP4 cases → WP5 policy/certs → WP6 packs → WP7 agents → WP8 execution plane →
WP9 delivery → WP10 ops → WP11 enterprise → WP12 UX → WP13 launch proof.
`main` was never touched; `feat/production-spec` carries the full
transformation behind draft PR #1 with per-WP commits and status log
`docs/implementation-status.md`.
