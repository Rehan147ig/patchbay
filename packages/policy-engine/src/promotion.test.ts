import { describe, expect, it } from "vitest";
import { evaluatePromotionEligibility, type PromotionOutcomeInput } from "./promotion";

const DAY = 86_400_000;
const NOW = new Date("2024-06-01T00:00:00Z");

function outcome(
  status: PromotionOutcomeInput["status"],
  classification: string,
  daysAgo: number,
  validated = true,
): PromotionOutcomeInput {
  return {
    status,
    classification,
    validated,
    recordedAt: new Date(NOW.getTime() - daysAgo * DAY),
  };
}

describe("evaluatePromotionEligibility", () => {
  it("proposes promotion on a 5-merge qualifying streak", () => {
    const eligibility = evaluatePromotionEligibility({
      outcomes: [1, 5, 12, 30, 60].map((d) => outcome("MERGED", "SUCCESS", d)),
      now: NOW,
    });
    expect(eligibility.eligible).toBe(true);
    expect(eligibility.reasons).toEqual([]);
    expect(eligibility.evidence.mergedStreak).toBe(5);
  });

  it("counts UNCLASSIFIED merges (the human merge is the vote)", () => {
    const eligibility = evaluatePromotionEligibility({
      outcomes: [1, 5, 12, 30, 60].map((d) => outcome("MERGED", "UNCLASSIFIED", d)),
      now: NOW,
    });
    expect(eligibility.eligible).toBe(true);
  });

  it("holds below the streak and reports the count", () => {
    const eligibility = evaluatePromotionEligibility({
      outcomes: [1, 5, 12].map((d) => outcome("MERGED", "SUCCESS", d)),
      now: NOW,
    });
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.reasons.join(" ")).toContain("3/5");
  });

  it("vetoes on any failure classification in the window", () => {
    const eligibility = evaluatePromotionEligibility({
      outcomes: [
        ...[1, 5, 12, 30, 60].map((d) => outcome("MERGED", "SUCCESS", d)),
        outcome("CLOSED", "WRONG_PATCH", 70),
      ],
      now: NOW,
    });
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.reasons.join(" ")).toContain("WRONG_PATCH");
  });

  it("ignores stale history outside the window and unvalidated merges", () => {
    const stale = evaluatePromotionEligibility({
      outcomes: [100, 120, 150, 200, 300].map((d) => outcome("MERGED", "SUCCESS", d)),
      now: NOW,
    });
    expect(stale.eligible).toBe(false);
    expect(stale.evidence.evaluated).toBe(0);

    const unvalidated = evaluatePromotionEligibility({
      outcomes: [1, 5, 12, 30, 60].map((d) => outcome("MERGED", "SUCCESS", d, false)),
      now: NOW,
    });
    expect(unvalidated.eligible).toBe(false);
    expect(unvalidated.evidence.mergedStreak).toBe(0);
  });

  it("skips OPEN outcomes without breaking the streak", () => {
    const eligibility = evaluatePromotionEligibility({
      outcomes: [
        outcome("OPEN", "UNCLASSIFIED", 0),
        ...[1, 5, 12, 30, 60].map((d) => outcome("MERGED", "SUCCESS", d)),
      ],
      now: NOW,
    });
    expect(eligibility.eligible).toBe(true);
  });
});
