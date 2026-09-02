"use client";

import { useState } from "react";
import { Button } from "@patchbay/ui";

/**
 * ADMIN form: registers an organization-private vendor (internal SDK).
 * The created vendor is invisible to other tenants and immediately
 * participates in scans + agent-key issuance for this org.
 */
export function PrivateVendorForm() {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  async function onSubmit(formData: FormData) {
    setPending(true);
    setMessage(null);
    try {
      const payload = {
        slug: String(formData.get("slug") ?? "").trim(),
        name: String(formData.get("name") ?? "").trim(),
        category: String(formData.get("category") ?? "").trim() || undefined,
        docsUrl: String(formData.get("docsUrl") ?? "").trim() || undefined,
      };
      const response = await fetch("/api/vendors/private", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) {
        setMessage({ tone: "error", text: body.error?.message ?? "Registration failed" });
        return;
      }
      setMessage({
        tone: "ok",
        text: `Private vendor "${payload.slug}" registered. Issue an agent key to start ingesting change events.`,
      });
    } catch {
      setMessage({ tone: "error", text: "Network error" });
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit(
          event.currentTarget instanceof HTMLFormElement
            ? new FormData(event.currentTarget)
            : new FormData(),
        );
      }}
      className="space-y-3"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-xs font-medium text-zinc-600">
          Slug (lowercase, dashes)
          <input
            name="slug"
            required
            minLength={3}
            maxLength={64}
            pattern="[a-z0-9][a-z0-9-]*[a-z0-9]"
            placeholder="jpmc-auth-sdk"
            className="mt-1 block h-10 w-full rounded-xl border border-zinc-200 bg-white px-3.5 text-[13px] text-[#1d1d1f] placeholder:text-zinc-400 shadow-sm focus:border-[#0071e3] focus:outline-none focus:ring-2 focus:ring-[#0071e3]/20"
          />
        </label>
        <label className="text-xs font-medium text-zinc-600">
          Display name
          <input
            name="name"
            required
            maxLength={100}
            placeholder="JPMC Auth SDK"
            className="mt-1 block h-10 w-full rounded-xl border border-zinc-200 bg-white px-3.5 text-[13px] text-[#1d1d1f] placeholder:text-zinc-400 shadow-sm focus:border-[#0071e3] focus:outline-none focus:ring-2 focus:ring-[#0071e3]/20"
          />
        </label>
        <label className="text-xs font-medium text-zinc-600">
          Category
          <input
            name="category"
            maxLength={50}
            placeholder="Internal SDK"
            className="mt-1 block h-10 w-full rounded-xl border border-zinc-200 bg-white px-3.5 text-[13px] text-[#1d1d1f] placeholder:text-zinc-400 shadow-sm focus:border-[#0071e3] focus:outline-none focus:ring-2 focus:ring-[#0071e3]/20"
          />
        </label>
        <label className="text-xs font-medium text-zinc-600">
          Docs URL (optional)
          <input
            name="docsUrl"
            type="url"
            maxLength={500}
            placeholder="https://internal.example.com/docs"
            className="mt-1 block h-10 w-full rounded-xl border border-zinc-200 bg-white px-3.5 text-[13px] text-[#1d1d1f] placeholder:text-zinc-400 shadow-sm focus:border-[#0071e3] focus:outline-none focus:ring-2 focus:ring-[#0071e3]/20"
          />
        </label>
      </div>
      <Button
        type="submit"
        size="sm"
        loading={pending}
        className="rounded-full bg-[#0071e3] hover:bg-[#0077ed]"
      >
        Register private vendor
      </Button>
      {message ? (
        <p
          role={message.tone === "error" ? "alert" : undefined}
          className={
            message.tone === "ok"
              ? "text-xs font-medium text-[#34c759]"
              : "text-xs font-medium text-[#ff3b30]"
          }
        >
          {message.text}
        </p>
      ) : null}
    </form>
  );
}
