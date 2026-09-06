import { prisma } from "@patchbay/db";
import { CaseStatus, validationFailed, type CaseStatus as CaseStatusType } from "@patchbay/domain";
import { z } from "zod";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk, parseQuery } from "@/lib/api";
import { requireRole } from "@/lib/auth";

/**
 * GET /api/maintenance/cases
 * Canonical maintenance case queue (WP12 §11.2): org-scoped, filterable by
 * status and repository, paginated. VIEWER and above.
 */
const casesQuerySchema = z.object({
  status: z.string().min(1).max(30).optional(),
  repositoryId: z.string().min(1).max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const CASE_STATUSES = Object.values(CaseStatus);

export async function GET(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  try {
    const user = await requireRole("VIEWER");
    const query = parseQuery(request, casesQuerySchema);
    if (query.status !== undefined && !(CASE_STATUSES as string[]).includes(query.status)) {
      throw validationFailed(`Unknown case status: ${query.status}`);
    }
    const where = {
      organizationId: user.organizationId,
      ...(query.status ? { status: query.status as CaseStatusType } : {}),
      ...(query.repositoryId ? { repositoryId: query.repositoryId } : {}),
    };
    const [total, cases] = await Promise.all([
      prisma.remediationCase.count({ where }),
      prisma.remediationCase.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          repository: { select: { id: true, name: true, fullName: true } },
          release: { select: { id: true, version: true } },
          plans: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, status: true } },
        },
      }),
    ]);
    return jsonOk(
      { cases, pagination: { page: query.page, pageSize: query.pageSize, total } },
      correlationId,
    );
  } catch (error) {
    return jsonError(error, correlationId);
  }
}
