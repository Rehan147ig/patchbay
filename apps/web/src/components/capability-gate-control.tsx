"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@patchbay/ui";
import { apiFetch } from "@/lib/client-fetch";

export interface GateControlEntry {
  vendorSlug: string;
  vendorName: string;
  level: string;
  status: "ACTIVE" | "SUSPENDED";
  reason: string | null;
}

/**
 * Kill switch for one capability level of one vendor. Suspend/restore is an
 * ADMIN-only mutation; the server enforces the role, so non-admins see the
 * state read-only.
 */
export function CapabilityGateControl({
  gate,
  isAdmin,
}: {
  gate: GateControlEntry;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const suspended = gate.status === "SUSPENDED";

  function changeGate(action: "suspend" | "restore") {
    setStatus(null);
    startTransition(async () => {
      const response = await apiFetch("/api/capability-gates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          vendorSlug: gate.vendorSlug,
          level: gate.level,
          action,
          reason: action === "suspend" && reason.trim() !== "" ? reason.trim() : undefined,
        }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: { message?: string } };
        setStatus(body.error?.message ?? "Failed to update gate");
        return;
      }
      setReason("");
      setStatus(action === "suspend" ? "Suspended — refreshing…" : "Restored — refreshing…");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {isAdmin && !suspended ? (
        <input
          type="text"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Suspension reason (optional)"
          maxLength={500}
          className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
        />
      ) : null}
      {isAdmin ? (
        suspended ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => changeGate("restore")}
            loading={pending}
          >
            Restore
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => changeGate("suspend")}
            loading={pending}
          >
            Suspend
          </Button>
        )
      ) : null}
      {status ? <span className="text-xs text-slate-500">{status}</span> : null}
      {suspended && gate.reason ? (
        <span className="text-xs text-red-600">Reason: {gate.reason}</span>
      ) : null}
    </div>
  );
}
