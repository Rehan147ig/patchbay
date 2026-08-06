"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@patchbay/ui";

export function CreatePRButton({
  remediationPlanId,
  disabled,
}: {
  remediationPlanId: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);

  function createPR() {
    setStatus(null);
    startTransition(async () => {
      const response = await fetch(`/api/remediations/${remediationPlanId}/create-pr`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: { message?: string } };
        setStatus(body.error?.message ?? "Failed to queue PR creation");
        return;
      }
      setStatus("Draft PR queued — refreshing…");
      router.refresh();
      setTimeout(() => router.refresh(), 3_000);
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Button variant="primary" size="sm" onClick={createPR} loading={pending} disabled={disabled}>
        Create Draft PR
      </Button>
      {status ? <span className="text-xs text-slate-500">{status}</span> : null}
    </div>
  );
}
