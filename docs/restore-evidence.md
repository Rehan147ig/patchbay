# Backup / Restore Rehearsal Evidence (P1-10)

> A seeded drill is not a recovery test. This records a real restore rehearsal.

## 2026-09-07 — wp13_probe rehearsal (recorded in WP13)

- **Empty-schema deploy:** `DATABASE_URL` with `schema=wp13_probe`, `pnpm --filter @patchbay/db exec prisma migrate deploy` → **58 tables, 40 RLS policies**, latest `20260906000005_wp12_autonomy_tier`, probe schema dropped afterwards. Log in `packages/db/wp13-ver.mjs` probe output.
- **Seed:** `pnpm db:seed` → 1 org, 9 vendors, 8 repos, 4 contract sources, 6 lifecycle cases, 13 outcomes, 7 gates, 1 validation profile. Zero secret hits on `seed.ts` grep.
- **Dump/restore (local):** `pg_dump patchbay -d patchbay > patchbay-backup.sql` (host `localhost:5432`, Postgres 15.19) → `createdb patchbay_restore && psql patchbay_restore < patchbay-backup.sql && pnpm --filter @patchbay/db exec prisma migrate deploy` (no-op, already at latest) → `psql patchbay_restore -c "select count(*) from \"Organization\""` matches source. RPO = last dump, RTO ≈ dump+restore+verify (exercise quarterly, record time here).

## Next rehearsal (staging, before pilot GA)

- Run `scripts/restore-rehearsal.sh` (to be added: `pg_dump` + `EVIDENCE_STORE_DIR` snapshot + KEK offline check → fresh host → `migrate deploy` → `health` + `operations/queues` + fixture validation). Record timestamp, duration, and `pg_restore` log here.

## Runbook pointer

Full steps: `docs/pilot-readiness.md` §5. Secret custody: KEKs offline twice, never in dump.
