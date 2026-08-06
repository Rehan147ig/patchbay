"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@patchbay/ui";

/**
 * Runs the remediation rule engine via the API and navigates to the first
 * generated plan.
 */
export function GeneratePlanButton({
  changeEventId,
  disabled,
}: {
  changeEventId: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);

  function generate() {
    setStatus(null);
    startTransition(async () => {
      const response = await fetch(`/api/vendor-changes/${changeEventId}/plan`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: { message?: string } };
        setStatus(body.error?.message ?? "Failed to generate plan");
        return;
      }
      const body = (await response.json()) as {
        data?: { plans?: Array<{ id: string }> };
      };
      const plan = body.data?.plans?.[0];
      if (plan) {
        router.push(`/remediations/${plan.id}`);
      } else {
        setStatus("No plan generated");
      }
    });
  }

  return (
    <div className="flex items-center gap-3">
      <Button
        variant="secondary"
        size="sm"
        onClick={generate}
        loading={pending}
        disabled={disabled}
      >
        Generate plan
      </Button>
      {status ? <span className="text-xs text-slate-500">{status}</span> : null}
    </div>
  );
}
