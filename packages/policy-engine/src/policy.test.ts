import { describe, expect, it } from "vitest";
import {
  approvalCoversPatches,
  evaluatePolicy,
  evaluateQuorum,
  hashPatchedContents,
} from "./index";
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

  it("returns PLAN_ONLY when confidence is below threshold or no patches", () => {
    const lowConf = evaluatePolicy({
      confidence: 65,
      patchCount: 1,
      requiresHumanReview: false,
      hasPassingValidation: false,
      riskTags: [],
    });
    expect(lowConf.decision).toBe(PolicyDecision.PLAN_ONLY);

    const noPatches = evaluatePolicy({
      confidence: 90,
      patchCount: 0,
      requiresHumanReview: false,
      hasPassingValidation: false,
      riskTags: [],
    });
    expect(noPatches.decision).toBe(PolicyDecision.PLAN_ONLY);
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

  it.each([
    RiskTag.PAYMENT,
    RiskTag.AUTH,
    RiskTag.AUTHORIZATION,
    RiskTag.PII,
    RiskTag.SECRETS,
    RiskTag.ENCRYPTION,
    RiskTag.WEBHOOK,
    RiskTag.INFRASTRUCTURE,
  ])("requires approval for high-risk tag %s (conservative autonomy)", (tag) => {
    const result = evaluatePolicy({
      confidence: 90,
      patchCount: 1,
      requiresHumanReview: false,
      hasPassingValidation: true,
      riskTags: [tag],
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

describe("evaluateQuorum", () => {
  const contents = ["file-a patched"];
  const hash = hashPatchedContents(contents);
  const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const past = new Date(Date.now() - 1000);
  const approval = (userId: string, overrides = {}) => ({
    userId,
    decision: "APPROVED" as const,
    patchedHash: hash,
    expiresAt: future,
    ...overrides,
  });

  it("is trivially satisfied for non-quorum tags", () => {
    expect(evaluateQuorum([], contents, ["PII"])).toMatchObject({
      required: false,
      satisfied: true,
    });
    expect(evaluateQuorum([], contents, [])).toMatchObject({
      required: false,
      satisfied: true,
    });
  });

  it("requires two distinct covering approvers for PAYMENT/AUTH/ENCRYPTION/SECRETS", () => {
    for (const tag of ["PAYMENT", "AUTH", "ENCRYPTION", "SECRETS"]) {
      const one = evaluateQuorum([approval("u-1")], contents, [tag]);
      expect(one).toMatchObject({ required: true, satisfied: false, approverCount: 1 });
      const two = evaluateQuorum([approval("u-1"), approval("u-2")], contents, [tag]);
      expect(two).toMatchObject({ required: true, satisfied: true, approverCount: 2 });
    }
  });

  it("counts repeat approvals by the same user once", () => {
    const status = evaluateQuorum([approval("u-1"), approval("u-1")], contents, ["PAYMENT"]);
    expect(status).toMatchObject({ satisfied: false, approverCount: 1 });
  });

  it("ignores expired, stale-hash, and non-approved entries", () => {
    const status = evaluateQuorum(
      [
        approval("u-1"),
        approval("u-2", { expiresAt: past }),
        approval("u-3", { patchedHash: "deadbeef" }),
        approval("u-4", { decision: "REJECTED" }),
      ],
      contents,
      ["AUTH"],
    );
    expect(status).toMatchObject({ satisfied: false, approverCount: 1 });
  });
});

describe("evaluatePolicy quorum gate", () => {
  const quorum = (approverCount: number, satisfied: boolean) => ({
    required: true,
    satisfied,
    approverCount,
    requiredCount: 2,
    matchedTags: ["PAYMENT"],
    reason: satisfied
      ? null
      : `Dual-approver quorum: ${approverCount}/2 distinct approvals (PAYMENT)`,
  });

  it("blocks PRs until quorum is satisfied despite single approval + validation", () => {
    const blocked = evaluatePolicy({
      confidence: 90,
      patchCount: 1,
      requiresHumanReview: false,
      hasPassingValidation: true,
      approvalDecision: "APPROVED",
      riskTags: ["PAYMENT"],
      quorum: quorum(1, false),
    });
    expect(blocked.decision).toBe(PolicyDecision.REQUIRE_APPROVAL);
    expect(blocked.canCreatePR).toBe(false);
    expect(blocked.reasons.join(" ")).toContain("Dual-approver quorum: 1/2");
  });

  it("allows PRs once quorum is satisfied", () => {
    const allowed = evaluatePolicy({
      confidence: 90,
      patchCount: 1,
      requiresHumanReview: false,
      hasPassingValidation: true,
      approvalDecision: "APPROVED",
      riskTags: ["PAYMENT"],
      quorum: quorum(2, true),
    });
    expect(allowed.decision).toBe(PolicyDecision.ALLOW_DRAFT_PR);
    expect(allowed.canCreatePR).toBe(true);
  });

  it("keeps legacy single-approval behavior when quorum is absent", () => {
    const allowed = evaluatePolicy({
      confidence: 90,
      patchCount: 1,
      requiresHumanReview: false,
      hasPassingValidation: true,
      approvalDecision: "APPROVED",
      riskTags: ["PAYMENT"],
    });
    expect(allowed.canCreatePR).toBe(true);
  });
});
