import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "./client";

/**
 * REAL-database integration test for the WORM audit guarantee (T8).
 *
 * This is the gap that let the old DELETE /api/data bug hide: unit tests mock
 * Prisma, so nothing ever exercised the actual `audit_event_worm_trigger`.
 * Skipped automatically when no database is reachable; run with env loaded:
 *
 *   npx dotenv -e .env -- pnpm vitest run packages/db/src/worm-db.test.ts
 */

const reachable = await prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false);

(reachable ? describe : describe.skip)("AuditEvent WORM trigger (real database)", () => {
  const orgId = `org-worm-${randomUUID().slice(0, 8)}`;
  const eventId = `evt-worm-${randomUUID().slice(0, 8)}`;
  let notificationId = "";

  beforeAll(async () => {
    const trigger = await prisma.$queryRaw<Array<{ tgname: string }>>`
      SELECT tgname FROM pg_trigger WHERE tgname = 'audit_event_worm_trigger'
    `;
    expect(trigger.length).toBe(1);

    await prisma.organization.create({ data: { id: orgId, name: "worm-integration-test" } });
    await prisma.auditEvent.create({
      data: {
        id: eventId,
        organizationId: orgId,
        actorType: "SYSTEM",
        actorId: null,
        action: "worm.integration_test",
        entityType: "test",
        entityId: eventId,
        correlationId: null,
      },
    });
  });

  afterAll(async () => {
    // Break-glass cleanup: disabling the trigger requires table ownership and
    // is exactly the privileged path a real anti-forensic wipe would need —
    // which is why DELETE /api/data must never take it.
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "AuditEvent" DISABLE TRIGGER audit_event_worm_trigger`,
    );
    try {
      await prisma.auditEvent.deleteMany({ where: { organizationId: orgId } });
      await prisma.organization.delete({ where: { id: orgId } }).catch(() => undefined);
    } finally {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "AuditEvent" ENABLE TRIGGER audit_event_worm_trigger`,
      );
    }
  });

  it("rejects UPDATE on AuditEvent at the database level", async () => {
    await expect(
      prisma.auditEvent.update({ where: { id: eventId }, data: { action: "tampered" } }),
    ).rejects.toThrow(/append-only \(WORM guard\)/i);
  });

  it("rejects DELETE and deleteMany on AuditEvent at the database level", async () => {
    await expect(prisma.auditEvent.delete({ where: { id: eventId } })).rejects.toThrow();
    await expect(
      prisma.auditEvent.deleteMany({ where: { organizationId: orgId } }),
    ).rejects.toThrow(/append-only \(WORM guard\)/i);
    const stillThere = await prisma.auditEvent.findUnique({ where: { id: eventId } });
    expect(stillThere?.id).toBe(eventId);
  });

  it("rolls back the whole data-wipe transaction when the audit purge fails", async () => {
    // Mirrors the DELETE /api/data shape: operational deletes + an audit purge
    // that the WORM trigger must reject — the operational deletes must roll
    // back instead of leaving a half-wiped tenant.
    notificationId = (
      await prisma.notification.create({
        data: {
          organizationId: orgId,
          type: "PLAN_CREATED",
          title: "worm-int",
          body: "rollback probe",
        },
      })
    ).id;

    await expect(
      prisma.$transaction(async (tx) => {
        await tx.notification.deleteMany({ where: { organizationId: orgId } });
        await tx.auditEvent.deleteMany({ where: { organizationId: orgId } });
      }),
    ).rejects.toThrow();

    expect(await prisma.notification.findUnique({ where: { id: notificationId } })).not.toBeNull();
  });

  it("leaves audit history intact afterwards (out-of-erasure-scope)", async () => {
    const rows = await prisma.auditEvent.findMany({ where: { organizationId: orgId } });
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });
});
