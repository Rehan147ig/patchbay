import { prisma } from "@patchbay/db";
import { notFound } from "@patchbay/domain";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk } from "@/lib/api";
import { requireRole } from "@/lib/auth";

/**
 * GET /api/maintenance/cases/[id]
 * Full case detail (WP12 §11.2): timeline events, source change evidence,
 * impact assessments, recent plans with validations (incl. artifacts),
 * approvals, PRs, policy decisions, and attempts. VIEWER and above.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(request);
  try {
    const user = await requireRole("VIEWER");
    const { id } = await params;
    const remediationCase = await prisma.remediationCase.findFirst({
      where: { id, organizationId: user.organizationId },
      include: {
        repository: { select: { id: true, name: true, fullName: true, defaultBranch: true } },
        release: {
          select: {
            id: true,
            version: true,
            previousVersion: true,
            product: { select: { packageName: true, vendor: { select: { slug: true } } } },
          },
        },
        events: { orderBy: { createdAt: "asc" }, take: 50 },
        impactAssessments: {
          orderBy: { createdAt: "desc" },
          take: 5,
          include: {
            changeEvent: { select: { id: true, title: true } },
            _count: { select: { affectedUsages: true } },
          },
        },
        plans: {
          orderBy: { createdAt: "desc" },
          take: 5,
          include: {
            patches: { select: { id: true, filePath: true } },
            validations: {
              orderBy: { createdAt: "desc" },
              take: 3,
              include: { artifact: true },
            },
            approvals: { orderBy: { createdAt: "desc" }, take: 5 },
            pullRequests: true,
          },
        },
        policyDecisions: { orderBy: { evaluatedAt: "desc" }, take: 5 },
        attempts: { orderBy: { createdAt: "desc" }, take: 10 },
      },
    });
    if (!remediationCase) {
      throw notFound("Maintenance case not found");
    }
    return jsonOk({ case: remediationCase }, correlationId);
  } catch (error) {
    return jsonError(error, correlationId);
  }
}
