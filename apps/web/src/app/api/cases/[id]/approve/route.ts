import { prisma } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import {
  ActorType,
  ApprovalDecision,
  CaseReasonCode,
  CaseStatus,
  notFound,
  validationFailed,
} from "@patchbay/domain";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk, writeAuditEvent } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { assertCsrfToken } from "@/lib/csrf-server";

/**
 * POST /api/cases/[id]/approve
 * Records an explicit owner approval on the case's latest remediation plan
 * and moves the case to PATCH_PROPOSED. Approval alone never creates a PR —
 * the draft-pr action re-evaluates policy (capability DRAFT_PR, validation
 * passed, approval on record) before anything is queued.
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
        plans: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { id: true, requiresHumanReview: true },
        },
      },
    });
    if (!remediationCase) {
      throw notFound("Remediation case not found");
    }
    if (remediationCase.status !== CaseStatus.APPROVAL_REQUIRED) {
      throw validationFailed(
        `Approval is only valid for APPROVAL_REQUIRED cases (current: ${remediationCase.status})`,
      );
    }
    const plan = remediationCase.plans[0];
    if (!plan) {
      throw validationFailed("No remediation plan exists for this case to approve");
    }

    await prisma.approval.upsert({
      where: {
        remediationPlanId_userId_decision: {
          remediationPlanId: plan.id,
          userId: user.id,
          decision: ApprovalDecision.APPROVED,
        },
      },
      create: {
        organizationId: user.organizationId,
        remediationPlanId: plan.id,
        userId: user.id,
        decision: ApprovalDecision.APPROVED,
        note: `Approved via remediation case ${remediationCase.id}`,
      },
      update: { note: `Approved via remediation case ${remediationCase.id}` },
    });

    const updated = await prisma.remediationCase.update({
      where: { id: remediationCase.id },
      data: {
        status: CaseStatus.PATCH_PROPOSED,
        reasonCode: CaseReasonCode.APPROVED,
      },
    });

    await prisma.remediationCaseEvent.create({
      data: {
        organizationId: user.organizationId,
        remediationCaseId: remediationCase.id,
        status: CaseStatus.PATCH_PROPOSED,
        reasonCode: CaseReasonCode.APPROVED,
        detailJson: { remediationPlanId: plan.id, userId: user.id },
        correlationId,
      },
    });
    await writeAuditEvent({
      organizationId: user.organizationId,
      actorType: ActorType.USER,
      actorId: user.id,
      action: AuditAction.CASE_APPROVED,
      entityType: "remediationCase",
      entityId: remediationCase.id,
      correlationId,
      after: { status: updated.status, remediationPlanId: plan.id },
    });

    return jsonOk(
      { caseId: remediationCase.id, status: updated.status, remediationPlanId: plan.id },
      correlationId,
    );
  } catch (error) {
    return jsonError(error, correlationId);
  }
}
