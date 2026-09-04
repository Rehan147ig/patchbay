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
  /** Declared dependency range (e.g. "^16.0.0"); null when unknown. */
  declaredRange?: string | null;
  /** Release version being assessed (e.g. "17.0.0"); null when unknown. */
  releaseVersion?: string | null;
  /**
   * Autonomous semver-bump track: set when the change is a manifest-only
   * version bump rather than a breaking migration. patch/minor + sandbox
   * proof bypasses the breaking-change evidence requirement (there are no
   * affected usages by design); majors/unknowns fall through to the normal
   * breaking-evidence path and stay PLAN-only.
   */
  autonomousBump?: {
    updateType: "patch" | "minor" | "major" | "unknown";
    sandboxValidated: boolean;
  } | null;
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

  // Autonomous track: a proven manifest-only patch/minor bump needs no
  // breaking-change evidence (there are no call-site usages by design).
  // Proof is two-stage: the detector proves the deterministic edit applies
  // cleanly to the real manifest bytes (sandboxValidated here), and the
  // container sandbox re-proves it at VALIDATE time before any PR — while
  // approval stays mandatory downstream (APPROVAL_REQUIRED policy class +
  // draft-only product rule). This branch only makes the case plan-eligible.
  const autonomousEligible =
    (evidence.autonomousBump?.updateType === "patch" ||
      evidence.autonomousBump?.updateType === "minor") &&
    evidence.autonomousBump.sandboxValidated === true;
  if (autonomousEligible) {
    return {
      status: CaseStatus.POLICY_ELIGIBLE,
      reasonCode: CaseReasonCode.AUTONOMOUS_BUMP,
      planEligible: true,
      blastRadius: blastRadiusOf(input),
      policyDecision: {
        decision: "require-approval",
        requiresHumanReview: true,
        deniedByPolicy: null,
      },
    };
  }

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
    declaredRange: input.evidence.declaredRange ?? null,
    releaseVersion: input.evidence.releaseVersion ?? null,
  });
}
