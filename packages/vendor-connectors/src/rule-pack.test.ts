import { describe, expect, it } from "vitest";
import { parseRulePack } from "@patchbay/domain";
import { listCapabilitiesByLevel } from "./capabilities";
import { requireRulePack } from "./registry";

/**
 * WP6 linkage: every DRAFT_PR-certified connector declares a rule pack, and
 * the pack mirrors the capability registry (same version, same validation
 * profile). Budgets stay within the global breaker ceilings (40 files,
 * 20 edits/file, 100KB — see DEFAULT_CIRCUIT_BREAKER_LIMITS); the engine
 * takes the minimum, so packs only ever tighten.
 */
describe("rule-pack linkage (WP6)", () => {
  it("every DRAFT_PR-certified vendor declares a schema-valid pack", () => {
    const certified = listCapabilitiesByLevel("DRAFT_PR");
    expect(certified.length).toBeGreaterThan(0);
    for (const entry of certified) {
      const pack = requireRulePack(entry.vendorSlug);
      expect(parseRulePack(pack)).toEqual(pack);
      expect(pack.supportedChanges.length).toBeGreaterThan(0);
    }
  });

  it("pack identity tracks the capability registry exactly", () => {
    for (const entry of listCapabilitiesByLevel("DRAFT_PR")) {
      const pack = requireRulePack(entry.vendorSlug);
      expect(pack.packVersion).toBe(entry.rulePackVersion);
      expect(pack.validationProfile).toBe(entry.validationProfile);
      expect(pack.vendorSlug).toBe(entry.vendorSlug);
    }
  });

  it("pack budgets fit inside the global breaker ceilings", () => {
    for (const entry of listCapabilitiesByLevel("DRAFT_PR")) {
      const { editBudget } = requireRulePack(entry.vendorSlug);
      expect(editBudget.maxFiles).toBeLessThanOrEqual(40);
      expect(editBudget.maxEditsPerFile).toBeLessThanOrEqual(20);
      expect(editBudget.maxTotalBytes).toBeLessThanOrEqual(100_000);
    }
  });

  it("refuses unknown slugs and pack-less connectors loudly", () => {
    expect(() => requireRulePack("not-a-vendor")).toThrow(/no connector registered/);
    expect(() => requireRulePack("axios")).toThrow(/declares no rule pack/);
  });
});
