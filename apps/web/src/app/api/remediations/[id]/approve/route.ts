import { z } from "zod";
import { prisma } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import { ActorType, ApprovalDecision, validationFailed } from "@patchbay/domain";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk, writeAuditEvent } from "@/lib/api";
import { requireRole } from "@/lib/auth";

const ApproveRequestSchema = z.object({
  decision: z.enum([ApprovalDecision.APPROVED, ApprovalDecision.REJECTED]),
  note: z.string().max(1000).optional(),
});

/**
 * POST /api/remediations/[id]/approve
 * Records a human reviewer decision (APPROVED or REJECTED) against a remediation plan.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(request);
  try {
    const user = await requireRole("MEMBER");
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const parsed = ApproveRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw validationFailed(`Invalid request body: ${parsed.error.message}`);
    }

    const plan = await prisma.remediationPlan.findUnique({
      where: { id },
      include: { impactAssessment: { include: { repository: true } } },
    });
    if (!plan) throw validationFailed("Remediation plan not found");
    if (plan.impactAssessment.repository.organizationId !== user.organizationId) {
      throw validationFailed("Remediation plan not found");
    }

    const approval = await prisma.approval.create({
      data: {
        organizationId: user.organizationId,
        remediationPlanId: plan.id,
        userId: user.id,
        decision: parsed.data.decision,
        note: parsed.data.note,
      },
    });

    await writeAuditEvent({
      organizationId: user.organizationId,
      actorType: ActorType.USER,
      actorId: user.id,
      action: AuditAction.APPROVAL_RECORDED,
      entityType: "remediationPlan",
      entityId: plan.id,
      correlationId,
      after: { approvalId: approval.id, decision: approval.decision, note: approval.note },
    });

    return jsonOk(
      { approvalId: approval.id, remediationPlanId: plan.id, decision: approval.decision },
      correlationId,
    );
  } catch (error) {
    return jsonError(error, correlationId);
  }
}
