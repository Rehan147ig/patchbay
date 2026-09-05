import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  evaluateCasePolicies,
  scopeKeyOf,
  upsertRemediationCase,
  type CasePolicyRule,
} from "./case-ops";
import { prisma, createNotification } from "@patchbay/db";

vi.mock("@patchbay/db", () => ({
  prisma: {
    remediationCase: { findUnique: vi.fn(), upsert: vi.fn() },
    remediationCaseEvent: { create: vi.fn() },
    auditEvent: { create: vi.fn() },
    notification: { create: vi.fn() },
    policyDecisionRecord: { create: vi.fn() },
  },
  createNotification: vi.fn(),
  NotificationType: { CASE_CREATED: "CASE_CREATED" },
}));

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

  it("SUPPRESSED outranks action decisions but never safety DENY", () => {
    const suppress: CasePolicyRule = {
      id: "p-quiet",
      name: "Mute noisy vendor",
      enabled: true,
      definitionJson: {
        when: { vendor: "generic-openapi" },
        then: "SUPPRESSED",
        reason: "Acknowledged noise",
      },
    };
    const quiet = evaluateCasePolicies([paymentApproval, suppress], {
      riskTags: ["PAYMENT"],
      vendor: "generic-openapi",
      validationStatus: "none",
    });
    expect(quiet.decision).toBe("SUPPRESSED");

    const stillDenied = evaluateCasePolicies([suppress, denyPolicy], {
      riskTags: [],
      vendor: "generic-openapi",
      validationStatus: "none",
    });
    expect(stillDenied.decision).toBe("DENY");
  });

  it("ASSESS outranks REQUIRE_APPROVAL (observe-only beats gated action)", () => {
    const assessOnly: CasePolicyRule = {
      id: "p-assess",
      name: "Observe experimental vendor only",
      enabled: true,
      definitionJson: {
        when: { vendor: "experimental-sdk" },
        then: "ASSESS",
        reason: "No patch promise yet",
      },
    };
    const result = evaluateCasePolicies([paymentApproval, assessOnly], {
      riskTags: ["PAYMENT"],
      vendor: "experimental-sdk",
      validationStatus: "none",
    });
    expect(result.decision).toBe("ASSESS");
    expect(result.matchedPolicyIds).toEqual(["p-payment-approval", "p-assess"]);
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

describe("upsertRemediationCase policy snapshots (WP5)", () => {
  const context = {
    organizationId: "org-1",
    releaseId: "rel-1",
    repositoryId: "repo-1",
    dependencyId: "dep-1",
    matchId: null,
    snapshotId: null,
    vendorSlug: "openai",
    correlationId: "corr-1",
  };
  const evidence = {
    hasClassification: true,
    breaking: true,
    affectedUsageCount: 2,
    ownerCount: 1,
    riskTags: ["PAYMENT"],
    hasSnapshot: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.remediationCase.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.remediationCase.upsert).mockImplementation((async (args: unknown) => ({
      id: "case-1",
      status: "POLICY_ELIGIBLE",
      reasonCode: "usage-evidence",
      ...((args as { create: Record<string, unknown> }).create ?? {}),
    })) as never);
    vi.mocked(prisma.remediationCaseEvent.create).mockResolvedValue({} as never);
    vi.mocked(prisma.auditEvent.create).mockResolvedValue({} as never);
    vi.mocked(createNotification).mockResolvedValue({} as never);
    vi.mocked(prisma.policyDecisionRecord.create).mockResolvedValue({ id: "pdr-1" } as never);
  });

  it("records an immutable policy snapshot on creation", async () => {
    const result = await upsertRemediationCase(
      context,
      evidence,
      false,
      { decision: "ALLOW", reasons: [], matchedPolicyIds: [] },
      "corr-1",
    );
    expect(result.created).toBe(true);
    expect(prisma.policyDecisionRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: "org-1",
          caseId: "case-1",
          decision: "ALLOW",
          riskTags: ["PAYMENT"],
          evaluatorVersion: "case-ops/funnel-v1",
        }),
      }),
    );
    expect(createNotification).toHaveBeenCalledTimes(1);
  });

  it("stays quiet on SUPPRESSED cases but still records the snapshot", async () => {
    const result = await upsertRemediationCase(
      context,
      evidence,
      false,
      { decision: "SUPPRESSED", reasons: ["Acknowledged noise"], matchedPolicyIds: ["p-quiet"] },
      "corr-1",
    );
    expect(result.created).toBe(true);
    expect(createNotification).not.toHaveBeenCalled();
    expect(prisma.policyDecisionRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ decision: "SUPPRESSED", caseId: "case-1" }),
      }),
    );
  });
});
