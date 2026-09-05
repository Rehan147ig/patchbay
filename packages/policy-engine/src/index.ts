import { createHash } from "node:crypto";
import { z } from "zod";
import { PolicyDecision, RiskTag, type ApprovalDecision } from "@patchbay/domain";

export const PolicyRuleSchema = z.object({
  id: z.string(),
  name: z.string(),
  minConfidenceForPatch: z.number().min(0).max(100).default(70),
  minConfidenceForPR: z.number().min(0).max(100).default(85),
  sensitiveRiskTags: z
    .array(z.string())
    .default([RiskTag.PAYMENT, RiskTag.AUTH, RiskTag.PII, RiskTag.WEBHOOK, RiskTag.INFRASTRUCTURE]),
});
export type PolicyRule = z.infer<typeof PolicyRuleSchema>;

export const DEFAULT_POLICY: PolicyRule = {
  id: "default-safety-policy",
  name: "Default Safety & Governance Policy",
  minConfidenceForPatch: 70,
  minConfidenceForPR: 85,
  sensitiveRiskTags: [
    RiskTag.PAYMENT,
    RiskTag.AUTH,
    RiskTag.PII,
    RiskTag.WEBHOOK,
    RiskTag.INFRASTRUCTURE,
  ],
};

export interface PlanEvaluationInput {
  confidence: number;
  patchCount: number;
  requiresHumanReview: boolean;
  hasPassingValidation: boolean;
  approvalDecision?: ApprovalDecision | null;
  riskTags: string[];
  /**
   * Dual-approver quorum status for sensitive paths, computed by the caller
   * via evaluateQuorum (counts DISTINCT covering approvers). Absent = legacy
   * single-approval behavior. Present + required + unsatisfied blocks PRs.
   */
  quorum?: QuorumStatus;
}

/**
 * Risk tags that trigger the two-person rule. String-matched (not the
 * RiskTag enum) so ENCRYPTION/SECRETS — weighted by blast-radius but not yet
 * emitted by classifiers — engage quorum the moment they appear.
 */
export const SENSITIVE_QUORUM_TAGS = ["PAYMENT", "AUTH", "ENCRYPTION", "SECRETS"] as const;

/** Distinct covering approvers required when quorum tags are present. */
export const QUORUM_REQUIRED_APPROVALS = 2;

export interface QuorumApprovalInput {
  userId: string;
  decision?: ApprovalDecision | null;
  /** sha256 recorded at approval time; null = legacy approval without binding. */
  patchedHash?: string | null;
  expiresAt?: Date | string | null;
}

export interface QuorumStatus {
  required: boolean;
  satisfied: boolean;
  approverCount: number;
  requiredCount: number;
  matchedTags: string[];
  reason: string | null;
}

/**
 * Evaluates the two-person rule: when the plan touches quorum tags, at least
 * QUORUM_REQUIRED_APPROVALS DISTINCT users must hold covering approvals
 * (APPROVED + unexpired + hash-bound to the current patches, via
 * approvalCoversPatches). Same-user repeat approvals count once; expired or
 * stale-hash approvals count zero. Non-quorum plans are trivially satisfied.
 */
export function evaluateQuorum(
  approvals: ReadonlyArray<QuorumApprovalInput>,
  patchedContents: string[],
  riskTags: string[],
  now: Date = new Date(),
): QuorumStatus {
  const matchedTags = riskTags.filter((tag) =>
    (SENSITIVE_QUORUM_TAGS as readonly string[]).includes(tag),
  );
  if (matchedTags.length === 0) {
    return {
      required: false,
      satisfied: true,
      approverCount: 0,
      requiredCount: 0,
      matchedTags: [],
      reason: null,
    };
  }
  const approvers = new Set<string>();
  for (const approval of approvals) {
    if (approval.decision !== "APPROVED") continue;
    const coverage = approvalCoversPatches(
      {
        decision: approval.decision,
        patchedHash: approval.patchedHash,
        expiresAt: approval.expiresAt,
      },
      patchedContents,
      now,
    );
    if (coverage.covered) approvers.add(approval.userId);
  }
  const satisfied = approvers.size >= QUORUM_REQUIRED_APPROVALS;
  return {
    required: true,
    satisfied,
    approverCount: approvers.size,
    requiredCount: QUORUM_REQUIRED_APPROVALS,
    matchedTags,
    reason: satisfied
      ? null
      : `Dual-approver quorum: ${approvers.size}/${QUORUM_REQUIRED_APPROVALS} distinct approvals (${matchedTags.join(", ")})`,
  };
}

export interface PolicyEvaluationResult {
  decision: PolicyDecision;
  reasons: string[];
  matchedPolicyIds: string[];
  canCreatePR: boolean;
}

/**
  Evaluates a remediation plan against deterministic safety policies.
 */
export function evaluatePolicy(
  plan: PlanEvaluationInput,
  policy: PolicyRule = DEFAULT_POLICY,
): PolicyEvaluationResult {
  const reasons: string[] = [];
  const matchedPolicyIds: string[] = [policy.id];

  // 1. Rejected plans are explicitly DENIED
  if (plan.approvalDecision === "REJECTED") {
    reasons.push("Plan approval was explicitly rejected by reviewer");
    return {
      decision: PolicyDecision.DENY,
      reasons,
      matchedPolicyIds,
      canCreatePR: false,
    };
  }

  // 2. Low confidence or no patches -> PLAN_ONLY
  if (plan.patchCount === 0 || plan.confidence < policy.minConfidenceForPatch) {
    if (plan.patchCount === 0) {
      reasons.push("No automated patches generated; plan-only remediation");
    }
    if (plan.confidence < policy.minConfidenceForPatch) {
      reasons.push(
        `Confidence (${plan.confidence}) is below patch threshold (${policy.minConfidenceForPatch})`,
      );
    }
    return {
      decision: PolicyDecision.PLAN_ONLY,
      reasons,
      matchedPolicyIds,
      canCreatePR: false,
    };
  }

  // 3. Sensitive risk tags or requiresHumanReview -> REQUIRE_APPROVAL (unless APPROVED)
  const matchedSensitiveTags = plan.riskTags.filter((tag) =>
    policy.sensitiveRiskTags.includes(tag),
  );
  const needsApproval = plan.requiresHumanReview || matchedSensitiveTags.length > 0;

  if (needsApproval && plan.approvalDecision !== "APPROVED") {
    if (matchedSensitiveTags.length > 0) {
      reasons.push(`Plan affects sensitive risk tags: ${matchedSensitiveTags.join(", ")}`);
    }
    if (plan.requiresHumanReview) {
      reasons.push("Plan explicitly requires human review");
    }
    return {
      decision: PolicyDecision.REQUIRE_APPROVAL,
      reasons,
      matchedPolicyIds,
      canCreatePR: false,
    };
  }

  // 3b. Dual-approver quorum for sensitive paths (PAYMENT/AUTH/ENCRYPTION/
  // SECRETS): two DISTINCT covering approvers, or no PR — even when a single
  // approval and validation are otherwise sufficient.
  if (plan.quorum && plan.quorum.required && !plan.quorum.satisfied) {
    reasons.push(
      plan.quorum.reason ??
        `Dual-approver quorum: ${plan.quorum.approverCount}/${plan.quorum.requiredCount} distinct approvals`,
    );
    return {
      decision: PolicyDecision.REQUIRE_APPROVAL,
      reasons,
      matchedPolicyIds,
      canCreatePR: false,
    };
  }

  // 4. Must pass validation before PR creation
  if (!plan.hasPassingValidation) {
    reasons.push("Validation run required and must pass before PR creation");
    return {
      decision: PolicyDecision.ALLOW_VALIDATE,
      reasons,
      matchedPolicyIds,
      canCreatePR: false,
    };
  }

  // 5. Validation passed and approval granted (or not required) -> ALLOW_DRAFT_PR
  if (needsApproval && plan.approvalDecision === "APPROVED") {
    reasons.push("Human approval granted and validation passed");
  } else {
    reasons.push("Validation passed and no approval required");
  }

  return {
    decision: PolicyDecision.ALLOW_DRAFT_PR,
    reasons,
    matchedPolicyIds,
    canCreatePR: true,
  };
}

export * from "./circuit-breaker";
export { AUTONOMY_POLICY_DEFAULTS, evaluateAutonomyBump } from "./autonomy";
export type {
  AutonomyBumpInput,
  AutonomyDecision,
  AutonomyPolicyShape,
  AutonomyUpdateType,
} from "./autonomy";
export {
  evaluatePromotionEligibility,
  PROMOTION_DEFAULT_STREAK,
  PROMOTION_DEFAULT_WINDOW_DAYS,
} from "./promotion";
export type {
  PromotionEligibility,
  PromotionEligibilityInput,
  PromotionEvidence,
  PromotionOutcomeInput,
  PromotionOutcomeStatus,
} from "./promotion";

/** Approvals expire 7 days after recording; stale approvals never unblock PRs. */
export const APPROVAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Deterministic hash of a plan's current patched contents (sorted, joined). */
export function hashPatchedContents(patchedContents: string[]): string {
  return createHash("sha256")
    .update([...patchedContents].sort().join("\n"))
    .digest("hex");
}

export interface ApprovalCoverageInput {
  decision?: ApprovalDecision | null;
  /** sha256 recorded at approval time; null = legacy approval without binding. */
  patchedHash?: string | null;
  expiresAt?: Date | string | null;
}

export interface ApprovalCoverage {
  covered: boolean;
  reason: string | null;
}

/**
 * Decides whether a recorded approval still covers the plan's CURRENT patches.
 * An approval covers only when it is APPROVED, unexpired, and (when bound)
 * its hash matches the current patched contents. A regenerated plan therefore
 * invalidates old approvals instead of silently reusing them.
 */
export function approvalCoversPatches(
  approval: ApprovalCoverageInput | null | undefined,
  patchedContents: string[],
  now: Date = new Date(),
): ApprovalCoverage {
  if (!approval || approval.decision !== "APPROVED") {
    return { covered: false, reason: "no recorded approval" };
  }
  if (approval.expiresAt) {
    const expiry =
      approval.expiresAt instanceof Date ? approval.expiresAt : new Date(approval.expiresAt);
    if (Number.isFinite(expiry.getTime()) && expiry.getTime() <= now.getTime()) {
      return { covered: false, reason: "approval expired; re-approval required" };
    }
  }
  if (approval.patchedHash !== undefined && approval.patchedHash !== null) {
    const current = hashPatchedContents(patchedContents);
    if (current !== approval.patchedHash) {
      return {
        covered: false,
        reason: "plan patches changed since approval; re-approval required",
      };
    }
  }
  return { covered: true, reason: null };
}
