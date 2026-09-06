import { prisma } from "@patchbay/db";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk } from "@/lib/api";
import { requireRole } from "@/lib/auth";

/**
 * GET /api/operations/capabilities
 * Capability gate status for the caller's org (WP12 §11.2): gate rows with
 * health-relevant fields (status, reason, consecutive breach counts,
 * suspension timestamps) joined against the global connector certification
 * catalog. VIEWER and above — monitoring surface, no sensitive payloads.
 */
export async function GET(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  try {
    const user = await requireRole("VIEWER");
    const [gates, certifications] = await Promise.all([
      prisma.capabilityGate.findMany({
        where: { organizationId: user.organizationId },
        orderBy: [{ vendorSlug: "asc" }, { level: "asc" }],
      }),
      prisma.connectorCertification.findMany({
        where: { status: "CERTIFIED" },
        orderBy: [{ connectorSlug: "asc" }, { capability: "asc" }],
      }),
    ]);
    return jsonOk({ gates, certifications }, correlationId);
  } catch (error) {
    return jsonError(error, correlationId);
  }
}
