import { prisma } from "@patchbay/db";
import { buildAuditEvent, type AuditEventInput } from "@patchbay/audit";

/**
 * Persists an audit event from the worker. Mirrors the web app's
 * writeAuditEvent; redaction is applied by buildAuditEvent.
 */
export async function writeAuditEvent(input: AuditEventInput): Promise<void> {
  const record = buildAuditEvent({
    organizationId: input.organizationId,
    actorType: input.actorType,
    actorId: input.actorId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    correlationId: input.correlationId,
    before: input.before,
    after: input.after,
    metadata: input.metadata,
  });
  await prisma.auditEvent.create({
    data: {
      id: record.id,
      organizationId: record.organizationId,
      actorType: record.actorType,
      actorId: record.actorId,
      action: record.action,
      entityType: record.entityType,
      entityId: record.entityId,
      correlationId: record.correlationId,
      beforeJson: record.beforeJson as never,
      afterJson: record.afterJson as never,
      metadata: (record.metadata as never) ?? undefined,
      createdAt: record.createdAt,
    },
  });
}
