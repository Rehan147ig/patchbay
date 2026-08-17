"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@patchbay/ui";
import { apiFetch } from "@/lib/client-fetch";

interface Props {
  releaseId: string;
  matchId: string;
  repositoryName: string;
}

/**
 * Kicks off the analyst -> planner -> reviewer run for one matched
 * release+repository pair (POST /api/releases/[id]/plan). Replays are
 * idempotent server-side.
 */
export function TriggerRemediationButton({ releaseId, matchId, repositoryName }: Props) {
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  function trigger() {
    setStatus(null);
    startTransition(async () => {
      const response = await apiFetch(`/api/releases/${releaseId}/plan`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ matchId }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: { message?: string } };
        setStatus({ kind: "error", text: body.error?.message ?? "Failed to queue remediation" });
        return;
      }
      setStatus({ kind: "ok", text: "Remediation queued for review" });
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" onClick={trigger} loading={pending}>
        Plan remediation
      </Button>
      {status ? (
        status.kind === "ok" ? (
          <span className="text-xs text-slate-600">
            {status.text}{" "}
            <Link href="/remediations" className="text-blue-600 hover:underline">
              Track it in Remediations
            </Link>
          </span>
        ) : (
          <span role="alert" className="text-xs text-red-600">
            {status.text}
          </span>
        )
      ) : (
        <span className="text-xs text-slate-400">
          Generate a migration plan for {repositoryName}
        </span>
      )}
    </div>
  );
}
