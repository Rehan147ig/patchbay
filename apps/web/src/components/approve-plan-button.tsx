"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@patchbay/ui";
import { apiFetch } from "@/lib/client-fetch";

export function ApprovePlanButton({
  remediationPlanId,
  currentDecision,
}: {
  remediationPlanId: string;
  currentDecision?: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);

  function sendDecision(decision: "APPROVED" | "REJECTED") {
    setStatus(null);
    startTransition(async () => {
      const response = await apiFetch(`/api/remediations/${remediationPlanId}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: { message?: string } };
        setStatus(body.error?.message ?? "Failed to submit approval");
        return;
      }
      setStatus(`Plan ${decision.toLowerCase()} — refreshing…`);
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="secondary"
        size="sm"
        onClick={() => sendDecision("APPROVED")}
        loading={pending}
        disabled={currentDecision === "APPROVED"}
      >
        Approve
      </Button>
      <Button
        variant="danger"
        size="sm"
        onClick={() => sendDecision("REJECTED")}
        loading={pending}
        disabled={currentDecision === "REJECTED"}
      >
        Reject
      </Button>
      {status ? <span className="text-xs text-slate-500">{status}</span> : null}
    </div>
  );
}
