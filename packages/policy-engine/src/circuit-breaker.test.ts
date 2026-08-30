import { describe, expect, it } from "vitest";
import { PolicyDecision } from "@patchbay/domain";
import {
  DEFAULT_CIRCUIT_BREAKER_LIMITS,
  evaluatePlanCircuitBreaker,
  evaluateFanoutCircuitBreaker,
  loadCircuitBreakerLimits,
} from "./circuit-breaker";

describe("circuit-breaker", () => {
  describe("loadCircuitBreakerLimits", () => {
    it("returns default values when no overrides or env vars are set", () => {
      const limits = loadCircuitBreakerLimits();
      expect(limits.maxRepositoriesPerChangeEvent).toBe(
        DEFAULT_CIRCUIT_BREAKER_LIMITS.maxRepositoriesPerChangeEvent,
      );
      expect(limits.maxFilesPerRemediationPlan).toBe(
        DEFAULT_CIRCUIT_BREAKER_LIMITS.maxFilesPerRemediationPlan,
      );
      expect(limits.maxEditsPerFile).toBe(DEFAULT_CIRCUIT_BREAKER_LIMITS.maxEditsPerFile);
      expect(limits.maxPatchBytesPerFile).toBe(DEFAULT_CIRCUIT_BREAKER_LIMITS.maxPatchBytesPerFile);
      expect(limits.maxConcurrentDraftPrsPerOrg).toBe(
        DEFAULT_CIRCUIT_BREAKER_LIMITS.maxConcurrentDraftPrsPerOrg,
      );
    });

    it("respects explicit overrides", () => {
      const limits = loadCircuitBreakerLimits({
        maxFilesPerRemediationPlan: 10,
        maxConcurrentDraftPrsPerOrg: 2,
      });
      expect(limits.maxFilesPerRemediationPlan).toBe(10);
      expect(limits.maxConcurrentDraftPrsPerOrg).toBe(2);
      expect(limits.maxRepositoriesPerChangeEvent).toBe(25); // unchanged
    });
  });

  describe("evaluatePlanCircuitBreaker", () => {
    it("allows a plan that is within all limits", () => {
      const result = evaluatePlanCircuitBreaker({
        fileCount: 5,
        maxEditsInAnyFile: 4,
        maxPatchBytesInAnyFile: 2048,
      });

      expect(result.ok).toBe(true);
      expect(result.decision).toBe(PolicyDecision.ALLOW_DRAFT_PR);
      expect(result.trippedLimits).toHaveLength(0);
      expect(result.reasons).toHaveLength(0);
    });

    it("degrades to REQUIRE_APPROVAL when file count exceeds limit", () => {
      const result = evaluatePlanCircuitBreaker(
        {
          fileCount: 50,
          maxEditsInAnyFile: 5,
          maxPatchBytesInAnyFile: 5000,
        },
        { maxFilesPerRemediationPlan: 40 },
      );

      expect(result.ok).toBe(false);
      expect(result.decision).toBe(PolicyDecision.REQUIRE_APPROVAL);
      expect(result.trippedLimits).toHaveLength(1);
      expect(result.trippedLimits[0]?.limitName).toBe("maxFilesPerRemediationPlan");
      expect(result.trippedLimits[0]?.observed).toBe(50);
      expect(result.trippedLimits[0]?.threshold).toBe(40);
      expect(result.reasons[0]).toContain("50 files exceeds limit (40)");
    });

    it("degrades to REQUIRE_APPROVAL when edits in a single file exceed limit", () => {
      const result = evaluatePlanCircuitBreaker(
        {
          fileCount: 2,
          maxEditsInAnyFile: 35,
          maxPatchBytesInAnyFile: 5000,
        },
        { maxEditsPerFile: 20 },
      );

      expect(result.ok).toBe(false);
      expect(result.decision).toBe(PolicyDecision.REQUIRE_APPROVAL);
      expect(result.trippedLimits[0]?.limitName).toBe("maxEditsPerFile");
      expect(result.trippedLimits[0]?.observed).toBe(35);
      expect(result.reasons[0]).toContain("35 edits in a single file exceeds limit (20)");
    });

    it("degrades to REQUIRE_APPROVAL when patch size exceeds byte limit", () => {
      const result = evaluatePlanCircuitBreaker(
        {
          fileCount: 1,
          maxEditsInAnyFile: 2,
          maxPatchBytesInAnyFile: 150_000,
        },
        { maxPatchBytesPerFile: 100_000 },
      );

      expect(result.ok).toBe(false);
      expect(result.decision).toBe(PolicyDecision.REQUIRE_APPROVAL);
      expect(result.trippedLimits[0]?.limitName).toBe("maxPatchBytesPerFile");
      expect(result.trippedLimits[0]?.observed).toBe(150_000);
      expect(result.reasons[0]).toContain("patch size (150000 bytes) exceeds limit (100000 bytes)");
    });
  });

  describe("evaluateFanoutCircuitBreaker", () => {
    it("allows fan-out within bounds", () => {
      const result = evaluateFanoutCircuitBreaker({
        repositoryCount: 10,
        currentActiveDraftPrs: 2,
      });

      expect(result.ok).toBe(true);
      expect(result.decision).toBe(PolicyDecision.ALLOW_DRAFT_PR);
      expect(result.trippedLimits).toHaveLength(0);
    });

    it("degrades when repository count exceeds fanout threshold", () => {
      const result = evaluateFanoutCircuitBreaker(
        {
          repositoryCount: 100,
          currentActiveDraftPrs: 1,
        },
        { maxRepositoriesPerChangeEvent: 25 },
      );

      expect(result.ok).toBe(false);
      expect(result.decision).toBe(PolicyDecision.REQUIRE_APPROVAL);
      expect(result.trippedLimits[0]?.limitName).toBe("maxRepositoriesPerChangeEvent");
      expect(result.trippedLimits[0]?.observed).toBe(100);
      expect(result.reasons[0]).toContain("100 repositories exceeds automated fan-out limit (25)");
    });

    it("degrades when organization concurrent PR quota is reached", () => {
      const result = evaluateFanoutCircuitBreaker(
        {
          repositoryCount: 5,
          currentActiveDraftPrs: 5,
        },
        { maxConcurrentDraftPrsPerOrg: 5 },
      );

      expect(result.ok).toBe(false);
      expect(result.decision).toBe(PolicyDecision.REQUIRE_APPROVAL);
      expect(result.trippedLimits[0]?.limitName).toBe("maxConcurrentDraftPrsPerOrg");
      expect(result.trippedLimits[0]?.observed).toBe(5);
      expect(result.reasons[0]).toContain("5 active draft PRs reaches organization quota (5)");
    });
  });
});
