"use client";

import { useState, useTransition } from "react";
import { Button } from "@patchbay/ui";
import { apiFetch } from "@/lib/client-fetch";

export interface VendorAgentKeyEntry {
  slug: string;
  name: string;
  hasKey: boolean;
  legacyKey: boolean;
}

export interface AgentKeyIssueResult {
  agentKey: string;
  note: string;
}

/** Response shape the agent-key route returns; guards against malformed replies. */
export function parseAgentKeyIssue(body: unknown): AgentKeyIssueResult | null {
  if (typeof body !== "object" || body === null) return null;
  const data = (body as { data?: unknown }).data;
  if (typeof data !== "object" || data === null) return null;
  const { agentKey, note } = data as { agentKey?: unknown; note?: unknown };
  if (typeof agentKey !== "string" || !agentKey.startsWith("pb_agent_") || agentKey.length === 0) {
    return null;
  }
  return { agentKey, note: typeof note === "string" ? note : "" };
}

/**
 * Per-vendor agent key action for the settings page. ADMIN-only on the server
 * (the route enforces the role); non-admins render nothing. The plaintext key
 * is shown exactly once — Patchbay stores only its hash and never returns it
 * again, so the UI clears it once dismissed.
 */
export function VendorAgentKeyControl({
  entry,
  isAdmin,
}: {
  entry: VendorAgentKeyEntry;
  isAdmin: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);
  const [issued, setIssued] = useState<AgentKeyIssueResult | null>(null);

  if (!isAdmin) return null;

  function issueKey() {
    setStatus(null);
    setIssued(null);
    startTransition(async () => {
      const response = await apiFetch(`/api/vendors/${entry.slug}/agent-key`, { method: "POST" });
      if (!response.ok) {
        const body = (await response.json()) as { error?: { message?: string } };
        setStatus(body.error?.message ?? "Failed to issue agent key");
        return;
      }
      const parsed = parseAgentKeyIssue(await response.json());
      if (!parsed) {
        setStatus("Unexpected response — key not shown");
        return;
      }
      setIssued(parsed);
      setStatus(null);
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {issued ? (
        <div className="w-64 rounded-md border border-amber-300 bg-amber-50 p-2">
          <p className="text-xs font-medium text-amber-800">Store this key now — shown once</p>
          <code className="mt-1 block break-all rounded bg-white px-1.5 py-1 font-mono text-[11px] text-slate-800">
            {issued.agentKey}
          </code>
          <p className="mt-1 text-[11px] text-amber-700">{issued.note}</p>
          <div className="mt-1.5 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void navigator.clipboard?.writeText(issued.agentKey)}
              className="rounded bg-amber-200 px-1.5 py-0.5 text-[11px] font-medium text-amber-900"
            >
              Copy
            </button>
            <button
              type="button"
              onClick={() => setIssued(null)}
              className="rounded bg-white px-1.5 py-0.5 text-[11px] font-medium text-amber-800"
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : (
        <>
          <Button variant="secondary" size="sm" onClick={issueKey} loading={pending}>
            {entry.hasKey ? "Rotate key" : "Issue key"}
          </Button>
          {entry.legacyKey ? (
            <span className="text-[11px] text-amber-700" title="sha256 seed/legacy hash">
              legacy — rotate
            </span>
          ) : null}
        </>
      )}
      {status ? <span className="text-xs text-red-600">{status}</span> : null}
    </div>
  );
}
