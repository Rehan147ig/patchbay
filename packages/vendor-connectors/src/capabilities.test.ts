import { describe, expect, it } from "vitest";
import {
  CAPABILITY_LEVEL_INDEX,
  CAPABILITY_REGISTRY,
  capabilityAtLeast,
  certificationReasons,
  getCapability,
  listCapabilitiesByLevel,
  requireCertified,
  validateCapabilityCoverage,
  type ConnectorCapability,
} from "./capabilities";
import { listConnectorSlugs } from "./registry";

describe("connector capability registry", () => {
  it("covers every catalog connector exactly once", () => {
    expect(validateCapabilityCoverage()).toEqual([]);
    const slugs = CAPABILITY_REGISTRY.map((entry) => entry.vendorSlug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(slugs.length).toBe(listConnectorSlugs().length);
  });

  it("marketed level is at least DETECT and never lower than the certified floor", () => {
    for (const entry of CAPABILITY_REGISTRY) {
      expect(CAPABILITY_LEVEL_INDEX[entry.level], entry.vendorSlug).toBeGreaterThanOrEqual(1);
      expect(entry.package.length, entry.vendorSlug).toBeGreaterThan(0);
      expect(entry.language.length, entry.vendorSlug).toBeGreaterThan(0);
    }
  });

  it("only corpus-certified connectors hold PLAN or above", () => {
    for (const entry of CAPABILITY_REGISTRY) {
      if (CAPABILITY_LEVEL_INDEX[entry.level] >= CAPABILITY_LEVEL_INDEX.PLAN) {
        expect(entry.corpus, entry.vendorSlug).not.toBeNull();
        expect(entry.corpus?.status, entry.vendorSlug).toBe("ACTIVE");
        expect(entry.rulePackVersion, entry.vendorSlug).not.toBeNull();
        expect(entry.certifiedAt, entry.vendorSlug).not.toBeNull();
      } else {
        expect(entry.corpus, entry.vendorSlug).toBeNull();
        expect(entry.rulePackVersion, entry.vendorSlug).toBeNull();
      }
    }
  });

  it("openai/stripe/twilio are certified DRAFT_PR; auth0 is PLAN; the rest are ASSESS", () => {
    const levelOf = (slug: string): string => getCapability(slug)?.level ?? "none";
    expect(levelOf("openai")).toBe("DRAFT_PR");
    expect(levelOf("stripe")).toBe("DRAFT_PR");
    expect(levelOf("twilio")).toBe("DRAFT_PR");
    expect(levelOf("auth0")).toBe("PLAN");
    const certified = new Set(["openai", "stripe", "twilio", "auth0"]);
    for (const slug of listConnectorSlugs()) {
      if (!certified.has(slug)) {
        expect(levelOf(slug), slug).toBe("ASSESS");
      }
    }
  });

  it("DRAFT_PR certification requires a sandbox profile and approval policy", () => {
    for (const entry of CAPABILITY_REGISTRY) {
      if (entry.level !== "DRAFT_PR") continue;
      expect(entry.validationProfile, entry.vendorSlug).toContain("container-sandbox");
      expect(entry.requiredPolicyClass, entry.vendorSlug).toBe("APPROVAL_REQUIRED");
      expect(Date.parse(entry.corpus?.expiresAt ?? ""), entry.vendorSlug).toBeGreaterThan(
        Date.parse("2026-08-17"),
      );
    }
  });

  it("capabilityAtLeast honors the level ordering", () => {
    expect(capabilityAtLeast("openai", "DRAFT_PR")).toBe(true);
    expect(capabilityAtLeast("openai", "VALIDATE")).toBe(true);
    expect(capabilityAtLeast("auth0", "PLAN")).toBe(true);
    expect(capabilityAtLeast("auth0", "VALIDATE")).toBe(false);
    expect(capabilityAtLeast("anthropic", "ASSESS")).toBe(true);
    expect(capabilityAtLeast("anthropic", "PLAN")).toBe(false);
    expect(capabilityAtLeast("not-a-vendor", "DETECT")).toBe(false);
  });

  it("filters by level return only connectors reaching that level", () => {
    const draftPr = listCapabilitiesByLevel("DRAFT_PR");
    expect(draftPr.map((entry: ConnectorCapability) => entry.vendorSlug).sort()).toEqual([
      "openai",
      "stripe",
      "twilio",
    ]);
    const plan = listCapabilitiesByLevel("PLAN");
    expect(plan.map((entry: ConnectorCapability) => entry.vendorSlug).sort()).toEqual([
      "auth0",
      "openai",
      "stripe",
      "twilio",
    ]);
  });
});

describe("requireCertified (WP9 certification gate)", () => {
  it("passes certified connectors at or above the requested level", () => {
    expect(requireCertified("openai", "DRAFT_PR").ok).toBe(true);
    expect(requireCertified("openai", "VALIDATE").ok).toBe(true);
    expect(requireCertified("auth0", "PLAN").ok).toBe(true);
    expect(requireCertified("openai", "DRAFT_PR").achievedLevel).toBe("DRAFT_PR");
  });

  it("fails with reasons when the level is below the request", () => {
    const check = requireCertified("auth0", "VALIDATE");
    expect(check.ok).toBe(false);
    expect(check.reasons.join("; ")).toMatch(/PLAN is below the required VALIDATE/);
  });

  it("fails for uncertified connectors at kit-required levels", () => {
    for (const slug of ["anthropic", "axios", "express"]) {
      const check = requireCertified(slug, "PLAN");
      expect(check.ok, slug).toBe(false);
      expect(check.reasons.join("; "), slug).toMatch(/ASSESS is below the required PLAN/);
    }
  });

  it("fails for connectors with no capability entry", () => {
    const check = requireCertified("not-a-vendor", "DETECT");
    expect(check.ok).toBe(false);
    expect(check.reasons.join("; ")).toMatch(/no capability entry/);
  });

  it("fails an expired corpus at the kit-required level", () => {
    const check = requireCertified("openai", "PLAN", { now: new Date("2027-02-01") });
    expect(check.ok).toBe(false);
    expect(check.reasons.join("; ")).toMatch(/expired at 2026-12-31/);
  });

  it("passes a non-expired corpus before expiry", () => {
    expect(requireCertified("openai", "PLAN", { now: new Date("2026-09-01") }).ok).toBe(true);
  });

  it("requires the validation profile for VALIDATE and above", () => {
    const base: ConnectorCapability = {
      vendorSlug: "synthetic",
      level: "VALIDATE",
      language: "python",
      ecosystem: "npm",
      package: "synthetic-connector",
      requiredPolicyClass: "APPROVAL_REQUIRED",
      certifiedAt: "2026-01-01T00:00:00.000Z",
      rulePackVersion: "1.0.0",
      extractorVersion: "1.0.0",
      validationProfile: null,
      corpus: {
        id: "SYNTHETIC_CORPUS",
        owner: "synthetic-connector-owner",
        status: "ACTIVE",
        reviewedAt: "2026-01-01T00:00:00.000Z",
        expiresAt: "2026-12-31T23:59:59.000Z",
        metrics: {
          dependencyMatchRecallPct: 100,
          affectedUsagePrecisionPct: 100,
          patchValidationPct: 100,
          policyOutcomeCorrectPct: 100,
        },
      },
    };
    expect(certificationReasons(base, "VALIDATE").join("; ")).toMatch(
      /validationProfile is not set/,
    );
    expect(
      certificationReasons({ ...base, validationProfile: "python-venv-reparse" }, "VALIDATE"),
    ).toEqual([]);
    expect(requireCertified("openai", "VALIDATE").ok).toBe(true);
  });
});
