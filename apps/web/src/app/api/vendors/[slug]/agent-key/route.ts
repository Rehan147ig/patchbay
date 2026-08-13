import { prisma } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import { ActorType, forbidden, notFound } from "@patchbay/domain";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk, writeAuditEvent } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { assertCsrfToken } from "@/lib/csrf-server";
import { generateAgentKey, hashAgentKey } from "@/lib/agent-keys";

/**
 * POST /api/vendors/:slug/agent-key
 *
 * Issues a provider-agent API key for a vendor. ADMIN only. The plaintext key is
 * returned exactly once; Patchbay stores only its sha256 hash.
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
    await prisma.vendor.update({
      where: { id: vendor.id },
      data: {
        organizationId: user.organizationId,
        // Rotation: the current hash becomes the previous hash so agents still
        // holding the old key keep authenticating during the rollout window.
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
      after: { vendorSlug: slug },
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
