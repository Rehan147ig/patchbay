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
});
