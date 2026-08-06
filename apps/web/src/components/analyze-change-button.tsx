"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@patchbay/ui";

/**
 * Enqueues change normalization + impact assessment via the API, then
 * refreshes the page so the normalized changes and assessments appear.
 */
export function AnalyzeChangeButton({
  changeEventId,
  disabled,
}: {
  changeEventId: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);

  function analyze() {
    setStatus(null);
    startTransition(async () => {
      const response = await fetch(`/api/vendor-changes/${changeEventId}/analyze`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: { message?: string } };
        setStatus(body.error?.message ?? "Failed to enqueue analysis");
        return;
      }
      setStatus("Analysis queued — refreshing…");
      router.refresh();
      setTimeout(() => router.refresh(), 3_000);
    });
  }

  return (
    <div className="flex items-center gap-3">
      <Button variant="secondary" size="sm" onClick={analyze} loading={pending} disabled={disabled}>
        Analyze change
      </Button>
      {status ? <span className="text-xs text-slate-500">{status}</span> : null}
    </div>
  );
}
