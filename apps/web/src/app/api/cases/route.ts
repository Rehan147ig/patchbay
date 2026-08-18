import { prisma } from "@patchbay/db";
import { z } from "zod";
import { CaseStatus } from "@patchbay/domain";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk, parseQuery } from "@/lib/api";
import { requireRole } from "@/lib/auth";

const listQuerySchema = z.object({
  status: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

/**
 * GET /api/cases
 * Tenant-scoped remediation case list, newest first. Optional status filter
 * (e.g. ?status=POLICY_ELIGIBLE), limit + cursor pagination.
 */
export async function GET(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  try {
    const user = await requireRole("MEMBER");
    const query = parseQuery(request, listQuerySchema);

    const where = {
      organizationId: user.organizationId,
      ...(query.status ? { status: query.status as CaseStatus } : {}),
      ...(query.cursor ? { createdAt: { lt: new Date(query.cursor) } } : {}),
    };

    const cases = await prisma.remediationCase.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: query.limit + 1,
      select: {
        id: true,
        scopeKey: true,
        status: true,
        reasonCode: true,
        capabilityLevel: true,
        blastRadius: true,
        correlationId: true,
        createdAt: true,
        updatedAt: true,
        release: {
          select: {
            id: true,
            version: true,
            product: { select: { packageName: true, vendor: { select: { slug: true } } } },
          },
        },
        repository: { select: { id: true, fullName: true } },
        dependency: { select: { id: true, resolvedVersion: true } },
      },
    });

    const hasMore = cases.length > query.limit;
    const rows = hasMore ? cases.slice(0, query.limit) : cases;

    return jsonOk(
      {
        cases: rows,
        nextCursor: hasMore ? rows[rows.length - 1]!.createdAt.toISOString() : null,
      },
      correlationId,
    );
  } catch (error) {
    return jsonError(error, correlationId);
  }
}
