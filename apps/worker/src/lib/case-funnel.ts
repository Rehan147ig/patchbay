/**
 * Policy-first case funnel (WP3). Decides, deterministically and without any
 * model spend, whether a (release, repository, dependency) becomes an
 * actionable RemediationCase:
 *
 *   1. evidence: a classification must exist with confirmed impact
 *   2. capability: the connector must be certified at >= PLAN
 *   3. policy: the tenant must not deny planning for this combination
 *
 * Denied or unsupported matches stay visible at IMPACT_CONFIRMED with a
 * reasonCode; they are never promoted and never enqueue an AgentRun.
 * Everything here is pure + idempotent; DB writes live in the caller.
 */
import { CAPABILITY_LEVEL_INDEX, type CapabilityLevel } from "@patchbay/vendor-connectors";
import { CaseReasonCode, CaseStatus, computeBlastRadius } from "@patchbay/domain";

export interface FunnelEvidence {
  /** Classification facts exist and the change is confirmed breaking. */
  hasClassification: boolean;
  breaking: boolean;
  /** Affected usage count from graph/integration evidence. */
  affectedUsageCount: number;
  /** Distinct owners among affected usages. */
  ownerCount: number;
  /** RiskTag values carried by affected usages. */
  riskTags: readonly string[];
  /** True when a READY graph snapshot exists at the dependency commit. */
  hasSnapshot: boolean;
}

export interface FunnelPolicy {
  /** Tenant policy name that forbade planning (when denied). */
  deniedByPolicy: string | null;
}

export interface FunnelDecision {
  /** Case status to persist. */
  status: CaseStatus;
  /** CaseReasonCode explaining the outcome. */
  reasonCode: string;
  /** True when the case may consume model budget (planning allowed). */
  planEligible: boolean;
  /** Blast radius score/severity computed by the domain. */
  blastRadius: { score: number; severity: string; factors: string[] };
  /** Policy snapshot stored on the case. */
  policyDecision: {
    decision: string;
    requiresHumanReview: boolean;
    deniedByPolicy: string | null;
  };
}

export interface FunnelInput {
  evidence: FunnelEvidence;
  capabilityLevel: string;
  validationProfile: string | null;
  policy: FunnelPolicy;
  humanReviewRequired: boolean;
}

/** Capability floor for planning: certification must reach PLAN. */
const MIN_PLAN_LEVEL: CapabilityLevel = "PLAN";

export function decideFunnel(input: FunnelInput): FunnelDecision {
  const { evidence } = input;

  const insufficientEvidence =
    !evidence.hasClassification || !evidence.breaking || !evidence.hasSnapshot;

  if (insufficientEvidence) {
    return {
      status: CaseStatus.IMPACT_CONFIRMED,
      reasonCode: CaseReasonCode.INSUFFICIENT_EVIDENCE,
      planEligible: false,
      blastRadius: blastRadiusOf(input),
      policyDecision: {
        decision: "hold",
        requiresHumanReview: input.humanReviewRequired,
        deniedByPolicy: null,
      },
    };
  }

  const capabilityOk =
    CAPABILITY_LEVEL_INDEX[input.capabilityLevel as CapabilityLevel] >=
    CAPABILITY_LEVEL_INDEX[MIN_PLAN_LEVEL];

  if (!capabilityOk) {
    return {
      status: CaseStatus.IMPACT_CONFIRMED,
      reasonCode: CaseReasonCode.CAPABILITY_UNSUPPORTED,
      planEligible: false,
      blastRadius: blastRadiusOf(input),
      policyDecision: {
        decision: "hold",
        requiresHumanReview: input.humanReviewRequired,
        deniedByPolicy: null,
      },
    };
  }

  if (input.policy.deniedByPolicy) {
    return {
      status: CaseStatus.IMPACT_CONFIRMED,
      reasonCode: CaseReasonCode.POLICY_DENIED,
      planEligible: false,
      blastRadius: blastRadiusOf(input),
      policyDecision: {
        decision: "deny",
        requiresHumanReview: input.humanReviewRequired,
        deniedByPolicy: input.policy.deniedByPolicy,
      },
    };
  }

  return {
    status: CaseStatus.POLICY_ELIGIBLE,
    reasonCode: CaseReasonCode.USAGE_EVIDENCE,
    planEligible: true,
    blastRadius: blastRadiusOf(input),
    policyDecision: {
      decision: input.humanReviewRequired ? "require-approval" : "auto",
      requiresHumanReview: input.humanReviewRequired,
      deniedByPolicy: null,
    },
  };
}

function blastRadiusOf(input: FunnelInput) {
  return computeBlastRadius({
    riskTags: input.evidence.riskTags,
    affectedUsageCount: input.evidence.affectedUsageCount,
    ownerCount: input.evidence.ownerCount,
    capabilityLevel: input.capabilityLevel,
    validationProfile: input.validationProfile,
  });
}
