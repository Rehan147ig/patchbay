"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@patchbay/ui";
import { apiFetch } from "@/lib/client-fetch";

/**
 * Runs a demo scenario through POST /api/demo/run, then navigates to the
 * resulting change event so the worker's output is visible.
 */
export function DemoRunButton({ scenario, disabled }: { scenario: string; disabled?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);

  function run() {
    setStatus(null);
    startTransition(async () => {
      const response = await apiFetch("/api/demo/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scenario }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: { message?: string } };
        setStatus(body.error?.message ?? "Failed to run demo scenario");
        return;
      }
      const payload = (await response.json()) as {
        data?: { changeEventId?: string };
      };
      if (!payload.data?.changeEventId) {
        setStatus("Demo scenario produced no change event");
        return;
      }
      router.push(`/changes/${payload.data.changeEventId}`);
    });
  }

  return (
    <div className="flex items-center gap-3">
      <Button variant="secondary" size="sm" onClick={run} loading={pending} disabled={disabled}>
        Run demo change
      </Button>
      {status ? <span className="text-xs text-slate-500">{status}</span> : null}
    </div>
  );
}
