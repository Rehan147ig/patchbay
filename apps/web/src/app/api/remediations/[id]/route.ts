import { prisma } from "@patchbay/db";
import { notFound } from "@patchbay/domain";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk } from "@/lib/api";
import { requireRole } from "@/lib/auth";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(request);
  try {
    const user = await requireRole("VIEWER");
    const { id } = await params;

    const plan = await prisma.remediationPlan.findFirst({
      where: { id, impactAssessment: { repository: { organizationId: user.organizationId } } },
      include: {
        impactAssessment: {
          include: {
            changeEvent: { include: { vendor: true, normalizations: true } },
            repository: true,
            affectedUsages: { include: { usage: true } },
          },
        },
        patches: true,
        validations: { orderBy: { createdAt: "asc" } },
        pullRequests: true,
        approvals: { include: { user: true }, orderBy: { createdAt: "desc" } },
      },
    });

    if (!plan) throw notFound("Remediation plan not found");
    return jsonOk({ plan }, correlationId);
  } catch (error) {
    return jsonError(error, correlationId);
  }
}
