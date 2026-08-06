import { prisma } from "@patchbay/db";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk } from "@/lib/api";
import { requireRole } from "@/lib/auth";

/**
 * GET /api/vendors
 * Catalog list with agent-mode status (never exposes the key itself).
 */
export async function GET(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  try {
    await requireRole("VIEWER");
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
    return jsonOk(
      {
        vendors: vendors.map(({ agentKeyHash, ...vendor }) => ({
          ...vendor,
          agentModeEnabled: agentKeyHash !== null && agentKeyHash !== undefined,
        })),
      },
      correlationId,
    );
  } catch (error) {
    return jsonError(error, correlationId);
  }
}
