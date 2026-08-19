import { prisma } from "./client";
import { AuditAction } from "@patchbay/audit";
import { ActorType } from "@patchbay/domain";
import { buildAuditEvent } from "@patchbay/audit";

/**
 * Notification types written by the worker jobs and web routes. Keep the
 * list closed: the bell and /notifications render these, nothing else.
 */
export const NotificationType = {
  SCAN_COMPLETED: "scan.completed",
  SCAN_FAILED: "scan.failed",
  CASE_CREATED: "case.created",
  PLAN_CREATED: "plan.created",
  PR_CREATED: "pull_request.created",
  CAPABILITY_GATE_SUSPENDED: "capability_gate.suspended",
} as const;
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];

/**
 * Single write path for in-app notifications: persists the row AND an audit
 * event so notification creation itself is part of the immutable trail.
 * Called only where the worker/web already mutates state (scan, case/plan,
 * draft PR, capability suspension).
 */
export async function createNotification(input: {
  organizationId: string;
  type: NotificationType;
  title: string;
  body?: string;
  correlationId?: string;
}): Promise<void> {
  const record = await prisma.notification.create({
    data: {
      organizationId: input.organizationId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      correlationId: input.correlationId ?? null,
    },
    select: { id: true },
  });
  const audit = buildAuditEvent({
    organizationId: input.organizationId,
    actorType: ActorType.SYSTEM,
    actorId: null,
    action: AuditAction.NOTIFICATION_CREATED,
    entityType: "notification",
    entityId: record.id,
    correlationId: input.correlationId ?? null,
    after: { type: input.type, title: input.title },
  });
  await prisma.auditEvent.create({
    data: {
      id: audit.id,
      organizationId: audit.organizationId,
      actorType: audit.actorType,
      actorId: audit.actorId,
      action: audit.action,
      entityType: audit.entityType,
      entityId: audit.entityId,
      correlationId: audit.correlationId,
      beforeJson: audit.beforeJson as never,
      afterJson: audit.afterJson as never,
      metadata: (audit.metadata as never) ?? undefined,
      createdAt: audit.createdAt,
    },
  });
}
