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

  // 2. Low confidence or no patches -> ALLOW_PLAN_ONLY
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
      decision: PolicyDecision.ALLOW_PLAN_ONLY,
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
