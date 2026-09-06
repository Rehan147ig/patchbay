import { describe, expect, it, vi } from "vitest";
import { actionEndpoint, approveAndDraftPR, type CaseActionFetcher } from "./case-actions";

function fetcherFor(
  approve: { ok: boolean; message: string | null },
  draftPR: { ok: boolean; message: string | null },
): { fetcher: CaseActionFetcher; calls: string[] } {
  const calls: string[] = [];
  const fetcher: CaseActionFetcher = async (url) => {
    calls.push(url);
    if (url.endsWith("/approve")) return approve;
    if (url.endsWith("/draft-pr")) return draftPR;
    throw new Error(`unexpected url: ${url}`);
  };
  return { fetcher, calls };
}

describe("approveAndDraftPR", () => {
  it("calls approve then draft-pr in order and reports done", async () => {
    const { fetcher, calls } = fetcherFor({ ok: true, message: null }, { ok: true, message: null });
    const onStage = vi.fn();
    const result = await approveAndDraftPR(fetcher, "case-1", onStage);
    expect(result).toEqual({ ok: true, stage: "done", message: null });
    expect(calls).toEqual(["/api/cases/case-1/approve", "/api/cases/case-1/draft-pr"]);
    expect(onStage).toHaveBeenCalledWith("approved");
  });

  it("never calls draft-pr when approval fails, preserving the pre-approval state", async () => {
    const { fetcher, calls } = fetcherFor(
      { ok: false, message: "SoD: author cannot approve" },
      { ok: true, message: null },
    );
    const result = await approveAndDraftPR(fetcher, "case-1");
    expect(result).toEqual({
      ok: false,
      stage: "approve",
      message: "SoD: author cannot approve",
    });
    expect(calls).toEqual(["/api/cases/case-1/approve"]);
  });

  it("surfaces draft-pr failures after a recorded approval so the user can retry", async () => {
    const { fetcher, calls } = fetcherFor(
      { ok: true, message: null },
      { ok: false, message: "Policy blocks draft PR" },
    );
    const result = await approveAndDraftPR(fetcher, "case-1");
    expect(result).toEqual({
      ok: false,
      stage: "draft-pr",
      message: "Policy blocks draft PR",
    });
    expect(calls).toEqual(["/api/cases/case-1/approve", "/api/cases/case-1/draft-pr"]);
  });
});

describe("actionEndpoint (WP12 maintenance namespace)", () => {
  it("routes funnel actions through the maintenance contract", () => {
    expect(actionEndpoint("case-1", "assess")).toBe("/api/maintenance/cases/case-1/assess");
    expect(actionEndpoint("case-1", "plan")).toBe("/api/maintenance/cases/case-1/plan");
    expect(actionEndpoint("case-1", "validate")).toBe("/api/maintenance/cases/case-1/validate");
    expect(actionEndpoint("case-1", "suppress")).toBe("/api/maintenance/cases/case-1/suppress");
  });

  it("keeps legacy vectors on their existing endpoints", () => {
    expect(actionEndpoint("case-1", "approve")).toBe("/api/cases/case-1/approve");
    expect(actionEndpoint("case-1", "draft-pr")).toBe("/api/cases/case-1/draft-pr");
    expect(actionEndpoint("case-1", "cancel")).toBe("/api/cases/case-1/cancel");
    expect(actionEndpoint("case-1", "reject")).toBe("/api/cases/case-1/reject");
    expect(actionEndpoint("case-1", "replay")).toBe("/api/cases/case-1/replay");
  });
});
