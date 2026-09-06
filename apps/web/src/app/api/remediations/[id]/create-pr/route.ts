import { prisma } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import {
  ActorType,
  CASE_TERMINAL_STATUSES,
  CaseReasonCode,
  validationFailed,
  ValidationStatus,
} from "@patchbay/domain";
import {
  approvalCoversPatches,
  AUTONOMY_POLICY_DEFAULTS,
  evaluateAutonomyBump,
  evaluatePolicy,
} from "@patchbay/policy-engine";
import {
  AUTONOMOUS_GENERIC_SLUG,
  isAutonomousBumpPayload,
  isAutonomousDraftEligible,
  requireCertified,
} from "@patchbay/vendor-connectors";
import { enqueue, JobType } from "@patchbay/queue";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk, writeAuditEvent } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { assertCsrfToken } from "@/lib/csrf-server";
import { assertCapabilityGateOpen } from "@/lib/capability-gates";

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

    // Org scoping lives INSIDE the query (not a post-hoc check).
    const plan = await prisma.remediationPlan.findFirst({
      where: {
        id,
        impactAssessment: { repository: { organizationId: user.organizationId } },
      },
      include: {
        impactAssessment: {
          include: {
            repository: true,
            changeEvent: {
              select: { vendor: { select: { slug: true } }, rawPayload: true, detectedAt: true },
            },
            affectedUsages: { include: { usage: true } },
          },
        },
        patches: { select: { id: true, patchedContent: true } },
        validations: { select: { status: true } },
        approvals: { orderBy: { createdAt: "desc" } },
        pullRequests: true,
      },
    });

    if (!plan) throw validationFailed("Remediation plan not found");

    // Parity with cases/[id]/draft-pr: certification + kill-switch gate before
    // policy evaluation. Closes the fail-open path for suspended vendors.
    // Contract-flow assessments (WP4) carry no change event; this release
    // vector cannot serve them yet, so they fail closed here.
    const changeEvent = plan.impactAssessment.changeEvent;
    if (!changeEvent) {
      throw validationFailed("Plans without a release change event cannot create PRs here");
    }
    const vendorSlug = changeEvent.vendor.slug;
    const certification = requireCertified(vendorSlug, "DRAFT_PR");
    if (!certification.ok) {
      throw validationFailed(
        `Connector ${vendorSlug} is not certified for DRAFT_PR: ${certification.reasons.join("; ")}`,
      );
    }
    await assertCapabilityGateOpen(user.organizationId, vendorSlug, "DRAFT_PR");

    // Parity with cases/[id]/draft-pr: the autonomous strategy kit only
    // covers npm patch/minor manifest bumps. Anything else stays PLAN-only.
    if (vendorSlug === AUTONOMOUS_GENERIC_SLUG) {
      const rawPayload = changeEvent.rawPayload;
      if (!isAutonomousDraftEligible(rawPayload)) {
        throw validationFailed(
          "Autonomous draft PRs cover npm patch/minor bumps only; this change is PLAN-only",
        );
      }
      // Same Renovate-style guardrails as the cases vector. Age is measured
      // from detection time (fail-safe direction: detection never predates
      // publication). CVE provenance arrives via the emission layer's
      // vulnFix flag; absent means conservative (no bypass).
      const bumpPayload = isAutonomousBumpPayload(rawPayload) ? rawPayload : null;
      const autonomyPolicy = await prisma.autonomyPolicy.findUnique({
        where: { organizationId: user.organizationId },
      });
      const openAutonomous = await prisma.remediationCase.count({
        where: {
          organizationId: user.organizationId,
          reasonCode: CaseReasonCode.AUTONOMOUS_BUMP,
          status: { notIn: [...CASE_TERMINAL_STATUSES] },
        },
      });
      const autonomy = evaluateAutonomyBump({
        updateType: bumpPayload?.updateType ?? "unknown",
        packageName: bumpPayload?.packageName ?? "",
        publishedAt: changeEvent.detectedAt,
        isVulnFix: (bumpPayload as { vulnFix?: unknown } | null)?.vulnFix === true,
        openAutonomousCases: openAutonomous,
        policy: autonomyPolicy ?? AUTONOMY_POLICY_DEFAULTS,
      });
      if (!autonomy.ok) {
        throw validationFailed(`Autonomy policy blocks draft PR: ${autonomy.reasons.join("; ")}`);
      }
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
    // Stale approvals (expired or bound to older patches) do not count: the
    // policy engine then demands fresh approval instead of reusing them.
    const coverage = approvalCoversPatches(
      latestApproval
        ? {
            decision: latestApproval.decision,
            patchedHash: latestApproval.patchedHash,
            expiresAt: latestApproval.expiresAt,
          }
        : null,
      plan.patches.map((patch) => patch.patchedContent),
    );
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
      approvalDecision: coverage.covered ? (latestApproval?.decision ?? null) : null,
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
