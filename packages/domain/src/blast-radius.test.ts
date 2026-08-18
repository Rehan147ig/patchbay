import { describe, expect, it } from "vitest";
import { computeBlastRadius, isPlanEligibleLevel } from "./blast-radius";

describe("computeBlastRadius", () => {
  it("scores low for a single ordinary usage with no risk tags", () => {
    const result = computeBlastRadius({
      riskTags: [],
      affectedUsageCount: 1,
      ownerCount: 1,
      capabilityLevel: "ASSESS",
      validationProfile: null,
    });
    expect(result.score).toBe(20);
    expect(result.severity).toBe("LOW");
    expect(result.planEligible).toBe(false);
  });

  it("is never plan-eligible below PLAN capability", () => {
    for (const level of ["DETECT", "ASSESS"]) {
      expect(computeBlastRadius({ ...base, capabilityLevel: level }).planEligible).toBe(false);
    }
    for (const level of ["PLAN", "VALIDATE", "DRAFT_PR"]) {
      expect(computeBlastRadius({ ...base, capabilityLevel: level }).planEligible).toBe(true);
    }
  });

  it("escalates on risk tags, usage spread and ownership", () => {
    const result = computeBlastRadius({
      riskTags: ["PAYMENT", "AUTH", "SECRETS"],
      affectedUsageCount: 12,
      ownerCount: 3,
      capabilityLevel: "DRAFT_PR",
      validationProfile: "node-ts-reparse + container-sandbox",
    });
    expect(result.score).toBeGreaterThanOrEqual(68);
    expect(result.severity).toBe("HIGH");
    expect(result.planEligible).toBe(true);
    expect(result.factors).toContain("risk tags: PAYMENT, AUTH, SECRETS");
    expect(result.factors).toContain("12 affected usages");
    expect(result.factors).toContain("3 owners");
  });

  it("caps at 100 and never drops below 0", () => {
    const loud = computeBlastRadius({
      riskTags: ["PAYMENT", "PAYMENT", "AUTH", "SECRETS", "PII", "WEBHOOK", "ENCRYPTION"],
      affectedUsageCount: 100,
      ownerCount: 20,
      capabilityLevel: "DRAFT_PR",
      validationProfile: null,
    });
    expect(loud.score).toBeLessThanOrEqual(100);

    const quiet = computeBlastRadius({
      riskTags: [],
      affectedUsageCount: 0,
      ownerCount: 0,
      capabilityLevel: "DETECT",
      validationProfile: null,
    });
    expect(quiet.score).toBe(20);
  });

  it("credits an existing validation profile", () => {
    const withProfile = computeBlastRadius({
      ...base,
      capabilityLevel: "VALIDATE",
      validationProfile: "node-ts-reparse",
    });
    const without = computeBlastRadius({
      ...base,
      capabilityLevel: "VALIDATE",
      validationProfile: null,
    });
    expect(withProfile.score).toBe(without.score - 5);
    expect(withProfile.factors).toContain("validation profile: node-ts-reparse");
  });
});

const base = {
  riskTags: [],
  affectedUsageCount: 1,
  ownerCount: 1,
  capabilityLevel: "DETECT",
  validationProfile: null,
};

describe("isPlanEligibleLevel", () => {
  it("honors the capability ordering", () => {
    expect(isPlanEligibleLevel("DETECT")).toBe(false);
    expect(isPlanEligibleLevel("ASSESS")).toBe(false);
    expect(isPlanEligibleLevel("PLAN")).toBe(true);
    expect(isPlanEligibleLevel("VALIDATE")).toBe(true);
    expect(isPlanEligibleLevel("DRAFT_PR")).toBe(true);
    expect(isPlanEligibleLevel("unknown")).toBe(false);
  });
});
