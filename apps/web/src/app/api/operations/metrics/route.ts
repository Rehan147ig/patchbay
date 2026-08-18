import { prisma } from "@patchbay/db";
import { computeOrganizationMetrics } from "@patchbay/operations";
import { z } from "zod";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk, parseQuery } from "@/lib/api";
import { requireRole } from "@/lib/auth";

/**
 * GET /api/operations/metrics
 * SLO / operations rollup (WP10) for the caller's organization over a
 * configurable rolling window (1-365 days, default 30).
 */

const metricsQuerySchema = z.object({
  windowDays: z.coerce.number().int().min(1).max(365).default(30),
});

export async function GET(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  try {
    const user = await requireRole("VIEWER");
    const { windowDays } = parseQuery(request, metricsQuerySchema);

    const metrics = await computeOrganizationMetrics(prisma, {
      organizationId: user.organizationId,
      windowDays,
    });

    return jsonOk({ metrics }, correlationId);
  } catch (error) {
    return jsonError(error, correlationId);
  }
}
