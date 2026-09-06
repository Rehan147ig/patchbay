"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@patchbay/ui";
import { apiFetch } from "@/lib/client-fetch";
import type { ShapedContractSource } from "@/lib/contract-sources";

/**
 * Contract Sources interactions (WP12 §11.2): per-source Sync Now (MEMBER+)
 * and org-source registration (ADMIN only — the form hides otherwise with a
 * tooltip explaining why). Sync is idempotent server-side (hourly job key);
 * only SDK sources have a producer, others render disabled with the reason.
 */
export function SourcesClient({
  sources,
  isAdmin,
}: {
  sources: ShapedContractSource[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [, startTransition] = useTransition();

  async function syncNow(source: ShapedContractSource) {
    setPendingId(source.id);
    setNotice(null);
    try {
      const response = await apiFetch(`/api/contracts/sources/${source.id}/sync`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      const body = (await response.json()) as {
        data?: { duplicate?: boolean };
        error?: { message?: string };
      };
      if (!response.ok) {
        setNotice({ tone: "error", text: body.error?.message ?? "Sync failed" });
        return;
      }
      setNotice({
        tone: "ok",
        text: body.data?.duplicate
          ? "Sync already queued for this hour — collapsed onto the in-flight poll."
          : "Sync queued: polling the npm registry for this vendor.",
      });
      startTransition(() => router.refresh());
    } catch {
      setNotice({ tone: "error", text: "Network error while triggering sync" });
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="space-y-4">
      {notice ? (
        <p
          role={notice.tone === "error" ? "alert" : "status"}
          className={
            notice.tone === "error"
              ? "rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-[13px] text-red-800"
              : "rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-[13px] text-emerald-800"
          }
        >
          {notice.text}
        </p>
      ) : null}
      <ul className="space-y-2">
        {sources.map((source) => {
          const syncable = source.kind === "SDK";
          const busy = pendingId === source.id;
          return (
            <li
              key={source.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold text-zinc-900">
                  {source.vendorSlug} · {source.name}
                </p>
                <p className="mt-0.5 text-[11px] text-zinc-500">
                  {source.kind} · {source.scope} · {source.status} · {source.counts.snapshots}{" "}
                  snapshots · {source.counts.changes} changes · {source.counts.consumers} consumers
                  ·{" "}
                  {source.lastObservedAt
                    ? `observed ${new Date(source.lastObservedAt).toLocaleDateString()}`
                    : "never observed"}
                </p>
              </div>
              <span
                className={
                  source.health === "healthy"
                    ? "rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-medium text-emerald-800"
                    : "rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-medium text-amber-800"
                }
              >
                {source.health}
              </span>
              <span
                title={
                  syncable
                    ? "Queue an npm-registry poll for this vendor"
                    : "No sync producer serves non-SDK sources yet"
                }
              >
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!syncable || busy}
                  onClick={() => syncNow(source)}
                >
                  {busy ? "Queuing…" : "Sync Now"}
                </Button>
              </span>
            </li>
          );
        })}
      </ul>
      {isAdmin ? (
        <RegisterSourceForm />
      ) : (
        <p
          className="text-[12px] text-zinc-500"
          title="Registering sources requires the ADMIN role"
        >
          Registering sources requires ADMIN — ask an admin to add a private source.
        </p>
      )}
    </div>
  );
}

function RegisterSourceForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  async function onSubmit(formData: FormData) {
    setPending(true);
    setMessage(null);
    try {
      const response = await apiFetch("/api/contracts/sources", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          vendorSlug: String(formData.get("vendorSlug") ?? "").trim(),
          kind: String(formData.get("kind") ?? "SDK"),
          name: String(formData.get("name") ?? "").trim(),
        }),
      });
      const body = (await response.json()) as {
        data?: { duplicate?: boolean };
        error?: { message?: string };
      };
      if (!response.ok) {
        setMessage({ tone: "error", text: body.error?.message ?? "Registration failed" });
        return;
      }
      setMessage({
        tone: "ok",
        text: body.data?.duplicate ? "Source already registered." : "Source registered.",
      });
      router.refresh();
    } catch {
      setMessage({ tone: "error", text: "Network error" });
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      action={onSubmit}
      className="space-y-3 rounded-xl border border-zinc-200 bg-white px-4 py-3"
    >
      <h2 className="text-[13px] font-semibold text-zinc-900">Register a private source</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="text-xs text-zinc-500">
          Vendor slug
          <input
            name="vendorSlug"
            required
            placeholder="stripe"
            className="mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="text-xs text-zinc-500">
          Kind
          <select
            name="kind"
            className="mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
            defaultValue="SDK"
          >
            {["SDK", "REST", "GRAPHQL", "MCP", "WEBHOOK", "ASYNC", "AUTH_CONFIG"].map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-zinc-500">
          Name
          <input
            name="name"
            required
            placeholder="stripe-node"
            className="mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
          />
        </label>
      </div>
      <Button type="submit" size="sm" loading={pending}>
        Register source
      </Button>
      {message ? (
        <p role={message.tone === "error" ? "alert" : "status"} className="text-xs text-zinc-600">
          {message.text}
        </p>
      ) : null}
    </form>
  );
}
