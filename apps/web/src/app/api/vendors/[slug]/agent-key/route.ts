import { prisma } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import { ActorType, forbidden, notFound } from "@patchbay/domain";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk, writeAuditEvent } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { assertCsrfToken } from "@/lib/csrf-server";
import { generateAgentKey, hashAgentKey, isLegacyAgentKeyHash } from "@/lib/agent-keys";

/**
 * POST /api/vendors/:slug/agent-key
 *
 * Issues a provider-agent API key for a vendor, scoped to the caller's
 * organization. ADMIN only. The plaintext key is returned exactly once;
 * Patchbay stores only its argon2id hash on the caller's
 * OrganizationVendorEnrollment row — never on the shared catalog Vendor row,
 * so N organizations can enroll the same vendor with independent keys.
 * Re-issuing is a rotation: the current hash moves to agentKeyHashPrevious
 * so agents holding the old key stay authenticated until the next rotation.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const correlationId = getCorrelationId(request);
  try {
    assertCsrfToken(request);
    const user = await requireRole("ADMIN");
    const { slug } = await params;

    const vendor = await prisma.vendor.findUnique({ where: { slug } });
    if (!vendor) throw notFound(`Vendor "${slug}" is not in the catalog`);
    if (vendor.organizationId && vendor.organizationId !== user.organizationId) {
      throw forbidden("Vendor is not owned by your organization");
    }

    const agentKey = generateAgentKey();
    const agentKeyHash = await hashAgentKey(agentKey);
    // Credentials live on this org's enrollment row, keyed by
    // (organizationId, vendorId). The shared catalog row is never mutated
    // and never claimed: a second organization enrolling the same slug gets
    // its own row and its own keys.
    const existing = await prisma.organizationVendorEnrollment.findUnique({
      where: {
        organizationId_vendorId: { organizationId: user.organizationId, vendorId: vendor.id },
      },
    });
    const rotated = existing?.status === "ACTIVE" && existing.agentKeyHash !== null;
    await prisma.organizationVendorEnrollment.upsert({
      where: {
        organizationId_vendorId: { organizationId: user.organizationId, vendorId: vendor.id },
      },
      create: {
        organizationId: user.organizationId,
        vendorId: vendor.id,
        agentKeyHash,
        status: "ACTIVE",
      },
      update: {
        agentKeyHash,
        agentKeyHashPrevious: existing?.agentKeyHash ?? null,
        status: "ACTIVE",
      },
    });

    await writeAuditEvent({
      organizationId: user.organizationId,
      actorType: ActorType.USER,
      actorId: user.id,
      action: AuditAction.AGENT_KEY_ISSUED,
      entityType: "vendor",
      entityId: vendor.id,
      correlationId,
      after: {
        vendorSlug: slug,
        mode: rotated ? "rotated" : "issued",
      },
    });

    return jsonOk(
      {
        vendorSlug: slug,
        agentKey,
        note: "Store this key now; it will never be shown again.",
      },
      correlationId,
      201,
    );
  } catch (error) {
    return jsonError(error, correlationId);
  }
}

/**
 * DELETE /api/vendors/:slug/agent-key
 *
 * Revokes provider-agent mode for the caller's enrollment. ADMIN only. Both
 * key hashes are cleared and the enrollment flips to REVOKED so every
 * outstanding key stops authenticating immediately; the row is kept as
 * history (re-issue reactivates it). Other organizations' enrollments on the
 * same shared slug are untouched. Idempotent: revoking an already-disabled
 * enrollment succeeds without a write or audit event.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const correlationId = getCorrelationId(request);
  try {
    assertCsrfToken(request);
    const user = await requireRole("ADMIN");
    const { slug } = await params;

    const vendor = await prisma.vendor.findUnique({ where: { slug } });
    if (!vendor) throw notFound(`Vendor "${slug}" is not in the catalog`);
    if (vendor.organizationId && vendor.organizationId !== user.organizationId) {
      throw forbidden("Vendor is not owned by your organization");
    }

    const enrollment = await prisma.organizationVendorEnrollment.findUnique({
      where: {
        organizationId_vendorId: { organizationId: user.organizationId, vendorId: vendor.id },
      },
    });
    if (
      !enrollment ||
      enrollment.status !== "ACTIVE" ||
      (!enrollment.agentKeyHash && !enrollment.agentKeyHashPrevious)
    ) {
      return jsonOk({ vendorSlug: slug, status: "ALREADY_DISABLED" }, correlationId);
    }

    await prisma.organizationVendorEnrollment.update({
      where: { id: enrollment.id },
      data: { agentKeyHash: null, agentKeyHashPrevious: null, status: "REVOKED" },
    });

    await writeAuditEvent({
      organizationId: user.organizationId,
      actorType: ActorType.USER,
      actorId: user.id,
      action: AuditAction.AGENT_KEY_REVOKED,
      entityType: "vendor",
      entityId: vendor.id,
      correlationId,
      after: {
        vendorSlug: slug,
        legacyHashBurned: enrollment.agentKeyHash
          ? isLegacyAgentKeyHash(enrollment.agentKeyHash)
          : false,
      },
    });

    return jsonOk({ vendorSlug: slug, status: "REVOKED", agentModeEnabled: false }, correlationId);
  } catch (error) {
    return jsonError(error, correlationId);
  }
}
