import { describe, expect, it } from "vitest";
import { CaseReasonCode, CaseStatus } from "@patchbay/domain";
import { decideFunnel, type FunnelInput } from "./case-funnel";

const base: FunnelInput = {
  evidence: {
    hasClassification: true,
    breaking: true,
    affectedUsageCount: 2,
    ownerCount: 1,
    riskTags: [],
    hasSnapshot: true,
  },
  capabilityLevel: "DRAFT_PR",
  validationProfile: "node-ts-reparse + container-sandbox",
  policy: { deniedByPolicy: null },
  humanReviewRequired: false,
};

describe("decideFunnel", () => {
  it("promotes a fully-supported breaking match to POLICY_ELIGIBLE", () => {
    const decision = decideFunnel(base);
    expect(decision.status).toBe(CaseStatus.POLICY_ELIGIBLE);
    expect(decision.planEligible).toBe(true);
    expect(decision.reasonCode).toBe(CaseReasonCode.USAGE_EVIDENCE);
    expect(decision.blastRadius.score).toBeGreaterThanOrEqual(0);
    expect(decision.policyDecision.decision).toBe("auto");
  });

  it("requires human review when the classification says so", () => {
    const decision = decideFunnel({ ...base, humanReviewRequired: true });
    expect(decision.status).toBe(CaseStatus.POLICY_ELIGIBLE);
    expect(decision.policyDecision.requiresHumanReview).toBe(true);
    expect(decision.policyDecision.decision).toBe("require-approval");
  });

  it("holds at IMPACT_CONFIRMED without classification or snapshot", () => {
    for (const evidence of [
      { ...base.evidence, hasClassification: false },
      { ...base.evidence, breaking: false },
      { ...base.evidence, hasSnapshot: false },
    ]) {
      const decision = decideFunnel({ ...base, evidence });
      expect(decision.status).toBe(CaseStatus.IMPACT_CONFIRMED);
      expect(decision.planEligible).toBe(false);
      expect(decision.reasonCode).toBe(CaseReasonCode.INSUFFICIENT_EVIDENCE);
    }
  });

  it("holds with CAPABILITY_UNSUPPORTED below PLAN certification", () => {
    for (const capabilityLevel of ["DETECT", "ASSESS"]) {
      const decision = decideFunnel({ ...base, capabilityLevel });
      expect(decision.status).toBe(CaseStatus.IMPACT_CONFIRMED);
      expect(decision.planEligible).toBe(false);
      expect(decision.reasonCode).toBe(CaseReasonCode.CAPABILITY_UNSUPPORTED);
    }
  });

  it("holds with POLICY_DENIED when tenant policy forbids planning", () => {
    const decision = decideFunnel({
      ...base,
      policy: { deniedByPolicy: "strict-change-policy" },
    });
    expect(decision.status).toBe(CaseStatus.IMPACT_CONFIRMED);
    expect(decision.planEligible).toBe(false);
    expect(decision.reasonCode).toBe(CaseReasonCode.POLICY_DENIED);
    expect(decision.policyDecision.deniedByPolicy).toBe("strict-change-policy");
  });

  it("escalates blast radius on risk tags and usage spread", () => {
    const decision = decideFunnel({
      ...base,
      evidence: {
        ...base.evidence,
        riskTags: ["PAYMENT", "AUTH"],
        affectedUsageCount: 12,
        ownerCount: 3,
      },
    });
    expect(decision.blastRadius.severity).toBe("HIGH");
    expect(decision.blastRadius.factors.join(" ")).toContain("risk tags");
  });

  it("promotes sandbox-proven autonomous patch/minor bumps without breaking evidence", () => {
    for (const updateType of ["patch", "minor"] as const) {
      const decision = decideFunnel({
        ...base,
        evidence: {
          ...base.evidence,
          hasClassification: false,
          breaking: false,
          hasSnapshot: false,
          affectedUsageCount: 0,
          autonomousBump: { updateType, sandboxValidated: true },
        },
      });
      expect(decision.status).toBe(CaseStatus.POLICY_ELIGIBLE);
      expect(decision.planEligible).toBe(true);
      expect(decision.reasonCode).toBe(CaseReasonCode.AUTONOMOUS_BUMP);
      // Approval stays mandatory downstream: funnel only grants eligibility.
      expect(decision.policyDecision.decision).toBe("require-approval");
      expect(decision.policyDecision.requiresHumanReview).toBe(true);
    }
  });

  it("refuses autonomous bumps without sandbox proof, for majors, or under policy denial", () => {
    // No sandbox proof: falls through to the breaking-evidence path and holds.
    const unproven = decideFunnel({
      ...base,
      evidence: {
        ...base.evidence,
        breaking: false,
        autonomousBump: { updateType: "patch", sandboxValidated: false },
      },
    });
    expect(unproven.planEligible).toBe(false);
    expect(unproven.reasonCode).toBe(CaseReasonCode.INSUFFICIENT_EVIDENCE);

    // Majors stay PLAN-only even when sandbox-proven.
    const major = decideFunnel({
      ...base,
      evidence: {
        ...base.evidence,
        breaking: false,
        autonomousBump: { updateType: "major", sandboxValidated: true },
      },
    });
    expect(major.planEligible).toBe(false);

    // Tenant policy denial outranks the autonomous track.
    const denied = decideFunnel({
      ...base,
      policy: { deniedByPolicy: "freeze" },
      evidence: {
        ...base.evidence,
        breaking: false,
        autonomousBump: { updateType: "patch", sandboxValidated: true },
      },
    });
    expect(denied.planEligible).toBe(false);
    expect(denied.reasonCode).toBe(CaseReasonCode.POLICY_DENIED);
  });
});
