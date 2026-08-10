import { PullRequestStatus } from "@patchbay/domain";

/**
 * Pure PR status transitions for webhook-driven sync. Statuses are
 * monotonic: a pull request moves forward through DRAFT -> OPEN -> CLOSED /
 * MERGED and never regresses (except GitHub's own CLOSED -> MERGED edge
 * case, which we honor).
 */

export interface PullRequestEventInput {
  action: string;
  merged?: boolean;
  draft?: boolean;
}

export function resolveNextPullRequestStatus(
  input: PullRequestEventInput,
): PullRequestStatus | null {
  const { action, merged, draft } = input;
  if (action === "closed") return merged ? PullRequestStatus.MERGED : PullRequestStatus.CLOSED;
  if (action === "ready_for_review") return PullRequestStatus.OPEN;
  if (action === "converted_to_draft") return PullRequestStatus.DRAFT;
  if (action === "opened" || action === "reopened") {
    return draft ? PullRequestStatus.DRAFT : PullRequestStatus.OPEN;
  }
  return null;
}

export function isAllowedPullRequestTransition(
  current: PullRequestStatus,
  next: PullRequestStatus,
): boolean {
  if (current === next) return true; // idempotent no-op
  if (current === PullRequestStatus.MERGED) return false; // terminal
  if (current === PullRequestStatus.CLOSED) return next === PullRequestStatus.MERGED;
  if (current === PullRequestStatus.DRAFT) return next !== PullRequestStatus.DRAFT;
  if (current === PullRequestStatus.OPEN) {
    // Merging/closing an open PR is normal; regressing to draft is not.
    return next === PullRequestStatus.MERGED || next === PullRequestStatus.CLOSED;
  }
  return true;
}
