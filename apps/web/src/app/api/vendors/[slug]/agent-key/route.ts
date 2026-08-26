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
 * Issues a provider-agent API key for a vendor. ADMIN only. The plaintext key is
 * returned exactly once; Patchbay stores only its argon2id hash. Re-issuing on a
 * keyed vendor is a rotation: the current hash moves to agentKeyHashPrevious so
 * agents holding the old key stay authenticated until the next rotation.
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
    // Issuing a key CLAIMS the vendor for this organization. Shared catalog
    // entries (organizationId null) become org-bound on first key issue.
    // Known MVP limitation: one org per shared catalog vendor. A proper
    // VendorAgentCredential join table is deferred to post-revenue.
    await prisma.vendor.update({
      where: { id: vendor.id },
      data: {
        organizationId: user.organizationId,
        agentKeyHash,
        agentKeyHashPrevious: vendor.agentKeyHash,
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
        mode: vendor.agentKeyHash ? "rotated" : "issued",
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
 * Revokes provider-agent mode for a vendor. ADMIN only. Both key hashes are
 * cleared so every outstanding key stops authenticating immediately; the
 * organization claim on the vendor is kept. Idempotent: revoking an
 * already-disabled vendor succeeds without a write or audit event.
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

    if (!vendor.agentKeyHash && !vendor.agentKeyHashPrevious) {
      return jsonOk({ vendorSlug: slug, status: "ALREADY_DISABLED" }, correlationId);
    }

    await prisma.vendor.update({
      where: { id: vendor.id },
      data: { agentKeyHash: null, agentKeyHashPrevious: null },
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
        legacyHashBurned: vendor.agentKeyHash ? isLegacyAgentKeyHash(vendor.agentKeyHash) : false,
      },
    });

    return jsonOk({ vendorSlug: slug, status: "REVOKED", agentModeEnabled: false }, correlationId);
  } catch (error) {
    return jsonError(error, correlationId);
  }
}
