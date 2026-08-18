import { prisma } from "@patchbay/db";
import { badRequest } from "@patchbay/domain";
import {
  CAPABILITY_LEVELS,
  getCapability,
  type CapabilityLevel,
} from "@patchbay/vendor-connectors";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk } from "@/lib/api";
import { requireRole } from "@/lib/auth";

/**
 * GET /api/vendors
 * Catalog list with agent-mode status (never exposes the key itself) and the
 * capability contract (WP9): certified level, language, ecosystem, package,
 * required policy class, and certification status. Optional `minLevel` query
 * filters to vendors certified at or above a capability level.
 */
export async function GET(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  try {
    await requireRole("VIEWER");
    const rawMinLevel = request.nextUrl.searchParams.get("minLevel");
    let minLevel: CapabilityLevel | null = null;
    if (rawMinLevel !== null) {
      if (!CAPABILITY_LEVELS.includes(rawMinLevel as CapabilityLevel)) {
        throw badRequest(`minLevel must be one of: ${CAPABILITY_LEVELS.join(", ")}`);
      }
      minLevel = rawMinLevel as CapabilityLevel;
    }

    const vendors = await prisma.vendor.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        slug: true,
        name: true,
        category: true,
        docsUrl: true,
        enabled: true,
        agentKeyHash: true,
      },
    });

    const filtered = vendors.filter((vendor) => {
      if (minLevel === null) {
        return true;
      }
      const capability = getCapability(vendor.slug);
      if (!capability) {
        return false;
      }
      return CAPABILITY_LEVELS.indexOf(capability.level) >= CAPABILITY_LEVELS.indexOf(minLevel);
    });

    return jsonOk(
      {
        vendors: filtered.map(({ agentKeyHash, ...vendor }) => {
          const capability = getCapability(vendor.slug);
          return {
            ...vendor,
            agentModeEnabled: agentKeyHash !== null && agentKeyHash !== undefined,
            capability: capability
              ? {
                  level: capability.level,
                  language: capability.language,
                  ecosystem: capability.ecosystem,
                  package: capability.package,
                  requiredPolicyClass: capability.requiredPolicyClass,
                  certified: capability.certifiedAt !== null,
                  corpusStatus: capability.corpus?.status ?? null,
                  certifiedAt: capability.certifiedAt,
                }
              : null,
          };
        }),
      },
      correlationId,
    );
  } catch (error) {
    return jsonError(error, correlationId);
  }
}
