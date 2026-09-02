"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client-fetch";

export function PolicyToggle({ policyId, enabled }: { policyId: string; enabled: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function toggle() {
    if (pending) return;
    startTransition(async () => {
      const response = await apiFetch(`/api/policies/${policyId}`, {
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
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={enabled ? "Disable policy" : "Enable policy"}
      aria-busy={pending}
      disabled={pending}
      onClick={toggle}
      className={
        enabled
          ? "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full bg-[#0071e3] p-0.5 shadow-inner transition-colors duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 disabled:opacity-50"
          : "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full bg-zinc-200 p-0.5 shadow-inner transition-colors duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300 disabled:opacity-50"
      }
    >
      <span
        aria-hidden="true"
        className={
          enabled
            ? "pointer-events-none inline-block size-5 translate-x-5 rounded-full bg-white shadow-sm ring-0 transition-transform duration-200 ease-out"
            : "pointer-events-none inline-block size-5 translate-x-0 rounded-full bg-white shadow-sm ring-0 transition-transform duration-200 ease-out"
        }
      />
    </button>
  );
}
