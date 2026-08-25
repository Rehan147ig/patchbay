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
        <label className="text-xs text-ink-400">
          Slug (lowercase, dashes)
          <input
            name="slug"
            required
            minLength={3}
            maxLength={64}
            pattern="[a-z0-9][a-z0-9-]*[a-z0-9]"
            placeholder="jpmc-auth-sdk"
            className="mt-1 block w-full rounded-md border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-gray-200 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/30"
          />
        </label>
        <label className="text-xs text-ink-400">
          Display name
          <input
            name="name"
            required
            maxLength={100}
            placeholder="JPMC Auth SDK"
            className="mt-1 block w-full rounded-md border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-gray-200 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/30"
          />
        </label>
        <label className="text-xs text-ink-400">
          Category
          <input
            name="category"
            maxLength={50}
            placeholder="Internal SDK"
            className="mt-1 block w-full rounded-md border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-gray-200 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/30"
          />
        </label>
        <label className="text-xs text-ink-400">
          Docs URL (optional)
          <input
            name="docsUrl"
            type="url"
            maxLength={500}
            placeholder="https://internal.example.com/docs"
            className="mt-1 block w-full rounded-md border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-gray-200 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/30"
          />
        </label>
      </div>
      <Button type="submit" size="sm" loading={pending}>
        Register private vendor
      </Button>
      {message ? (
        <p
          role={message.tone === "error" ? "alert" : undefined}
          className={message.tone === "ok" ? "text-xs text-mint-400" : "text-xs text-red-400"}
        >
          {message.text}
        </p>
      ) : null}
    </form>
  );
}
