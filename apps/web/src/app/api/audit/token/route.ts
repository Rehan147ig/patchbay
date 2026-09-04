import { prisma } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import { ActorType, notFound } from "@patchbay/domain";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk, writeAuditEvent } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { assertCsrfToken } from "@/lib/csrf-server";
import {
  auditExportTokenLookupPrefix,
  generateAuditExportToken,
  hashAuditExportToken,
} from "@/lib/audit-export-tokens";

/**
 * POST /api/audit/token
 *
 * Issues the organization's SIEM audit-export bearer token (`pb_audit_`).
 * ADMIN only. The plaintext token is returned exactly once; Patchbay stores
 * only its argon2id hash plus a plaintext lookup prefix. Re-issuing is a
 * rotation: the current hash moves to auditExportTokenHashPrevious so SOC
 * automation holding the old token keeps working until the next rotation.
 */
export async function POST(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  try {
    assertCsrfToken(request);
    const user = await requireRole("ADMIN");

    const organization = await prisma.organization.findUnique({
      where: { id: user.organizationId },
      select: { id: true, auditExportTokenHash: true },
    });
    if (!organization) throw notFound("Organization not found");

    const token = generateAuditExportToken();
    const auditExportTokenHash = await hashAuditExportToken(token);
    await prisma.organization.update({
      where: { id: organization.id },
      data: {
        auditExportTokenHash,
        auditExportTokenHashPrevious: organization.auditExportTokenHash,
        auditExportTokenPrefix: auditExportTokenLookupPrefix(token),
        auditExportTokenRotatedAt: new Date(),
      },
    });

    await writeAuditEvent({
      organizationId: user.organizationId,
      actorType: ActorType.USER,
      actorId: user.id,
      action: AuditAction.AUDIT_EXPORT_TOKEN_ISSUED,
      entityType: "organization",
      entityId: organization.id,
      correlationId,
      after: { mode: organization.auditExportTokenHash ? "rotated" : "issued" },
    });

    return jsonOk(
      {
        auditExportToken: token,
        tokenPrefix: auditExportTokenLookupPrefix(token),
        note: "Store this token in your SIEM now; it will never be shown again.",
      },
      correlationId,
      201,
    );
  } catch (error) {
    return jsonError(error, correlationId);
  }
}

/**
 * DELETE /api/audit/token
 *
 * Revokes SIEM export for the organization. ADMIN only. Both hashes are
 * cleared so every outstanding token stops authenticating immediately.
 * Idempotent: revoking when no token is enrolled succeeds without a write.
 */
export async function DELETE(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  try {
    assertCsrfToken(request);
    const user = await requireRole("ADMIN");

    const organization = await prisma.organization.findUnique({
      where: { id: user.organizationId },
      select: {
        id: true,
        auditExportTokenHash: true,
        auditExportTokenHashPrevious: true,
      },
    });
    if (!organization) throw notFound("Organization not found");
    if (!organization.auditExportTokenHash && !organization.auditExportTokenHashPrevious) {
      return jsonOk({ status: "ALREADY_DISABLED" }, correlationId);
    }

    await prisma.organization.update({
      where: { id: organization.id },
      data: {
        auditExportTokenHash: null,
        auditExportTokenHashPrevious: null,
        auditExportTokenPrefix: null,
        auditExportTokenRotatedAt: null,
      },
    });

    await writeAuditEvent({
      organizationId: user.organizationId,
      actorType: ActorType.USER,
      actorId: user.id,
      action: AuditAction.AUDIT_EXPORT_TOKEN_REVOKED,
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
