import { prisma, withOrgContext } from "@patchbay/db";
import { ActorType, CapabilityGateStatus, validationFailed } from "@patchbay/domain";
import { CAPABILITY_LEVELS, getCapability } from "@patchbay/vendor-connectors";
import { setCapabilityGate } from "@patchbay/operations";
import { z } from "zod";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk, parseBody } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { assertCsrfToken } from "@/lib/csrf-server";

/**
 * GET /api/capability-gates
 * Lists the org's runtime capability kill switches (rows exist only for
 * vendors whose gate differs from the default ACTIVE or was explicitly set).
 *
 * POST /api/capability-gates
 * Admin kill switch: suspend or restore a certified capability level for the
 * organization. Suspended gates block draft-PR / validation enqueueing until
 * an admin restores them (auto-suspend sets the same row).
 */

const gateSchema = z.object({
  vendorSlug: z.string().min(1),
  level: z.enum(CAPABILITY_LEVELS),
  action: z.enum(["suspend", "restore"]),
  reason: z.string().max(500).optional(),
});

export async function GET(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  try {
    const user = await requireRole("VIEWER");
    const db = withOrgContext(prisma, user.organizationId);
    const gates = await db.capabilityGate.findMany({
      where: { organizationId: user.organizationId },
      orderBy: { updatedAt: "desc" },
    });
    return jsonOk({ gates }, correlationId);
  } catch (error) {
    return jsonError(error, correlationId);
  }
}

export async function POST(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  try {
    assertCsrfToken(request);
    const user = await requireRole("ADMIN");
    const body = await parseBody(request, gateSchema);

    if (!getCapability(body.vendorSlug)) {
      throw validationFailed(`Unknown vendor: ${body.vendorSlug}`);
    }

    const result = await setCapabilityGate(prisma, {
      organizationId: user.organizationId,
      vendorSlug: body.vendorSlug,
      level: body.level,
      status:
        body.action === "suspend" ? CapabilityGateStatus.SUSPENDED : CapabilityGateStatus.ACTIVE,
      reason:
        body.action === "suspend"
          ? (body.reason ?? "Suspended by administrator")
          : (body.reason ?? null),
      correlationId,
      actorType: ActorType.USER,
      actorId: user.id,
    });

    return jsonOk(
      {
        vendorSlug: body.vendorSlug,
        level: body.level,
        status: result.status,
        changed: result.changed,
      },
      correlationId,
    );
  } catch (error) {
    return jsonError(error, correlationId);
  }
}
