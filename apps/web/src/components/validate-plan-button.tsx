"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@patchbay/ui";
import { apiFetch } from "@/lib/client-fetch";

/**
 * Enqueues an allowlisted validation run for the plan, then refreshes the
 * page so the ValidationRun and its result appear.
 */
export function ValidatePlanButton({
  remediationPlanId,
  disabled,
}: {
  remediationPlanId: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);

  function validate() {
    setStatus(null);
    startTransition(async () => {
      const response = await apiFetch(`/api/remediations/${remediationPlanId}/validate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: { message?: string } };
        setStatus(body.error?.message ?? "Failed to queue validation");
        return;
      }
      setStatus("Validation queued — refreshing…");
      router.refresh();
      setTimeout(() => router.refresh(), 4_000);
    });
  }

  return (
    <div className="flex items-center gap-3">
      <Button
        variant="secondary"
        size="sm"
        onClick={validate}
        loading={pending}
        disabled={disabled}
      >
        Run validation
      </Button>
      {status ? <span className="text-xs text-slate-500">{status}</span> : null}
    </div>
  );
}
