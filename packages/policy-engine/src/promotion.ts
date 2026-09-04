/**
 * Evidence-based promotion engine (Step 5: vendors earn trust).
 *
 * Architectural boundary: certification (`capabilities.ts`) is static
 * source-controlled configuration and NEVER changes at runtime. This engine
 * computes promotion *proposals* from measured PR outcomes; a human promotes
 * by code change (capabilities.ts PR, audit-covered by git). The engine's job
 * is to make the evidence undeniable: streaks, vetoes, and explicit reasons.
 *
 * Thresholds (defaults): 5 consecutive qualifying merges inside a 90-day
 * window. Qualifying = MERGED + (SUCCESS or UNCLASSIFIED) + sandbox-validated.
 * Any explicit failure classification (WRONG_PATCH, VALIDATION_FAILURE, …)
 * in the window vetoes the proposal — trust is fragile by design. A human
 * merge is itself the approval vote (draft-only product: nothing merges
 * without a human).
 */

export type PromotionOutcomeStatus = "OPEN" | "MERGED" | "CLOSED";

export interface PromotionOutcomeInput {
  status: PromotionOutcomeStatus;
  classification: string;
  /** True when a sandbox ValidationRun is linked (validationRunId present). */
  validated: boolean;
  recordedAt: Date;
}

export interface PromotionEligibilityInput {
  outcomes: PromotionOutcomeInput[];
  requiredStreak?: number;
  windowDays?: number;
  now?: Date;
}

export interface PromotionEvidence {
  evaluated: number;
  mergedStreak: number;
  requiredStreak: number;
  failureClassifications: string[];
  windowDays: number;
}

export interface PromotionEligibility {
  eligible: boolean;
  reasons: string[];
  evidence: PromotionEvidence;
}

export const PROMOTION_DEFAULT_STREAK = 5;
export const PROMOTION_DEFAULT_WINDOW_DAYS = 90;

/** Explicit failure classifications veto a promotion window. */
const FAILURE_CLASSIFICATIONS = new Set([
  "WRONG_IMPACT",
  "WRONG_PATCH",
  "INSUFFICIENT_TESTS",
  "VALIDATION_FAILURE",
]);

export function evaluatePromotionEligibility(
  input: PromotionEligibilityInput,
): PromotionEligibility {
  const requiredStreak = input.requiredStreak ?? PROMOTION_DEFAULT_STREAK;
  const windowDays = input.windowDays ?? PROMOTION_DEFAULT_WINDOW_DAYS;
  const now = input.now ?? new Date();
  const cutoff = now.getTime() - windowDays * 86_400_000;

  const inWindow = input.outcomes
    .filter((o) => o.recordedAt.getTime() >= cutoff)
    .sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime());

  const failures = inWindow.filter(
    (o) => o.status !== "OPEN" && FAILURE_CLASSIFICATIONS.has(o.classification),
  );
  const failureClassifications = [...new Set(failures.map((o) => o.classification))];

  let mergedStreak = 0;
  for (const outcome of inWindow) {
    if (outcome.status === "OPEN") continue;
    const qualifies =
      outcome.status === "MERGED" &&
      !FAILURE_CLASSIFICATIONS.has(outcome.classification) &&
      outcome.validated;
    if (!qualifies) break;
    mergedStreak += 1;
  }

  const reasons: string[] = [];
  if (failureClassifications.length > 0) {
    reasons.push(
      `vetoed by failure classifications in window: ${failureClassifications.join(", ")}`,
    );
  }
  if (mergedStreak < requiredStreak) {
    reasons.push(
      `qualifying merge streak ${mergedStreak}/${requiredStreak} in the last ${windowDays}d`,
    );
  }

  return {
    eligible: reasons.length === 0,
    reasons,
    evidence: {
      evaluated: inWindow.length,
      mergedStreak,
      requiredStreak,
      failureClassifications,
      windowDays,
    },
  };
}
