import { describe, expect, it } from "vitest";
import { getCapability } from "../capabilities";
import { getConnector } from "../registry";
import {
  autonomousGenericConnector,
  AUTONOMOUS_GENERIC_SLUG,
  isAutonomousDraftEligible,
} from "./autonomous-generic";

const PATCH_BUMP = {
  source: "AUTONOMOUS",
  ecosystem: "npm",
  packageName: "lodash",
  fromVersion: "4.17.20",
  toVersion: "4.17.21",
  updateType: "patch",
};

describe("autonomous-generic connector", () => {
  it("is registered under its own slug", () => {
    expect(AUTONOMOUS_GENERIC_SLUG).toBe("autonomous-generic");
    expect(getConnector("autonomous-generic")).toBe(autonomousGenericConnector);
  });

  it("supports autonomous bump payloads and rejects everything else", () => {
    expect(autonomousGenericConnector.supports(PATCH_BUMP)).toBe(true);
    expect(autonomousGenericConnector.supports({ ...PATCH_BUMP, updateType: "major" })).toBe(true);
    expect(autonomousGenericConnector.supports({ ...PATCH_BUMP, source: "NPM" })).toBe(false);
    expect(autonomousGenericConnector.supports({ sdk: "stripe" })).toBe(false);
    expect(autonomousGenericConnector.supports({ ...PATCH_BUMP, packageName: "" })).toBe(false);
    expect(autonomousGenericConnector.supports(null)).toBe(false);
  });

  it("normalizes patch/minor bumps as non-breaking manifest upgrades", () => {
    for (const updateType of ["patch", "minor"] as const) {
      const payload =
        updateType === "patch"
          ? PATCH_BUMP
          : { ...PATCH_BUMP, fromVersion: "4.17.20", toVersion: "4.18.0", updateType };
      const drafts = autonomousGenericConnector.normalizeChange({
        rawPayload: payload,
        sourceType: "AUTONOMOUS",
      });
      expect(drafts).toHaveLength(1);
      expect(drafts[0]?.changeType).toBe("SDK_VERSION_UPGRADE");
      expect(drafts[0]?.breaking).toBe(false);
      expect(drafts[0]?.affectedSymbols).toEqual([]);
      expect(drafts[0]?.evidence).toMatchObject({
        autonomous: true,
        updateType,
        ecosystem: "npm",
        package: "lodash",
      });
    }
  });

  it("normalizes major bumps as breaking (PLAN-only)", () => {
    const drafts = autonomousGenericConnector.normalizeChange({
      rawPayload: {
        ...PATCH_BUMP,
        fromVersion: "4.17.21",
        toVersion: "5.0.0",
        updateType: "major",
      },
      sourceType: "AUTONOMOUS",
    });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.breaking).toBe(true);
  });

  it("emits no symbol suggestions (manifest kit owns the edit)", () => {
    const drafts = autonomousGenericConnector.normalizeChange({
      rawPayload: PATCH_BUMP,
      sourceType: "AUTONOMOUS",
    });
    expect(autonomousGenericConnector.buildPatchSuggestions(drafts)).toEqual([]);
  });

  it("gates draft eligibility to npm patch/minor with classifier agreement", () => {
    expect(isAutonomousDraftEligible(PATCH_BUMP)).toBe(true);
    expect(
      isAutonomousDraftEligible({
        ...PATCH_BUMP,
        fromVersion: "4.17.20",
        toVersion: "4.18.0",
        updateType: "minor",
      }),
    ).toBe(true);
    // Major bumps stay PLAN-only.
    expect(
      isAutonomousDraftEligible({
        ...PATCH_BUMP,
        fromVersion: "4.17.21",
        toVersion: "5.0.0",
        updateType: "major",
      }),
    ).toBe(false);
    // Declared kind must agree with the classifier — lying payloads refused.
    expect(isAutonomousDraftEligible({ ...PATCH_BUMP, updateType: "minor" })).toBe(false);
    // pypi refused until its kit lands.
    expect(isAutonomousDraftEligible({ ...PATCH_BUMP, ecosystem: "pypi" })).toBe(false);
    // Unknown/opaque moves refused.
    expect(
      isAutonomousDraftEligible({ ...PATCH_BUMP, toVersion: "latest", updateType: "unknown" }),
    ).toBe(false);
    expect(isAutonomousDraftEligible({ sdk: "stripe" })).toBe(false);
  });

  it("holds a DRAFT_PR capability with the full autonomous kit", () => {
    const entry = getCapability("autonomous-generic");
    expect(entry?.level).toBe("DRAFT_PR");
    expect(entry?.ecosystem).toBe("npm");
    expect(entry?.rulePackVersion).not.toBeNull();
    expect(entry?.validationProfile).toContain("container-sandbox");
    expect(entry?.requiredPolicyClass).toBe("APPROVAL_REQUIRED");
    expect(entry?.corpus?.status).toBe("ACTIVE");
  });
});
