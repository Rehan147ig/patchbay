"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@patchbay/ui";
import { apiFetch } from "@/lib/client-fetch";

export type CaseAction =
  "approve" | "draft-pr" | "approve-and-draft-pr" | "cancel" | "reject" | "replay";

const ACTION_LABEL: Record<CaseAction, string> = {
  approve: "Approve",
  "draft-pr": "Create Draft PR",
  "approve-and-draft-pr": "Approve & Open Draft PR",
  cancel: "Cancel case",
  reject: "Reject case",
  replay: "Replay case",
};

const ACTION_TONE: Record<CaseAction, "primary" | "secondary" | "danger"> = {
  approve: "primary",
  "draft-pr": "primary",
  "approve-and-draft-pr": "primary",
  cancel: "secondary",
  reject: "danger",
  replay: "secondary",
};

export type CaseActionFetcher = (
  url: string,
  init: { method: string; headers: Record<string, string> },
) => Promise<{ ok: boolean; message: string | null }>;

export interface CombinedActionResult {
  ok: boolean;
  /** Last completed stage: used for per-stage status text and error context. */
  stage: "approve" | "draft-pr" | "done";
  message: string | null;
}

/**
 * UI-orchestrated approve → draft-pr sequence for the unified funnel button.
 * Calls the two existing endpoints in order so both audit events
 * (CASE_APPROVED, CASE_DRAFT_PR_QUEUED) are preserved exactly as if the user
 * clicked the buttons separately. Never calls draft-pr when approve fails;
 * both endpoints are idempotent so a retry is safe.
 */
export async function approveAndDraftPR(
  fetcher: CaseActionFetcher,
  caseId: string,
  onStage?: (stage: "approved") => void,
): Promise<CombinedActionResult> {
  const approval = await fetcher(`/api/cases/${caseId}/approve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
  });
  if (!approval.ok) {
    return { ok: false, stage: "approve", message: approval.message ?? "Approval failed" };
  }
  onStage?.("approved");
  const draftPR = await fetcher(`/api/cases/${caseId}/draft-pr`, {
    method: "POST",
    headers: { "content-type": "application/json" },
  });
  if (!draftPR.ok) {
    return { ok: false, stage: "draft-pr", message: draftPR.message ?? "Draft PR failed" };
  }
  return { ok: true, stage: "done", message: null };
}

export function CaseActions({ caseId, actions }: { caseId: string; actions: CaseAction[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  function run(action: CaseAction) {
    setError(null);
    if (action === "approve-and-draft-pr") {
      runCombined();
      return;
    }
    startTransition(async () => {
      const response = await apiFetch(`/api/cases/${caseId}/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: { message?: string } };
        setError(body.error?.message ?? "Action failed");
        return;
      }
      router.refresh();
      setTimeout(() => router.refresh(), 3_000);
    });
  }

  function runCombined() {
    setStatus("Approving plan…");
    startTransition(async () => {
      const result = await approveAndDraftPR(
        async (url, init) => {
          const response = await apiFetch(url, init);
          if (response.ok) return { ok: true, message: null };
          const body = (await response.json()) as { error?: { message?: string } };
          return { ok: false, message: body.error?.message ?? null };
        },
        caseId,
        () => {
          setStatus("Approved — opening draft PR…");
        },
      );
      if (!result.ok) {
        setStatus(null);
        setError(
          result.stage === "approve"
            ? (result.message ?? "Approval failed")
            : `Approved — but draft PR failed: ${result.message ?? "unknown error"}`,
        );
        return;
      }
      setStatus(null);
      router.refresh();
      setTimeout(() => router.refresh(), 3_000);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {actions.map((action) => (
        <Button
          key={action}
          variant={ACTION_TONE[action]}
          size="sm"
          loading={pending}
          onClick={() => run(action)}
        >
          {ACTION_LABEL[action]}
        </Button>
      ))}
      {status ? <span className="text-xs text-zinc-500">{status}</span> : null}
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
    </div>
  );
}
