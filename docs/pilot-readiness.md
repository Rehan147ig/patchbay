# Patchbay Pilot Readiness (WP11) — Trust, Subprocessors, Backup & Operations

Who this is for: the operator running a Patchbay pilot (self-hosted or
Railway) and the security reviewer signing it off. Companion docs:
`trust-architecture.md` (product invariants), `threat-model.md` (MVP threat
inventory), `security.md`, `self-host.md` (§7 backup basics),
`kms-rotation-drill.md` (registry + legacy KMS key drill),
`docs/implementation-status.md` (WP0–WP11 verification log).

## 1. Trust boundaries and how each is enforced

| #   | Boundary                   | What must never cross it                                             | Enforcement (code)                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | -------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B1  | Tenant ↔ tenant            | One org's rows reaching another org                                  | `organizationId` on every operational table (`withOrgContext`), Postgres RLS `tenant_isolation` policies on all non-exempt tables (WP11 migration `20260906000004_wp11_rls_backfill`), negative suite `rls-tenant-isolation.test.ts` (reads/writes/updates/deletes as a foreign tenant, least-privilege role). Exempt by design: `User` (session identity), `WebhookDelivery` (global receiver), `Vendor`/`ContractSource` (NULL-org catalog rows) — see `org-scope.ts`. |
| B2  | Secrets ↔ everything else  | Plaintext credentials in logs, audit, AI context, browser, PR bodies | AES-256-GCM envelope encryption in `SecretStore` (`packages/env/src/envelope.ts`, PRIMARY/PREVIOUS rotation states, access audit logs names-only); `sanitizeText` redaction before audit/AI/output storage; tokens server-side only; `redactTokenInError` on provider errors; envelope-prefix corruption fails closed.                                                                                                                                                   |
| B3  | Untrusted repo code ↔ host | Arbitrary execution during validation                                | Fixed command-ID registry (`VALIDATION_COMMAND_REGISTRY`) resolved server-side; container sandbox (`--network none`, `--cap-drop ALL`, `no-new-privileges`, read-only rootfs, non-root, CPU/mem/PID caps); image allowlist + digest pins; per-profile timeouts/memory ceilings; `github-checks-only` mode executes nothing locally.                                                                                                                                      |
| B4  | AI output ↔ state changes  | Model text becoming action                                           | AI is advisory: Zod parse before any effect, never executes, never bypasses policy; prompt-injection defenses in `prompt-safety`; `AI_PROVIDER=mock` default = zero model egress.                                                                                                                                                                                                                                                                                        |
| B5  | History ↔ tampering        | Rewriting what happened                                              | WORM triggers reject `UPDATE`/`DELETE` on `AuditEvent` (proven by `worm-db.test.ts`); content-addressed evidence objects (SHA-256 verified on read); delivery artifacts carry tamper-evident descriptor hashes.                                                                                                                                                                                                                                                          |
| B6  | Automation ↔ merges        | Unreviewed code landing                                              | Draft-PR-only invariant (no merge code path); certification + capability gates + policy + quorum + approval on every PR vector; update-on-advance repoints instead of orphaning; idempotency ledger prevents duplicate delivery.                                                                                                                                                                                                                                         |
| B7  | Quota ↔ overspend          | Silent over-delivery past plan limits                                | Monthly UTC quotas in `PLAN_DEFINITIONS`, enforced in web (402 `PLAN_LIMIT_EXCEEDED`) AND worker (terminal `UnrecoverableError` + `POLICY_BLOCKED` audit); SKIPPED validations consume nothing.                                                                                                                                                                                                                                                                          |

## 2. Data inventory (what lives where)

| Store                                  | Contents                                                                    | Durability                            | Loss impact                                                   |
| -------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------- |
| PostgreSQL                             | All relational state incl. WORM audit, delivery ledger, dead letters, gates | **Back up** (runbook §5)              | Total: restore from backup before serving traffic             |
| `data/evidence` (`EVIDENCE_STORE_DIR`) | Content-addressed raw evidence + validation logs                            | **Back up** (same window as Postgres) | Attestation gaps: hashes on rows no longer resolve            |
| Redis                                  | Queue jobs, PR slots, concurrency counters, heartbeats                      | Ephemeral by design                   | In-flight jobs retry via BullMQ on restart; safe to lose      |
| Environment / secret manager           | `DATABASE_URL`, KEKs (`PATCHBAY_KEK*`), App private key, provider tokens    | **Back up offline, twice**            | KEK loss is unrecoverable: sealed values can never open again |

## 3. Subprocessors and external dependencies

Required for core function:

| Processor                                     | Function                                                                      | Data shared                                                      | Notes                                                                       |
| --------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------- |
| GitHub                                        | Repositories, draft PRs, check runs, webhooks (App JWT + installation tokens) | Repo metadata, patches, validation summaries, evidence PR bodies | Short-lived installation tokens; no tokens to browser                       |
| AI provider (operator choice; `mock` default) | Plan drafting via `ai-provider` (Vercel AI SDK or OpenAI-compatible endpoint) | Bounded, redacted code excerpts (never secrets)                  | `AI_PROVIDER=mock` = zero model egress; required for AI-assisted plans only |
| npm registry                                  | Release polling (`poll-npm-registry`)                                         | Package names/versions (public metadata)                         | No tenant data transmitted                                                  |

Only when the operator enables them:

| Processor                                               | Function                         | Data shared                                           |
| ------------------------------------------------------- | -------------------------------- | ----------------------------------------------------- |
| Stripe or Dodo Payments                                 | Subscription checkout + webhooks | Billing customer ids, tier, status (no tenant source) |
| Hosting (Railway per `deploy-railway.md`, or self-host) | Compute + Postgres + Redis       | Everything the deployment stores (see §2)             |
| Splunk HEC (`ALERT_WEBHOOK_URL` / SIEM forward)         | Alert + audit export             | Audit events (already redacted), DLQ alerts           |
| Slack/PagerDuty webhook                                 | DLQ paging                       | Job type + redacted error (500/2000 chars)            |

## 4. Secret encryption operations (SecretStore envelope)

Environment:

| Variable                    | Required                    | Meaning                                                                                         |
| --------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------- |
| `PATCHBAY_KEK`              | To enable sealing           | Base64 of 32 random bytes (AES-256). Absent = plaintext passthrough (loud, migration mode only) |
| `PATCHBAY_KEK_KID`          | No (default `kek-primary`)  | Key id stamped on new envelopes                                                                 |
| `PATCHBAY_KEK_PREVIOUS`     | After first rotation        | Demoted key: opens old envelopes, never seals                                                   |
| `PATCHBAY_KEK_PREVIOUS_KID` | No (default `kek-previous`) | Must differ from the primary kid                                                                |

Generate: `openssl rand -base64 32`. Seal offline (example):
`pnpm exec tsx -e "import {parseKekRing,encryptSecret} from './packages/env/src/envelope.ts'; ..."` —
store the printed `enc1…` string as the secret value; reads open it
transparently, including across rotations.

Rotation (7-day dual-key window, mirrors `kms-rotation-drill.md`):

1. Generate `k2`; deploy as `PATCHBAY_KEK_PREVIOUS=k1` + `PATCHBAY_KEK=k2`
   (kids updated to match). Old envelopes still open via PREVIOUS.
2. Reseal live values with `rotateEnvelope` (fresh nonce, PRIMARY kid).
3. After the window, drop `PATCHBAY_KEK_PREVIOUS`. Envelopes still on the
   retired kid now fail closed — verify zero remain first (scan stored
   values for the old `enc1.<kid>.` prefix).
4. On compromise: rotate immediately, record the reason in an audit event,
   treat exfiltrated sealed values as burned (attacker with the old KEK
   opens them).

Loss warning: there is no recovery from a lost KEK ring. Back up KEKs
offline in two places before sealing anything irreplaceable. (The legacy
single-key `kms.ts` stub in `@patchbay/db` remains for field-level use;
SecretStore envelopes are the managed path for secret material.)

## 5. Backup and restore runbook

Backup (same window, nightly minimum for pilots):

1. Postgres: `pg_dump patchbay -d patchbay > patchbay-backup.sql`
   (or volume snapshot; Redis needs no backup — §2).
2. Evidence store: snapshot `data/evidence` (or `EVIDENCE_STORE_DIR`).
3. Secrets: confirm KEK + App-key offline copies exist (never in the dump).

Restore on a fresh install:

1. Start Postgres, create the database, restore the dump.
2. Run `pnpm db:migrate` to catch up any schema drift (migrations are
   append-only; RLS policies and the WORM trigger come with the schema).
3. Restore the evidence directory to the same `EVIDENCE_STORE_DIR`.
4. Supply environment (database URL, KEKs, App credentials); start worker,
   then web.
5. Verify: `/api/health` (Postgres + Redis + queue), `/api/operations/queues`
   (ADMIN: workers heartbeating, DLQ counts sane), sign-in, and one
   end-to-end validation on a fixture repository. RPO = last backup;
   RTO ≈ restore + verify (exercise it quarterly and record the time).

Restore caveats: audit rows restore as-is (WORM trigger permits INSERT);
evidence objects verify by hash on read — a hash failure after restore
means a corrupt copy, investigate, do not delete.

## 6. Retention and quota operations

| Control                                   | Default                                                          | Knobs                                                                                                                                 |
| ----------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Validation artifacts (rows + log objects) | 90 days                                                          | `VALIDATION_ARTIFACT_RETENTION_DAYS`, worker retention sweep (6h); shared log objects survive while any live artifact references them |
| Agent-run payloads                        | 90 days                                                          | `AGENT_RUN_RETENTION_DAYS` (digests/telemetry kept)                                                                                   |
| Graph snapshots                           | latest 5 READY + 24h incomplete                                  | `pruneGraphSnapshots({maxReady, staleAgeMs})`, runs per graph-index                                                                   |
| Monthly delivery quotas                   | FREE 50 val / 10 PRs … ENTERPRISE unlimited (`PLAN_DEFINITIONS`) | Code-defined per tier; blocks are 402 / terminal + audited                                                                            |

## 7. Pilot acceptance checklist

- [ ] `pnpm format:check`, `pnpm lint`, `pnpm typecheck` green.
- [ ] `pnpm test` green (incl. `rls-tenant-isolation` + `worm-db` — these
      self-skip without a reachable Postgres, so run once against a real DB).
- [ ] `pnpm test:corpus` 36/36.
- [ ] Migrations applied in order through `20260906000004_wp11_rls_backfill`.
- [ ] `PATCHBAY_KEK` set (or a recorded decision to run plaintext); KEKs
      backed up offline twice.
- [ ] `SANDBOX_VALIDATION_MODE=github-checks-only` (or Docker present for
      `hosted-docker`); `ALERT_WEBHOOK_URL` set for paging.
- [ ] Backup/restore exercised once; RTO recorded.
- [ ] `main` deploys (Railway tracks `main`); spec work stays on feature
      branches behind draft PRs.
