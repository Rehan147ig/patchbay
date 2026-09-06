import { prisma } from "@patchbay/db";
import { notFound, validationFailed } from "@patchbay/domain";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { assertCsrfToken } from "@/lib/csrf-server";
import { POST as validatePlan } from "../../../../remediations/[id]/validate/route";

/**
 * POST /api/maintenance/cases/[id]/validate
 * Validates the case's latest plan through the canonical plan validation
 * vector (certification, capability gate, quota, profile, sandbox). A case
 * without a plan fails closed with guidance instead of validating nothing.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(request);
  try {
    assertCsrfToken(request);
    const user = await requireRole("MEMBER");
    const { id } = await params;
    const remediationCase = await prisma.remediationCase.findFirst({
      where: { id, organizationId: user.organizationId },
      include: {
        plans: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true } },
      },
    });
    if (!remediationCase) {
      throw notFound("Maintenance case not found");
    }
    const plan = remediationCase.plans[0];
    if (!plan) {
      throw validationFailed("Case has no remediation plan yet — run Plan first, then validate.");
    }
    // Same request (auth + CSRF already verified above and re-verified
    // inside); only the plan id is rebound.
    const response = await validatePlan(request, { params: Promise.resolve({ id: plan.id }) });
    if (!response.ok) return response;
    const body = (await response.json()) as { data: unknown };
    return jsonOk(
      { caseId: id, ...(typeof body.data === "object" ? body.data : {}) },
      correlationId,
      202,
    );
  } catch (error) {
    return jsonError(error, correlationId);
  }
}
