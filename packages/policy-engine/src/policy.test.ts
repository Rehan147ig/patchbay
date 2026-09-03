import { describe, expect, it } from "vitest";
import { approvalCoversPatches, evaluatePolicy, hashPatchedContents } from "./index";
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

describe("approvalCoversPatches", () => {
  const contents = ["file-a patched", "file-b patched"];
  const hash = hashPatchedContents(contents);
  const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const past = new Date(Date.now() - 1000);

  it("covers when approved, unexpired, and hash matches regardless of order", () => {
    expect(
      approvalCoversPatches(
        { decision: "APPROVED", patchedHash: hash, expiresAt: future },
        [...contents].reverse(),
      ),
    ).toEqual({ covered: true, reason: null });
  });

  it("rejects missing or non-approved decisions", () => {
    expect(approvalCoversPatches(null, contents).covered).toBe(false);
    expect(
      approvalCoversPatches(
        { decision: "REJECTED", patchedHash: hash, expiresAt: future },
        contents,
      ).covered,
    ).toBe(false);
  });

  it("rejects expired approvals", () => {
    const coverage = approvalCoversPatches(
      { decision: "APPROVED", patchedHash: hash, expiresAt: past },
      contents,
    );
    expect(coverage.covered).toBe(false);
    expect(coverage.reason).toContain("expired");
  });

  it("rejects approvals bound to older patches", () => {
    const coverage = approvalCoversPatches(
      { decision: "APPROVED", patchedHash: "deadbeef", expiresAt: future },
      contents,
    );
    expect(coverage.covered).toBe(false);
    expect(coverage.reason).toContain("changed since approval");
  });

  it("covers legacy approvals without hash or expiry", () => {
    expect(approvalCoversPatches({ decision: "APPROVED" }, contents)).toEqual({
      covered: true,
      reason: null,
    });
  });
});
