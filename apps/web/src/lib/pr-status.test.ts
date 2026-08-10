import { describe, expect, it } from "vitest";
import { PullRequestStatus } from "@patchbay/domain";
import { isAllowedPullRequestTransition, resolveNextPullRequestStatus } from "./pr-status";

const D = PullRequestStatus.DRAFT;
const O = PullRequestStatus.OPEN;
const C = PullRequestStatus.CLOSED;
const M = PullRequestStatus.MERGED;

describe("resolveNextPullRequestStatus", () => {
  it("maps GitHub actions to statuses", () => {
    expect(resolveNextPullRequestStatus({ action: "opened", draft: true })).toBe(D);
    expect(resolveNextPullRequestStatus({ action: "opened" })).toBe(O);
    expect(resolveNextPullRequestStatus({ action: "reopened" })).toBe(O);
    expect(resolveNextPullRequestStatus({ action: "ready_for_review" })).toBe(O);
    expect(resolveNextPullRequestStatus({ action: "converted_to_draft" })).toBe(D);
    expect(resolveNextPullRequestStatus({ action: "closed", merged: true })).toBe(M);
    expect(resolveNextPullRequestStatus({ action: "closed" })).toBe(C);
  });

  it("returns null for unrelated actions", () => {
    expect(resolveNextPullRequestStatus({ action: "labeled" })).toBeNull();
    expect(resolveNextPullRequestStatus({ action: "review_requested" })).toBeNull();
  });
});

describe("isAllowedPullRequestTransition (monotonicity)", () => {
  it("allows forward progress", () => {
    expect(isAllowedPullRequestTransition(D, O)).toBe(true);
    expect(isAllowedPullRequestTransition(D, C)).toBe(true);
    expect(isAllowedPullRequestTransition(O, C)).toBe(true);
    expect(isAllowedPullRequestTransition(O, M)).toBe(true);
    expect(isAllowedPullRequestTransition(C, M)).toBe(true);
  });

  it("allows idempotent repeats", () => {
    expect(isAllowedPullRequestTransition(D, D)).toBe(true);
    expect(isAllowedPullRequestTransition(M, M)).toBe(true);
  });

  it("never regresses a merged PR", () => {
    expect(isAllowedPullRequestTransition(M, D)).toBe(false);
    expect(isAllowedPullRequestTransition(M, O)).toBe(false);
    expect(isAllowedPullRequestTransition(M, C)).toBe(false);
  });

  it("never reopens a closed PR", () => {
    expect(isAllowedPullRequestTransition(C, O)).toBe(false);
    expect(isAllowedPullRequestTransition(C, D)).toBe(false);
  });

  it("never turns an open PR back into a draft", () => {
    expect(isAllowedPullRequestTransition(O, D)).toBe(false);
  });
});
