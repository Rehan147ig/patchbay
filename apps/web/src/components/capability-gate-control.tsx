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
          className="h-7 rounded-xl border border-zinc-200 bg-white px-2.5 text-xs text-[#1d1d1f] placeholder:text-zinc-400 shadow-sm focus:border-[#0071e3] focus:outline-none focus:ring-2 focus:ring-[#0071e3]/20"
        />
      ) : null}
      {isAdmin ? (
        suspended ? (
          <Button
            variant="primary"
            size="sm"
            onClick={() => changeGate("restore")}
            loading={pending}
            className="rounded-full bg-[#0071e3] hover:bg-[#0077ed]"
          >
            Restore
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => changeGate("suspend")}
            loading={pending}
            className="rounded-full"
          >
            Suspend
          </Button>
        )
      ) : null}
      {status ? <span className="text-xs font-medium text-zinc-500">{status}</span> : null}
      {suspended && gate.reason ? (
        <span className="text-xs font-medium text-[#ff3b30]">Reason: {gate.reason}</span>
      ) : null}
    </div>
  );
}
