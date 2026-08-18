"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@patchbay/ui";
import { apiFetch } from "@/lib/client-fetch";

export type CaseAction = "approve" | "draft-pr" | "cancel" | "reject" | "replay";

const ACTION_LABEL: Record<CaseAction, string> = {
  approve: "Approve",
  "draft-pr": "Create Draft PR",
  cancel: "Cancel case",
  reject: "Reject case",
  replay: "Replay case",
};

const ACTION_TONE: Record<CaseAction, "primary" | "secondary" | "danger"> = {
  approve: "primary",
  "draft-pr": "primary",
  cancel: "secondary",
  reject: "danger",
  replay: "secondary",
};

export function CaseActions({ caseId, actions }: { caseId: string; actions: CaseAction[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(action: CaseAction) {
    setError(null);
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
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
    </div>
  );
}
