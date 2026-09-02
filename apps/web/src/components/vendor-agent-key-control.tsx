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

export interface AgentKeyRevokeResult {
  vendorSlug: string;
  status: string;
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

/** Response shape of the revocation route; rejects malformed replies. */
export function parseAgentKeyRevoke(body: unknown): AgentKeyRevokeResult | null {
  if (typeof body !== "object" || body === null) return null;
  const data = (body as { data?: unknown }).data;
  if (typeof data !== "object" || data === null) return null;
  const { vendorSlug, status } = data as { vendorSlug?: unknown; status?: unknown };
  if (typeof vendorSlug !== "string" || vendorSlug.length === 0) return null;
  if (status !== "REVOKED" && status !== "ALREADY_DISABLED") return null;
  return { vendorSlug, status };
}

/**
 * Per-vendor agent key actions for the settings page. ADMIN-only on the server
 * (the route enforces the role); non-admins render nothing. The plaintext key
 * is shown exactly once — Patchbay stores only its hash and never returns it
 * again, so the UI clears it once dismissed. Revocation clears every stored
 * hash immediately; issuing again starts a fresh enrollment.
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
  const [hasKey, setHasKey] = useState(entry.hasKey);
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);

  if (!isAdmin) return null;

  function issueKey() {
    setStatus(null);
    setIssued(null);
    setConfirmingRevoke(false);
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
      setHasKey(true);
      setStatus(null);
    });
  }

  function revokeKey() {
    setStatus(null);
    setIssued(null);
    startTransition(async () => {
      const response = await apiFetch(`/api/vendors/${entry.slug}/agent-key`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: { message?: string } };
        setStatus(body.error?.message ?? "Failed to revoke agent key");
        return;
      }
      const parsed = parseAgentKeyRevoke(await response.json());
      if (!parsed) {
        setStatus("Unexpected response while revoking");
        return;
      }
      setHasKey(false);
      setConfirmingRevoke(false);
      setStatus("Agent mode disabled — all issued keys stopped working.");
    });
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      {issued ? (
        <div className="w-64 rounded-[16px] border border-amber-200 bg-amber-50 p-3 shadow-sm">
          <p className="text-xs font-semibold text-amber-800">Store this key now — shown once</p>
          <code className="mt-1.5 block break-all rounded-xl border border-amber-200 bg-white px-2.5 py-1.5 font-mono text-[11px] leading-relaxed text-[#1d1d1f]">
            {issued.agentKey}
          </code>
          <p className="mt-1.5 text-[11px] leading-relaxed text-amber-700">{issued.note}</p>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void navigator.clipboard?.writeText(issued.agentKey)}
              className="rounded-full bg-[#1d1d1f] px-3 py-1 text-[11px] font-medium text-white shadow-sm transition-colors hover:bg-zinc-800"
            >
              Copy
            </button>
            <button
              type="button"
              onClick={() => setIssued(null)}
              className="rounded-full border border-zinc-200 bg-white px-3 py-1 text-[11px] font-medium text-zinc-600 shadow-sm transition-colors hover:bg-zinc-50"
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={issueKey}
              loading={pending}
              className="rounded-full"
            >
              {hasKey ? "Rotate key" : "Issue key"}
            </Button>
            {hasKey ? (
              confirmingRevoke ? (
                <>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={revokeKey}
                    loading={pending}
                    className="rounded-full"
                  >
                    Confirm revoke
                  </Button>
                  <button
                    type="button"
                    onClick={() => setConfirmingRevoke(false)}
                    className="text-[11px] font-medium text-zinc-500 underline decoration-zinc-300 underline-offset-2 hover:text-zinc-700"
                  >
                    cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmingRevoke(true)}
                  className="text-[11px] font-medium text-[#ff3b30] underline decoration-[#ff3b30]/30 underline-offset-2 hover:text-[#d70015]"
                >
                  Revoke
                </button>
              )
            ) : null}
          </div>
          {hasKey && entry.legacyKey ? (
            <span
              className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700"
              title="sha256 seed/legacy hash"
            >
              legacy — rotate
            </span>
          ) : null}
        </>
      )}
      {status ? <span className="text-xs font-medium text-zinc-500">{status}</span> : null}
    </div>
  );
}
