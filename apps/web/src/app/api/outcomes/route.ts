import { prisma, withOrgContext } from "@patchbay/db";
import { paginationSchema, PrOutcomeClassification, PrOutcomeStatus } from "@patchbay/domain";
import { z } from "zod";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk, parseQuery } from "@/lib/api";
import { requireRole } from "@/lib/auth";

/**
 * GET /api/outcomes
 * Lists structured PR outcomes (WP10) for the caller's organization, newest
 * first, with the pull request, plan, case, and vendor slug attached so the
 * UI can attribute every result to its capability and change event.
 */

const outcomeQuerySchema = z.object({
  status: z.nativeEnum(PrOutcomeStatus).optional(),
  classification: z.nativeEnum(PrOutcomeClassification).optional(),
});

export async function GET(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  try {
    const user = await requireRole("VIEWER");
    const query = parseQuery(request, outcomeQuerySchema);
    const { offset, limit } = parseQuery(request, paginationSchema);

    const db = withOrgContext(prisma, user.organizationId);

    const [outcomes, total] = await Promise.all([
      db.prOutcome.findMany({
        where: {
          organizationId: user.organizationId,
          ...(query.status ? { status: query.status } : {}),
          ...(query.classification ? { classification: query.classification } : {}),
        },
        orderBy: { createdAt: "desc" },
        skip: offset,
        take: limit,
        include: {
          pullRequest: {
            select: {
              id: true,
              url: true,
              branchName: true,
              status: true,
              remediationPlan: {
                select: {
                  id: true,
                  confidence: true,
                  requiresHumanReview: true,
                  impactAssessment: {
                    select: {
                      changeEvent: {
                        select: {
                          title: true,
                          sourceUrl: true,
                          vendor: { select: { slug: true, name: true } },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          case: { select: { id: true, status: true, scopeKey: true } },
        },
      }),
      db.prOutcome.count({ where: { organizationId: user.organizationId } }),
    ]);

    return jsonOk({ outcomes, total, offset, limit }, correlationId);
  } catch (error) {
    return jsonError(error, correlationId);
  }
}
