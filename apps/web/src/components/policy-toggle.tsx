"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button } from "@patchbay/ui";

export function PolicyToggle({ policyId, enabled }: { policyId: string; enabled: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function toggle() {
    startTransition(async () => {
      const response = await fetch(`/api/policies/${policyId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: !enabled }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: { message?: string } };
        alert(body.error?.message ?? "Failed to update policy");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Badge tone={enabled ? "green" : "neutral"}>{enabled ? "enabled" : "disabled"}</Badge>
      <Button variant="secondary" size="sm" onClick={toggle} loading={pending}>
        {enabled ? "Disable" : "Enable"}
      </Button>
    </div>
  );
}
