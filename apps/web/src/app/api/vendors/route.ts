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
 * Returns the shared catalog plus the caller's own private vendors — never
 * another org's private SDK registrations. Catalog entries have
 * `organizationId: null`; private entries carry the caller's org id and are
 * tagged with `visibility: "private"`.
 */
export async function GET(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  try {
    const user = await requireRole("VIEWER");
    const rawMinLevel = request.nextUrl.searchParams.get("minLevel");
    let minLevel: CapabilityLevel | null = null;
    if (rawMinLevel !== null) {
      if (!CAPABILITY_LEVELS.includes(rawMinLevel as CapabilityLevel)) {
        throw badRequest(`minLevel must be one of: ${CAPABILITY_LEVELS.join(", ")}`);
      }
      minLevel = rawMinLevel as CapabilityLevel;
    }

    const [vendors, enrollments] = await Promise.all([
      prisma.vendor.findMany({
        where: {
          OR: [{ organizationId: null }, { organizationId: user.organizationId }],
        },
        orderBy: [{ organizationId: "asc" }, { name: "asc" }],
        select: {
          id: true,
          slug: true,
          name: true,
          category: true,
          docsUrl: true,
          enabled: true,
          organizationId: true,
        },
      }),
      // Agent-mode state comes from this org's enrollments only — the legacy
      // Vendor.agentKeyHash column is no longer read (see agent-key route).
      prisma.organizationVendorEnrollment.findMany({
        where: { organizationId: user.organizationId, status: "ACTIVE" },
        select: { vendorId: true, agentKeyHash: true },
      }),
    ]);
    const keyedVendorIds = new Set(
      enrollments.filter((e) => e.agentKeyHash !== null).map((e) => e.vendorId),
    );

    const filtered = vendors.filter((vendor) => {
      if (minLevel === null) return true;
      const capability = getCapability(vendor.slug);
      if (!capability) return false;
      return CAPABILITY_LEVELS.indexOf(capability.level) >= CAPABILITY_LEVELS.indexOf(minLevel);
    });

    return jsonOk(
      {
        vendors: filtered.map(({ organizationId, ...vendor }) => {
          const capability = getCapability(vendor.slug);
          const isPrivate = organizationId !== null;
          return {
            ...vendor,
            visibility: isPrivate ? ("private" as const) : ("shared" as const),
            agentModeEnabled: keyedVendorIds.has(vendor.id),
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
