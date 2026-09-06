import { prisma } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import {
  ActorType,
  CASE_TERMINAL_STATUSES,
  CaseReasonCode,
  CaseStatus,
  classifySemverBump,
  notFound,
  validationFailed,
  PlanStatus,
} from "@patchbay/domain";
import {
  approvalCoversPatches,
  AUTONOMY_POLICY_DEFAULTS,
  evaluateAutonomyBump,
  evaluatePolicy,
  evaluateQuorum,
} from "@patchbay/policy-engine";
import { AUTONOMOUS_GENERIC_SLUG, requireCertified } from "@patchbay/vendor-connectors";
import { enqueue, JobType } from "@patchbay/queue";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk, writeAuditEvent } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { assertCsrfToken } from "@/lib/csrf-server";
import { assertCapabilityGateOpen } from "@/lib/capability-gates";

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
        release: {
          select: {
            product: {
              select: { vendor: { select: { slug: true } }, packageName: true },
            },
            version: true,
            previousVersion: true,
            publishedAt: true,
          },
        },
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
    // Contract-driven cases (WP4) carry no release row; the release PR vector
    // cannot serve them yet. Fail closed instead of dereferencing null.
    const release = remediationCase.release;
    if (!release) {
      throw validationFailed("Contract-driven cases cannot draft PRs through the release vector");
    }

    const vendorSlug = release.product.vendor.slug;
    const certification = requireCertified(vendorSlug, "DRAFT_PR");
    if (!certification.ok) {
      throw validationFailed(
        `Connector ${vendorSlug} is not certified for DRAFT_PR: ${certification.reasons.join("; ")}`,
      );
    }
    await assertCapabilityGateOpen(user.organizationId, vendorSlug, "DRAFT_PR");

    // Autonomous track: the strategy kit only covers npm patch/minor manifest
    // bumps. Majors stay PLAN-only (migration rules may be needed); anything
    // unclassifiable is refused rather than guessed. Enforced identically at
    // the remediations create-pr vector.
    if (vendorSlug === AUTONOMOUS_GENERIC_SLUG) {
      const bump = release.previousVersion
        ? classifySemverBump(release.previousVersion, release.version)
        : "unknown";
      if (bump !== "patch" && bump !== "minor") {
        throw validationFailed(
          `Autonomous draft PRs cover npm patch/minor bumps only (release ${release.previousVersion ?? "?"} -> ${release.version} classifies as ${bump})`,
        );
      }
      // Renovate-style guardrails: exclusions, concurrency cap, minimum
      // release age. Missing policy row falls back to safe defaults.
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
        updateType: bump,
        packageName: release.product.packageName,
        publishedAt: release.publishedAt,
        isVulnFix: false,
        openAutonomousCases: openAutonomous,
        policy: autonomyPolicy ?? AUTONOMY_POLICY_DEFAULTS,
      });
      if (!autonomy.ok) {
        throw validationFailed(`Autonomy policy blocks draft PR: ${autonomy.reasons.join("; ")}`);
      }
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
    const latestApproval = plan.approvals[0];
    const patchedContents = plan.patches.map((patch) => patch.patchedContent);
    const coverage = approvalCoversPatches(
      latestApproval
        ? {
            decision: latestApproval.decision,
            patchedHash: latestApproval.patchedHash,
            expiresAt: latestApproval.expiresAt,
          }
        : null,
      patchedContents,
    );
    // Two-person rule: quorum-tagged plans need two DISTINCT covering
    // approvers; a lone approval (even valid) must not open a draft PR.
    const quorum = evaluateQuorum(
      plan.approvals.map((approval) => ({
        userId: approval.userId,
        decision: approval.decision,
        patchedHash: approval.patchedHash,
        expiresAt: approval.expiresAt,
      })),
      patchedContents,
      riskTags,
    );
    const policy = evaluatePolicy({
      confidence: plan.confidence,
      patchCount: plan.patches.length,
      requiresHumanReview: plan.requiresHumanReview,
      hasPassingValidation: plan.validations.some((v) => v.status === "PASSED"),
      approvalDecision: coverage.covered ? (latestApproval?.decision ?? null) : null,
      riskTags,
      quorum,
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
