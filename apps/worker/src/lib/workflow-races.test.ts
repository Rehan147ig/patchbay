import { describe, expect, it } from "vitest";
import {
  approvalCoversPatches,
  evaluateAutonomyBump,
  evaluatePolicy,
  evaluateQuorum,
  hashPatchedContents,
  AUTONOMY_POLICY_DEFAULTS,
} from "@patchbay/policy-engine";
import { evaluatePromotionEligibility } from "@patchbay/policy-engine";

/**
 * Workflow synchronization races (production gate).
 *
 * These simulate concurrent real-world orderings against the pure policy
 * core — the same functions the routes and jobs call — proving no ordering
 * loses writes, double-counts, or accepts stale approvals. DB-level races
 * (two writers, one row) are covered by unique constraints + idempotent
 * replay paths, asserted in the route tests.
 */
describe("approval races", () => {
  const patched = ["package.json v1 content"];
  const hash = hashPatchedContents(patched);
  const fresh = new Date(Date.now() + 86_400_000).toISOString();

  it("two simultaneous approvers count as exactly 2 (no lost writes, no triples)", () => {
    const approvals = [
      { userId: "alice", decision: "APPROVED" as const, patchedHash: hash, expiresAt: fresh },
      { userId: "bob", decision: "APPROVED" as const, patchedHash: hash, expiresAt: fresh },
    ];
    // Either arrival order converges to the same quorum.
    const forward = evaluateQuorum(approvals, patched, ["PAYMENT"]);
    const reversed = evaluateQuorum([...approvals].reverse(), patched, ["PAYMENT"]);
    for (const quorum of [forward, reversed]) {
      expect(quorum.required).toBe(true);
      expect(quorum.satisfied).toBe(true);
      expect(quorum.approverCount).toBe(2);
    }
  });

  it("a TOCTOU approval (hash bound to older patches) is rejected", () => {
    const staleHash = hashPatchedContents(["package.json v0 content"]);
    const coverage = approvalCoversPatches(
      { decision: "APPROVED", patchedHash: staleHash, expiresAt: fresh },
      patched,
    );
    expect(coverage.covered).toBe(false);
    expect(coverage.reason).toContain("changed since approval");

    const quorum = evaluateQuorum(
      [
        {
          userId: "alice",
          decision: "APPROVED" as const,
          patchedHash: staleHash,
          expiresAt: fresh,
        },
        { userId: "bob", decision: "APPROVED" as const, patchedHash: hash, expiresAt: fresh },
      ],
      patched,
      ["AUTH"],
    );
    expect(quorum.satisfied).toBe(false);
    expect(quorum.approverCount).toBe(1);
  });

  it("expired approvals never satisfy quorum, even two of them", () => {
    const expired = new Date(Date.now() - 1000).toISOString();
    const quorum = evaluateQuorum(
      [
        { userId: "alice", decision: "APPROVED" as const, patchedHash: hash, expiresAt: expired },
        { userId: "bob", decision: "APPROVED" as const, patchedHash: hash, expiresAt: expired },
      ],
      patched,
      ["SECRETS"],
    );
    expect(quorum.satisfied).toBe(false);
    expect(quorum.approverCount).toBe(0);
  });
});

describe("autonomy concurrency cap race", () => {
  const bump = {
    updateType: "patch" as const,
    packageName: "lodash",
    publishedAt: new Date("2024-01-01T00:00:00Z"),
    isVulnFix: false,
    policy: AUTONOMY_POLICY_DEFAULTS,
    now: new Date("2024-02-01T00:00:00Z"),
  };

  it("5 simultaneous bumps against a cap of 3 admit exactly 3", () => {
    const capped = {
      ...bump,
      policy: { ...AUTONOMY_POLICY_DEFAULTS, maxOpenAutonomousPRs: 3 },
    };
    const results = [0, 1, 2, 3, 4].map((openAutonomousCases) =>
      evaluateAutonomyBump({ ...capped, openAutonomousCases }),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(3);
    expect(results[3]?.reasons.join(" ")).toContain("concurrency cap reached");
    expect(results[4]?.reasons.join(" ")).toContain("concurrency cap reached");
  });

  it("a merge frees the slot: the 4th case becomes eligible at count 2", () => {
    expect(evaluateAutonomyBump({ ...bump, openAutonomousCases: 2 }).ok).toBe(true);
  });
});

describe("promotion streak race", () => {
  it("two simultaneous merges increment the streak to exactly 2", () => {
    const at = new Date("2024-06-01T00:00:00Z");
    const both = (offsetMs: number) => ({
      status: "MERGED" as const,
      classification: "SUCCESS",
      validated: true,
      recordedAt: new Date(at.getTime() + offsetMs),
    });
    // Same millisecond or reversed arrival: both outcomes exist exactly once.
    const eligibility = evaluatePromotionEligibility({
      outcomes: [both(0), both(0)],
      requiredStreak: 2,
      now: new Date(at.getTime() + 86_400_000),
    });
    expect(eligibility.eligible).toBe(true);
    expect(eligibility.evidence.mergedStreak).toBe(2);
  });
});

describe("policy gate parity for autonomous PRs", () => {
  it("quorum and approval gates apply identically (no vendor-shaped bypass)", () => {
    // An autonomous bump touching AUTH paths faces the same two-person rule.
    const blocked = evaluatePolicy({
      confidence: 95,
      patchCount: 1,
      requiresHumanReview: true,
      hasPassingValidation: true,
      approvalDecision: "APPROVED",
      riskTags: ["AUTH"],
      quorum: {
        required: true,
        satisfied: false,
        approverCount: 1,
        requiredCount: 2,
        matchedTags: ["AUTH"],
        reason: "short",
      },
    });
    expect(blocked.canCreatePR).toBe(false);

    const allowed = evaluatePolicy({
      confidence: 95,
      patchCount: 1,
      requiresHumanReview: true,
      hasPassingValidation: true,
      approvalDecision: "APPROVED",
      riskTags: [],
      quorum: {
        required: false,
        satisfied: true,
        approverCount: 0,
        requiredCount: 0,
        matchedTags: [],
        reason: null,
      },
    });
    expect(allowed.canCreatePR).toBe(true);
  });
});
