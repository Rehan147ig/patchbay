import { prisma } from "./client";

/**
 * Stage 3: RLS defense-in-depth.
 * Sets the transaction-local `app.current_organization_id` so the DB-level
 * policies created in `20260902000000_rls_foundation` enforce tenant isolation
 * even if application code forgets a where clause.
 *
 * Usage:
 *   await withRlsContext(prisma, organizationId, async (tx) => {
 *     return tx.repository.findMany({}); // RLS guarantees rows are scoped
 *   });
 *
 * Combines with `withOrgContext` — withOrgContext is the primary guard (app
 * rewrites `where`), RLS is the backup (DB rejects leaks). Both should be used
 * for defense-in-depth on sensitive paths (checkout, plan creation, case transitions).
 */
export async function withRlsContext<T>(
  organizationId: string,
  fn: (tx: typeof prisma) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    // SET LOCAL is transaction-scoped; it does not leak to the pool.
    await tx.$executeRawUnsafe(
      `SET LOCAL app.current_organization_id = '${organizationId.replace(/'/g, "''")}'`,
    );
    return fn(tx as typeof prisma);
  });
}

/**
 * Low-level: set RLS context on an existing interactive transaction.
 * Prefer withRlsContext when you can create the transaction.
 */
export async function setRlsContext(
  tx: { $executeRawUnsafe: (sql: string) => Promise<unknown> },
  organizationId: string,
): Promise<void> {
  await tx.$executeRawUnsafe(
    `SET LOCAL app.current_organization_id = '${organizationId.replace(/'/g, "''")}'`,
  );
}
