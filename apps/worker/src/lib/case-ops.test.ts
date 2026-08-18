import { describe, expect, it } from "vitest";
import { evaluateCasePolicies, scopeKeyOf, type CasePolicyRule } from "./case-ops";

const paymentApproval: CasePolicyRule = {
  id: "p-payment-approval",
  name: "Payment changes require approval",
  enabled: true,
  definitionJson: {
    when: { riskTags: ["PAYMENT"] },
    then: "REQUIRE_APPROVAL",
    reason: "Payment execution paths are high risk",
  },
};

const genericPlanOnly: CasePolicyRule = {
  id: "p-generic-plan-only",
  name: "Generic OpenAPI changes are plan-only",
  enabled: true,
  definitionJson: {
    when: { vendor: "generic-openapi" },
    then: "ALLOW_PLAN_ONLY",
    reason: "No deterministic migration rules exist",
  },
};

const denyPolicy: CasePolicyRule = {
  id: "p-deny",
  name: "Deny everything",
  enabled: true,
  definitionJson: {
    when: {},
    then: "DENY",
    reason: "Frozen window",
  },
};

describe("evaluateCasePolicies", () => {
  it("returns ALLOW when no enabled rule matches", () => {
    const result = evaluateCasePolicies([paymentApproval], {
      riskTags: ["PII"],
      vendor: "stripe",
      validationStatus: "none",
    });
    expect(result.decision).toBe("ALLOW");
    expect(result.matchedPolicyIds).toEqual([]);
  });

  it("REQUIRE_APPROVAL on matching risk tag", () => {
    const result = evaluateCasePolicies([paymentApproval], {
      riskTags: ["PAYMENT"],
      vendor: "stripe",
      validationStatus: "none",
    });
    expect(result.decision).toBe("REQUIRE_APPROVAL");
    expect(result.matchedPolicyIds).toEqual(["p-payment-approval"]);
    expect(result.reasons[0]).toContain("high risk");
  });

  it("matches vendor rules", () => {
    const result = evaluateCasePolicies([genericPlanOnly], {
      riskTags: [],
      vendor: "generic-openapi",
      validationStatus: "none",
    });
    expect(result.decision).toBe("ALLOW_PLAN_ONLY");
  });

  it("DENY wins over weaker actions", () => {
    const result = evaluateCasePolicies([paymentApproval, denyPolicy], {
      riskTags: ["PAYMENT"],
      vendor: "generic-openapi",
      validationStatus: "none",
    });
    expect(result.decision).toBe("DENY");
    expect(result.matchedPolicyIds).toEqual(["p-payment-approval", "p-deny"]);
  });

  it("skips disabled policies and rules without a then", () => {
    const result = evaluateCasePolicies(
      [
        { ...denyPolicy, enabled: false },
        { ...paymentApproval, definitionJson: { when: { riskTags: ["PAYMENT"] } } },
      ],
      { riskTags: ["PAYMENT"], vendor: null, validationStatus: "none" },
    );
    expect(result.decision).toBe("ALLOW");
  });

  it("matches validationStatus conditions", () => {
    const failed: CasePolicyRule = {
      id: "p-failed",
      name: "Failed validation denies",
      enabled: true,
      definitionJson: {
        when: { validationStatus: "FAILED" },
        then: "DENY",
        reason: "Validation must pass",
      },
    };
    const result = evaluateCasePolicies([failed], {
      riskTags: [],
      vendor: null,
      validationStatus: "FAILED",
    });
    expect(result.decision).toBe("DENY");
  });
});

describe("scopeKeyOf", () => {
  it("is deterministic and includes the snapshot when present", () => {
    const withSnapshot = scopeKeyOf("r", "repo", "dep", "snap-1");
    const without = scopeKeyOf("r", "repo", "dep", null);
    expect(withSnapshot).toBe("r:repo:dep:snap-1");
    expect(without).toBe("r:repo:dep:no-snapshot");
    expect(scopeKeyOf("r", "repo", "dep", "snap-1")).toBe(withSnapshot);
  });
});
