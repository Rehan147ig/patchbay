import { describe, expect, it } from "vitest";
import { AUTONOMY_POLICY_DEFAULTS, evaluateAutonomyBump } from "./autonomy";

const base = {
  updateType: "patch" as const,
  packageName: "lodash",
  publishedAt: new Date("2024-01-01T00:00:00Z"),
  isVulnFix: false,
  openAutonomousCases: 0,
  policy: AUTONOMY_POLICY_DEFAULTS,
  now: new Date("2024-02-01T00:00:00Z"),
};

describe("evaluateAutonomyBump", () => {
  it("approves an aged patch bump under the cap", () => {
    const decision = evaluateAutonomyBump(base);
    expect(decision.ok).toBe(true);
    expect(decision.reasons).toEqual([]);
  });

  it("refuses majors, unknowns, and excluded packages", () => {
    for (const updateType of ["major", "unknown"] as const) {
      const decision = evaluateAutonomyBump({ ...base, updateType });
      expect(decision.ok).toBe(false);
      expect(decision.reasons.join(" ")).toContain("patch/minor bumps only");
    }
    const excluded = evaluateAutonomyBump({
      ...base,
      policy: { ...AUTONOMY_POLICY_DEFAULTS, excludedPackages: ["lodash"] },
    });
    expect(excluded.ok).toBe(false);
    expect(excluded.reasons.join(" ")).toContain("excluded");
  });

  it("enforces the concurrency cap", () => {
    const decision = evaluateAutonomyBump({ ...base, openAutonomousCases: 5 });
    expect(decision.ok).toBe(false);
    expect(decision.reasons.join(" ")).toContain("concurrency cap reached");
  });

  it("enforces minimum release age but bypasses for CVE fixes", () => {
    const fresh = evaluateAutonomyBump({
      ...base,
      publishedAt: new Date("2024-01-31T00:00:00Z"),
    });
    expect(fresh.ok).toBe(false);
    expect(fresh.reasons.join(" ")).toContain("minimum is 3d");

    const vuln = evaluateAutonomyBump({
      ...base,
      publishedAt: new Date("2024-01-31T00:00:00Z"),
      isVulnFix: true,
    });
    expect(vuln.ok).toBe(true);

    // Bypass disabled: even CVE fixes wait.
    const strict = evaluateAutonomyBump({
      ...base,
      publishedAt: new Date("2024-01-31T00:00:00Z"),
      isVulnFix: true,
      policy: { ...AUTONOMY_POLICY_DEFAULTS, vulnBypassStability: false },
    });
    expect(strict.ok).toBe(false);
  });

  it("fails closed on unknown publish dates", () => {
    const decision = evaluateAutonomyBump({ ...base, publishedAt: null });
    expect(decision.ok).toBe(false);
    expect(decision.reasons.join(" ")).toContain("cannot be proven");
  });
});
