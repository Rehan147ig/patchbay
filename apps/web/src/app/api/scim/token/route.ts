import { prisma } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import { ActorType, notFound } from "@patchbay/domain";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk, writeAuditEvent } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { assertCsrfToken } from "@/lib/csrf-server";
import { generateScimToken, hashScimToken, scimTokenLookupPrefix } from "@/lib/scim-tokens";

/**
 * POST /api/scim/token
 *
 * Issues the organization's SCIM 2.0 bearer token for Okta/Azure AD. ADMIN
 * only. The plaintext token is returned exactly once; Patchbay stores only
 * its argon2id hash plus a plaintext lookup prefix. Re-issuing is a rotation:
 * the current hash moves to scimTokenHashPrevious so the IdP holding the old
 * token stays authenticated until the next rotation.
 */
export async function POST(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  try {
    assertCsrfToken(request);
    const user = await requireRole("ADMIN");

    const organization = await prisma.organization.findUnique({
      where: { id: user.organizationId },
      select: { id: true, scimTokenHash: true },
    });
    if (!organization) {
      throw notFound("Organization not found");
    }

    const token = generateScimToken();
    const scimTokenHash = await hashScimToken(token);
    await prisma.organization.update({
      where: { id: organization.id },
      data: {
        scimTokenHash,
        scimTokenHashPrevious: organization.scimTokenHash,
        scimTokenPrefix: scimTokenLookupPrefix(token),
        scimTokenRotatedAt: new Date(),
      },
    });

    await writeAuditEvent({
      organizationId: user.organizationId,
      actorType: ActorType.USER,
      actorId: user.id,
      action: AuditAction.SCIM_TOKEN_ISSUED,
      entityType: "organization",
      entityId: organization.id,
      correlationId,
      after: { mode: organization.scimTokenHash ? "rotated" : "issued" },
    });

    return jsonOk(
      {
        scimToken: token,
        tokenPrefix: scimTokenLookupPrefix(token),
        note: "Store this token in your IdP now; it will never be shown again.",
      },
      correlationId,
      201,
    );
  } catch (error) {
    return jsonError(error, correlationId);
  }
}

/**
 * DELETE /api/scim/token
 *
 * Revokes SCIM for the organization. ADMIN only. Both hashes are cleared so
 * every outstanding token stops authenticating immediately. Idempotent:
 * revoking when no token is enrolled succeeds without a write or audit event.
 */
export async function DELETE(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  try {
    assertCsrfToken(request);
    const user = await requireRole("ADMIN");

    const organization = await prisma.organization.findUnique({
      where: { id: user.organizationId },
      select: { id: true, scimTokenHash: true, scimTokenHashPrevious: true },
    });
    if (!organization) {
      throw notFound("Organization not found");
    }
    if (!organization.scimTokenHash && !organization.scimTokenHashPrevious) {
      return jsonOk({ status: "ALREADY_DISABLED" }, correlationId);
    }

    await prisma.organization.update({
      where: { id: organization.id },
      data: {
        scimTokenHash: null,
        scimTokenHashPrevious: null,
        scimTokenPrefix: null,
        scimTokenRotatedAt: null,
      },
    });

    await writeAuditEvent({
      organizationId: user.organizationId,
      actorType: ActorType.USER,
      actorId: user.id,
      action: AuditAction.SCIM_TOKEN_REVOKED,
      entityType: "organization",
      entityId: organization.id,
      correlationId,
      after: {},
    });

    return jsonOk({ status: "REVOKED" }, correlationId);
  } catch (error) {
    return jsonError(error, correlationId);
  }
}
