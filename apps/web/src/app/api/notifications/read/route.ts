import { prisma, withOrgContext } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import { ActorType, notFound } from "@patchbay/domain";
import { z } from "zod";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk, parseBody, writeAuditEvent } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { assertCsrfToken } from "@/lib/csrf-server";

/**
 * POST /api/notifications/read
 * Marks one of the org's notifications as read (idempotent). Cross-org ids
 * resolve to 404 — the org filter is applied before the update.
 */

const markReadSchema = z.object({
  notificationId: z.string().min(1),
});

export async function POST(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  try {
    assertCsrfToken(request);
    const user = await requireRole("MEMBER");
    const body = await parseBody(request, markReadSchema);
    const db = withOrgContext(prisma, user.organizationId);

    const notification = await db.notification.findFirst({
      where: { id: body.notificationId, organizationId: user.organizationId },
      select: { id: true, isRead: true },
    });
    if (!notification) {
      throw notFound("Notification not found");
    }

    const updated = await db.notification.update({
      where: { id: notification.id },
      data: { isRead: true, readAt: new Date() },
      select: { id: true, isRead: true, readAt: true },
    });

    await writeAuditEvent({
      organizationId: user.organizationId,
      actorType: ActorType.USER,
      actorId: user.id,
      action: AuditAction.NOTIFICATION_MARKED_READ,
      entityType: "notification",
      entityId: notification.id,
      correlationId,
      after: { isRead: updated.isRead, readAt: updated.readAt?.toISOString() ?? null },
    });

    return jsonOk({ id: updated.id, isRead: updated.isRead }, correlationId);
  } catch (error) {
    return jsonError(error, correlationId);
  }
}
