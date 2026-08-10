"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@patchbay/ui";
import { apiFetch } from "@/lib/client-fetch";

/**
 * Enqueues a repository scan via the API, then refreshes the page so the
 * scan status and usage inventory reflect the worker's result.
 */
export function ScanRepositoryButton({
  repositoryId,
  disabled,
}: {
  repositoryId: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);

  function scan() {
    setStatus(null);
    startTransition(async () => {
      const response = await apiFetch(`/api/repositories/${repositoryId}/scan`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: { message?: string } };
        setStatus(body.error?.message ?? "Failed to enqueue scan");
        return;
      }
      setStatus("Scan queued — refreshing…");
      router.refresh();
      setTimeout(() => router.refresh(), 3_000);
    });
  }

  return (
    <div className="flex items-center gap-3">
      <Button variant="secondary" size="sm" onClick={scan} loading={pending} disabled={disabled}>
        Scan now
      </Button>
      {status ? <span className="text-xs text-slate-500">{status}</span> : null}
    </div>
  );
}
