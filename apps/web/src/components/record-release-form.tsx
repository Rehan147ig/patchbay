"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@patchbay/ui";
import { apiFetch } from "@/lib/client-fetch";

/**
 * Records an observed upstream release (POST /api/releases), which enqueues
 * deterministic classification + matching, then refreshes the list.
 */
export function RecordReleaseForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);

  function submit(formData: FormData) {
    setStatus(null);
    startTransition(async () => {
      const response = await apiFetch("/api/releases", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          vendorSlug: String(formData.get("vendorSlug") ?? ""),
          packageName: String(formData.get("packageName") ?? ""),
          version: String(formData.get("version") ?? ""),
          previousVersion: String(formData.get("previousVersion") ?? "") || undefined,
        }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: { message?: string } };
        setStatus(body.error?.message ?? "Failed to record release");
        return;
      }
      setStatus("Recorded; classification + matching queued");
      router.refresh();
    });
  }

  return (
    <form action={submit} className="flex items-end gap-2">
      <label className="text-xs text-slate-500">
        Vendor
        <input
          name="vendorSlug"
          defaultValue="openai"
          className="mt-1 block w-24 rounded border border-slate-300 px-2 py-1 text-sm"
        />
      </label>
      <label className="text-xs text-slate-500">
        Package
        <input
          name="packageName"
          defaultValue="openai"
          className="mt-1 block w-32 rounded border border-slate-300 px-2 py-1 text-sm"
        />
      </label>
      <label className="text-xs text-slate-500">
        Version
        <input
          name="version"
          defaultValue="4.0.0"
          className="mt-1 block w-28 rounded border border-slate-300 px-2 py-1 text-sm"
        />
      </label>
      <label className="text-xs text-slate-500">
        Previous
        <input
          name="previousVersion"
          defaultValue="3.3.0"
          className="mt-1 block w-28 rounded border border-slate-300 px-2 py-1 text-sm"
        />
      </label>
      <Button variant="secondary" size="sm" loading={pending}>
        Record release
      </Button>
      {status ? <span className="text-xs text-slate-500">{status}</span> : null}
    </form>
  );
}
