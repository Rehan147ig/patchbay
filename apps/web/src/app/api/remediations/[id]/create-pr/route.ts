import { prisma } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import { ActorType, ValidationStatus, validationFailed } from "@patchbay/domain";
import { evaluatePolicy } from "@patchbay/policy-engine";
import { enqueue, JobType } from "@patchbay/queue";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk, writeAuditEvent } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { assertCsrfToken } from "@/lib/csrf";

/**
 * POST /api/remediations/[id]/create-pr
 * Evaluates policy governance and enqueues draft PR creation via the worker.
 * Includes PR creation idempotency guard to prevent duplicate PRs for the same plan.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(request);
  try {
    assertCsrfToken(request);
    const user = await requireRole("MEMBER");
    const { id } = await params;

    const plan = await prisma.remediationPlan.findUnique({
      where: { id },
      include: {
        impactAssessment: {
          include: {
            repository: true,
            affectedUsages: { include: { usage: true } },
          },
        },
        patches: { select: { id: true } },
        validations: { select: { status: true } },
        approvals: { orderBy: { createdAt: "desc" } },
        pullRequests: true,
      },
    });

    if (!plan) throw validationFailed("Remediation plan not found");
    if (plan.impactAssessment.repository.organizationId !== user.organizationId) {
      throw validationFailed("Remediation plan not found");
    }

    // Idempotency check: Return existing PR if already created
    if (plan.pullRequests.length > 0) {
      const existingPR = plan.pullRequests[0]!;
      return jsonOk(
        {
          remediationPlanId: plan.id,
          pullRequestId: existingPR.id,
          status: existingPR.status,
          url: existingPR.url,
          idempotent: true,
        },
        correlationId,
        200,
      );
    }

    const latestApproval = plan.approvals[0];
    const hasPassingValidation = plan.validations.some(
      (val) => val.status === ValidationStatus.PASSED,
    );
    const riskTags = Array.from(
      new Set(
        plan.impactAssessment.affectedUsages.flatMap(
          (item) => (item.usage.riskTags as string[]) ?? [],
        ),
      ),
    );

    const policyResult = evaluatePolicy({
      confidence: plan.confidence,
      patchCount: plan.patches.length,
      requiresHumanReview: plan.requiresHumanReview,
      hasPassingValidation,
      approvalDecision: latestApproval?.decision ?? null,
      riskTags,
    });

    if (!policyResult.canCreatePR) {
      await writeAuditEvent({
        organizationId: user.organizationId,
        actorType: ActorType.USER,
        actorId: user.id,
        action: AuditAction.POLICY_BLOCKED,
        entityType: "remediationPlan",
        entityId: plan.id,
        correlationId,
        after: { policyDecision: policyResult.decision, reasons: policyResult.reasons },
      });
      throw validationFailed(
        `Policy decision '${policyResult.decision}': ${policyResult.reasons.join("; ")}`,
      );
    }

    await enqueue(
      JobType.CREATE_PR,
      {
        remediationPlanId: plan.id,
        organizationId: user.organizationId,
        correlationId,
      },
      { jobId: `create-pr-${plan.id}` }, // BullMQ job deduplication
    );

    await writeAuditEvent({
      organizationId: user.organizationId,
      actorType: ActorType.USER,
      actorId: user.id,
      action: AuditAction.POLICY_DECISION,
      entityType: "remediationPlan",
      entityId: plan.id,
      correlationId,
      after: { policyDecision: policyResult.decision, reasons: policyResult.reasons },
    });

    return jsonOk(
      { remediationPlanId: plan.id, status: "QUEUED", policyDecision: policyResult.decision },
      correlationId,
      202,
    );
  } catch (error) {
    return jsonError(error, correlationId);
  }
}
