import { prisma } from "@patchbay/db";
import { paginationSchema } from "@patchbay/domain";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk, parseQuery } from "@/lib/api";
import { requireRole } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  try {
    const user = await requireRole("VIEWER");
    const { offset, limit } = parseQuery(request, paginationSchema);

    const [events, total] = await Promise.all([
      prisma.auditEvent.findMany({
        where: { organizationId: user.organizationId },
        orderBy: { createdAt: "desc" },
        skip: offset,
        take: limit,
      }),
      prisma.auditEvent.count({ where: { organizationId: user.organizationId } }),
    ]);

    return jsonOk({ events, total, offset, limit }, correlationId);
  } catch (error) {
    return jsonError(error, correlationId);
  }
}
