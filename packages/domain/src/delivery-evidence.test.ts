import { describe, expect, it } from "vitest";
import {
  buildEvidenceBlock,
  buildEvidenceHumanSection,
  buildEvidenceMachineComment,
  DELIVERY_EVIDENCE_MARKER,
  DELIVERY_EVIDENCE_VERSION,
  parseEvidenceBlock,
  type DeliveryEvidencePayload,
} from "./delivery-evidence";

function payload(overrides: Partial<DeliveryEvidencePayload> = {}): DeliveryEvidencePayload {
  return {
    version: 1,
    caseId: "case-1",
    remediationPlanId: "plan-1",
    caseVersion: 2,
    policyDecision: "ALLOW_DRAFT_PR",
    policyReasons: ["confidence >= 80"],
    validationStatus: "PASSED",
    validationRunId: "val-1",
    validationArtifactHash: "a".repeat(64),
    commandsExecuted: ["pnpm install --frozen-lockfile"],
    imageDigest: "sha256:abc",
    riskTags: ["auth"],
    affectedUsageCount: 3,
    patchCount: 2,
    approvalDecision: "APPROVED",
    agentVerdict: "Safe migration",
    correlationId: "corr-1",
    createdAt: "2026-09-06T00:00:00.000Z",
    ...overrides,
  };
}

function human() {
  return {
    repositoryName: "app",
    branchName: "patchbay/remediation-abc123",
    baseBranch: "main",
    caseVersion: 2,
    policyDecision: "ALLOW_DRAFT_PR",
    policyReasons: ["confidence >= 80"],
    validationStatus: "PASSED",
    validationArtifactHash: "a".repeat(64),
    approvalDecision: "APPROVED",
    riskTags: ["auth"],
    affectedUsageCount: 3,
    patchCount: 2,
  };
}

describe("delivery evidence block (§7.4)", () => {
  it("round-trips machine evidence through build and parse", () => {
    const body = buildEvidenceBlock(payload(), human());
    const parsed = parseEvidenceBlock(body);
    expect(parsed).toEqual(payload());
  });

  it("serializes deterministically regardless of key order", () => {
    const a = buildEvidenceMachineComment(payload());
    const reordered = buildEvidenceMachineComment(
      payload({ policyReasons: ["confidence >= 80"], riskTags: ["auth"] }),
    );
    expect(a).toBe(reordered);
    expect(a.startsWith(`<!-- ${DELIVERY_EVIDENCE_MARKER} `)).toBe(true);
    expect(a.endsWith(" -->")).toBe(true);
  });

  it("rejects bodies without a marker, with corrupt JSON, or a wrong version", () => {
    expect(parseEvidenceBlock("plain body")).toBeNull();
    expect(parseEvidenceBlock(`<!-- ${DELIVERY_EVIDENCE_MARKER} {oops} -->`)).toBeNull();
    expect(
      parseEvidenceBlock(
        `<!-- ${DELIVERY_EVIDENCE_MARKER} {"version":999,"remediationPlanId":"p"} -->`,
      ),
    ).toBeNull();
    // Missing required fields (patchCount) → null, never a partial parse.
    const hacked = buildEvidenceMachineComment(payload()).replace(`"patchCount":2`, `"nope":0`);
    expect(parseEvidenceBlock(hacked)).toBeNull();
  });

  it("renders human evidence with policy, validation, and rollback", () => {
    const section = buildEvidenceHumanSection(human());
    expect(section).toContain("case version 2");
    expect(section).toContain("ALLOW_DRAFT_PR");
    expect(section).toContain("PASSED");
    expect(section).toContain("### Rollback");
    expect(section).toContain("git push origin --delete patchbay/remediation-abc123");
    expect(section).toContain("`main` untouched");
    expect(section).toContain("never auto-merged");
  });

  it("accepts null case, run, artifact, and approval fields", () => {
    const minimal = payload({
      caseId: null,
      validationRunId: null,
      validationArtifactHash: null,
      imageDigest: null,
      approvalDecision: null,
      agentVerdict: null,
    });
    expect(parseEvidenceBlock(buildEvidenceBlock(minimal, human()))).toEqual(minimal);
  });

  it("pins the evidence version contract", () => {
    expect(DELIVERY_EVIDENCE_VERSION).toBe(1);
  });
});
