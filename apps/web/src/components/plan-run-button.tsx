"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@patchbay/ui";
import { apiFetch } from "@/lib/client-fetch";

/**
 * Queues an agent run (analyst → planner → reviewer) for a release+repository
 * match and routes to the run detail page once the run is created.
 */
export function PlanRunButton({ releaseId, matchId }: { releaseId: string; matchId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);

  function startRun() {
    setStatus(null);
    startTransition(async () => {
      const response = await apiFetch(`/api/releases/${releaseId}/plan`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ matchId }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: { message?: string } };
        setStatus(body.error?.message ?? "Failed to queue agent plan run");
        return;
      }
      const body = (await response.json()) as {
        agentRunId?: string;
        replay?: boolean;
        eligible?: boolean;
        message?: string;
      };
      if (body.agentRunId) {
        router.push(`/runs/${body.agentRunId}`);
        return;
      }
      if (body.eligible === false) {
        setStatus(body.message ?? "Planning is not allowed for this case");
        return;
      }
      setStatus("Agent run queued");
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Button variant="primary" size="sm" onClick={startRun} loading={pending}>
        Generate AI plan
      </Button>
      {status ? <span className="text-xs text-slate-500">{status}</span> : null}
      <Link href="/runs" className="text-xs text-blue-600 hover:underline">
        View all runs
      </Link>
    </div>
  );
}
