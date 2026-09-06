import { describe, expect, it } from "vitest";
import { parseRulePack } from "./rule-pack";

const VALID_PACK = {
  packVersion: "openai/4.x",
  vendorSlug: "openai",
  contractKind: "SDK",
  supportedChanges: ["METHOD_RENAMED", "SDK_VERSION_UPGRADE"],
  editBudget: { maxFiles: 10, maxEditsPerFile: 10, maxTotalBytes: 50_000 },
  expectedEvidence: { requiresSourceHash: true, requiresLockfileVersion: true, minUsages: 1 },
  validationProfile: "node-ts-reparse + container-sandbox",
  riskTags: [],
  rollback: { strategy: "revert-commit", instructions: "Revert the draft PR branch before merge." },
};

/**
 * WP6 stability guard: the rule-pack declaration is a cross-system contract
 * (connectors declare, engine enforces, policy/UI/corpus consume). Required
 * fields must never silently vanish, and budgets must stay within the global
 * breaker caps so a pack can tighten but never loosen safety.
 */
describe("rulePackSchema", () => {
  it("accepts a complete pack declaration", () => {
    expect(parseRulePack(VALID_PACK).packVersion).toBe("openai/4.x");
  });

  it("rejects packs missing required declarations", () => {
    expect(() => parseRulePack({ ...VALID_PACK, editBudget: undefined })).toThrow();
    expect(() => parseRulePack({ ...VALID_PACK, rollback: undefined })).toThrow();
    expect(() => parseRulePack({ ...VALID_PACK, supportedChanges: [] })).toThrow();
    expect(() => parseRulePack({ ...VALID_PACK, riskTags: ["BOGUS"] })).toThrow();
  });

  it("caps budgets at the global breaker ceilings", () => {
    expect(() =>
      parseRulePack({ ...VALID_PACK, editBudget: { ...VALID_PACK.editBudget, maxFiles: 41 } }),
    ).toThrow();
    expect(() =>
      parseRulePack({
        ...VALID_PACK,
        editBudget: { ...VALID_PACK.editBudget, maxEditsPerFile: 21 },
      }),
    ).toThrow();
    expect(() =>
      parseRulePack({
        ...VALID_PACK,
        editBudget: { ...VALID_PACK.editBudget, maxTotalBytes: 100_001 },
      }),
    ).toThrow();
  });

  it("restricts rollback to known strategies", () => {
    expect(() =>
      parseRulePack({ ...VALID_PACK, rollback: { ...VALID_PACK.rollback, strategy: "auto" } }),
    ).toThrow();
  });
});
