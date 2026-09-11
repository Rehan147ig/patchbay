import { prisma } from "./client";

/**
 * Shared least-privilege probe role for real-database tests (RLS negatives,
 * enrollment isolation, WORM guards).
 *
 * The dev DATABASE_URL connects as a superuser, and superusers bypass RLS
 * entirely (even FORCE) — so negative tests run as this NOSUPERUSER role,
 * exactly like the production app role. Created idempotently with a
 * dev-only credential (patchbay_dev_only precedent).
 *
 * Concurrency note: several test files call ensureProbeRole() in parallel
 * workers, and concurrent GRANTs on the shared catalog can abort with
 * XX000 "tuple concurrently updated". The setup therefore retries with
 * backoff instead of assuming a quiet database.
 */

export const PROBE_USER = "patchbay_rls_probe";
const PROBE_PASSWORD = "rls_probe_dev_only";

export function probeUrl(): string {
  const base = process.env.DATABASE_URL ?? "";
  const url = new URL(base);
  url.username = PROBE_USER;
  url.password = PROBE_PASSWORD;
  return url.toString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function ensureProbeRole(attempts = 5): Promise<void> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await prisma.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${PROBE_USER}') THEN
        CREATE ROLE "${PROBE_USER}" WITH LOGIN PASSWORD '${PROBE_PASSWORD}' NOSUPERUSER NOCREATEDB NOCREATEROLE;
      END IF;
    END
    $$`);
      await prisma.$executeRawUnsafe(`GRANT CONNECT ON DATABASE patchbay TO "${PROBE_USER}"`);
      await prisma.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO "${PROBE_USER}"`);
      await prisma.$executeRawUnsafe(`GRANT ALL ON ALL TABLES IN SCHEMA public TO "${PROBE_USER}"`);
      await prisma.$executeRawUnsafe(
        `GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO "${PROBE_USER}"`,
      );
      return;
    } catch (error) {
      lastError = error;
      await sleep(100 * attempt);
    }
  }
  throw lastError;
}
