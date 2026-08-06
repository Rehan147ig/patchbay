import { describe, expect, it } from "vitest";
import { evaluatePolicy } from "./index";
import { PolicyDecision, RiskTag } from "@patchbay/domain";

describe("evaluatePolicy", () => {
  it("denies plans explicitly rejected by a reviewer", () => {
    const result = evaluatePolicy({
      confidence: 90,
      patchCount: 1,
      requiresHumanReview: false,
      hasPassingValidation: true,
      approvalDecision: "REJECTED",
      riskTags: [],
    });

    expect(result.decision).toBe(PolicyDecision.DENY);
    expect(result.canCreatePR).toBe(false);
    expect(result.reasons).toContain("Plan approval was explicitly rejected by reviewer");
  });

  it("returns ALLOW_PLAN_ONLY when confidence is below threshold or no patches", () => {
    const lowConf = evaluatePolicy({
      confidence: 65,
      patchCount: 1,
      requiresHumanReview: false,
      hasPassingValidation: false,
      riskTags: [],
    });
    expect(lowConf.decision).toBe(PolicyDecision.ALLOW_PLAN_ONLY);

    const noPatches = evaluatePolicy({
      confidence: 90,
      patchCount: 0,
      requiresHumanReview: false,
      hasPassingValidation: false,
      riskTags: [],
    });
    expect(noPatches.decision).toBe(PolicyDecision.ALLOW_PLAN_ONLY);
  });

  it("requires approval when sensitive risk tags (PAYMENT, AUTH) are present", () => {
    const result = evaluatePolicy({
      confidence: 90,
      patchCount: 1,
      requiresHumanReview: false,
      hasPassingValidation: true,
      riskTags: [RiskTag.PAYMENT],
    });

    expect(result.decision).toBe(PolicyDecision.REQUIRE_APPROVAL);
    expect(result.canCreatePR).toBe(false);
  });

  it("returns ALLOW_VALIDATE when approval is not required but validation has not passed", () => {
    const result = evaluatePolicy({
      confidence: 90,
      patchCount: 1,
      requiresHumanReview: false,
      hasPassingValidation: false,
      riskTags: [],
    });

    expect(result.decision).toBe(PolicyDecision.ALLOW_VALIDATE);
    expect(result.canCreatePR).toBe(false);
  });

  it("returns ALLOW_DRAFT_PR when validation passes and approval is granted for sensitive paths", () => {
    const result = evaluatePolicy({
      confidence: 90,
      patchCount: 1,
      requiresHumanReview: true,
      hasPassingValidation: true,
      approvalDecision: "APPROVED",
      riskTags: [RiskTag.AUTH],
    });

    expect(result.decision).toBe(PolicyDecision.ALLOW_DRAFT_PR);
    expect(result.canCreatePR).toBe(true);
  });

  it("returns ALLOW_DRAFT_PR for clean plans with passing validation and no sensitive tags", () => {
    const result = evaluatePolicy({
      confidence: 90,
      patchCount: 1,
      requiresHumanReview: false,
      hasPassingValidation: true,
      riskTags: [],
    });

    expect(result.decision).toBe(PolicyDecision.ALLOW_DRAFT_PR);
    expect(result.canCreatePR).toBe(true);
  });
});
