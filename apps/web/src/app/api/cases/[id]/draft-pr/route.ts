import { prisma } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import { ActorType, CaseStatus, notFound, validationFailed, PlanStatus } from "@patchbay/domain";
import { evaluatePolicy } from "@patchbay/policy-engine";
import { capabilityAtLeast } from "@patchbay/vendor-connectors";
import { enqueue, JobType } from "@patchbay/queue";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk, writeAuditEvent } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { assertCsrfToken } from "@/lib/csrf-server";

/**
 * POST /api/cases/[id]/draft-pr
 * Queues CREATE_PR for the case's latest validated plan. Gate: the case must
 * be PATCH_PROPOSED/APPROVAL_REQUIRED (or already DRAFT_PR_CREATED, which is
 * idempotent), the connector must be certified at DRAFT_PR, and policy must
 * permit a draft PR (validation passed + approval on record). Nothing is
 * enqueued otherwise; the create-pr job re-evaluates the same gates.
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
        release: { select: { product: { select: { vendor: { select: { slug: true } } } } } },
        plans: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: {
            impactAssessment: {
              include: { affectedUsages: { include: { usage: { select: { riskTags: true } } } } },
            },
            patches: true,
            validations: true,
            approvals: { orderBy: { createdAt: "desc" } },
            pullRequests: true,
          },
        },
      },
    });
    if (!remediationCase) {
      throw notFound("Remediation case not found");
    }

    if (!capabilityAtLeast(remediationCase.release.product.vendor.slug, "DRAFT_PR")) {
      throw validationFailed(
        `Connector ${remediationCase.release.product.vendor.slug} is not certified for DRAFT_PR`,
      );
    }

    const plan = remediationCase.plans[0];
    if (!plan) {
      throw validationFailed("No remediation plan exists for this case");
    }

    const existingPR = plan.pullRequests[0];
    if (existingPR) {
      return jsonOk(
        {
          caseId: remediationCase.id,
          pullRequestId: existingPR.id,
          url: existingPR.url,
          replay: true,
        },
        correlationId,
      );
    }

    if (plan.status !== PlanStatus.VALIDATED) {
      throw validationFailed(`Plan must be VALIDATED before a draft PR (current: ${plan.status})`);
    }

    const riskTags = Array.from(
      new Set(
        plan.impactAssessment.affectedUsages.flatMap((u) => (u.usage.riskTags as string[]) ?? []),
      ),
    ) as string[];
    const policy = evaluatePolicy({
      confidence: plan.confidence,
      patchCount: plan.patches.length,
      requiresHumanReview: plan.requiresHumanReview,
      hasPassingValidation: plan.validations.some((v) => v.status === "PASSED"),
      approvalDecision: plan.approvals[0]?.decision ?? null,
      riskTags,
    });
    if (!policy.canCreatePR) {
      throw validationFailed(`Policy blocks draft PR: ${policy.reasons.join("; ")}`);
    }

    await enqueue(JobType.CREATE_PR, {
      remediationPlanId: plan.id,
      organizationId: user.organizationId,
      correlationId,
    });

    await prisma.remediationCaseEvent.create({
      data: {
        organizationId: user.organizationId,
        remediationCaseId: remediationCase.id,
        status: remediationCase.status as CaseStatus,
        reasonCode: remediationCase.reasonCode,
        detailJson: { remediationPlanId: plan.id, policyDecision: policy.decision },
        correlationId,
      },
    });
    await writeAuditEvent({
      organizationId: user.organizationId,
      actorType: ActorType.USER,
      actorId: user.id,
      action: AuditAction.CASE_DRAFT_PR_QUEUED,
      entityType: "remediationCase",
      entityId: remediationCase.id,
      correlationId,
      after: { remediationPlanId: plan.id, policyDecision: policy.decision },
    });

    return jsonOk(
      { caseId: remediationCase.id, remediationPlanId: plan.id, queued: true },
      correlationId,
      202,
    );
  } catch (error) {
    return jsonError(error, correlationId);
  }
}
