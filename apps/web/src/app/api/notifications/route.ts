import { prisma, withOrgContext } from "@patchbay/db";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk } from "@/lib/api";
import { requireRole } from "@/lib/auth";

/**
 * GET /api/notifications
 * Lists the org's in-app notifications (newest first, capped at 50) plus the
 * unread count for the bell badge. Read-only; no audit event is written.
 */

export async function GET(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  try {
    const user = await requireRole("VIEWER");
    const db = withOrgContext(prisma, user.organizationId);
    const [notifications, unreadCount] = await Promise.all([
      db.notification.findMany({
        where: { organizationId: user.organizationId },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          type: true,
          title: true,
          body: true,
          isRead: true,
          createdAt: true,
        },
      }),
      db.notification.count({ where: { organizationId: user.organizationId, isRead: false } }),
    ]);
    return jsonOk({ notifications, unreadCount }, correlationId);
  } catch (error) {
    return jsonError(error, correlationId);
  }
}
