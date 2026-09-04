import { prisma, withOrgContext } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import { ActorType, notFound, PatchbayError, validationFailed } from "@patchbay/domain";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk, writeAuditEvent } from "@/lib/api";
import { rotateSessions } from "@/lib/session-rotation";
import { resolveScimOrganizationId } from "../route";

/**
 * PATCH /api/scim/Users/:id — SCIM deprovisioning (`{"active": false}`).
 * The Friday-afternoon test: revokes every session immediately by bumping
 * sessionVersion and deleting NextAuth sessions, then records
 * SCIM_USER_DEPROVISIONED. Only deactivation is supported; anything else is
 * a 422. DELETE is an alias for the same deprovision.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(request);
  try {
    const orgId = await resolveScimOrganizationId(request);
    if (!orgId) {
      throw new PatchbayError("unauthorized", { statusCode: 401, code: "UNAUTHORIZED" });
    }
    const { id } = await params;
    const body = (await request.json()) as Record<string, unknown>;
    if (body.active !== false) {
      throw validationFailed('Only deactivation is supported ({"active": false})');
    }
    const db = withOrgContext(prisma, orgId);
    const user = await db.user.findFirst({ where: { id } });
    if (!user) throw notFound("User not found in this organization");
    await rotateSessions(user.id);
    await writeAuditEvent({
      organizationId: orgId,
      actorType: ActorType.SYSTEM,
      actorId: null,
      action: AuditAction.SCIM_USER_DEPROVISIONED,
      entityType: "user",
      entityId: user.id,
      correlationId,
      after: { email: user.email, scim: true },
    });
    return jsonOk({ id: user.id, userName: user.email, active: false }, correlationId);
  } catch (error) {
    return jsonError(error, correlationId);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const correlationId = getCorrelationId(request);
  try {
    const orgId = await resolveScimOrganizationId(request);
    if (!orgId) {
      throw new PatchbayError("unauthorized", { statusCode: 401, code: "UNAUTHORIZED" });
    }
    const { id } = await params;
    const db = withOrgContext(prisma, orgId);
    const user = await db.user.findFirst({ where: { id } });
    if (!user) throw notFound("User not found in this organization");
    await rotateSessions(user.id);
    await writeAuditEvent({
      organizationId: orgId,
      actorType: ActorType.SYSTEM,
      actorId: null,
      action: AuditAction.SCIM_USER_DEPROVISIONED,
      entityType: "user",
      entityId: user.id,
      correlationId,
      after: { email: user.email, scim: true, via: "DELETE" },
    });
    return jsonOk({ id: user.id, userName: user.email, active: false }, correlationId);
  } catch (error) {
    return jsonError(error, correlationId);
  }
}
