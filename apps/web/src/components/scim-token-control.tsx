"use client";

import { useState, useTransition } from "react";
import { Button } from "@patchbay/ui";
import { apiFetch } from "@/lib/client-fetch";

export interface ScimTokenIssueResult {
  scimToken: string;
  tokenPrefix: string;
  note: string;
}

/** Response shape the SCIM token route returns; guards against malformed replies. */
export function parseScimTokenIssue(body: unknown): ScimTokenIssueResult | null {
  if (typeof body !== "object" || body === null) return null;
  const data = (body as { data?: unknown }).data;
  if (typeof data !== "object" || data === null) return null;
  const { scimToken, tokenPrefix, note } = data as {
    scimToken?: unknown;
    tokenPrefix?: unknown;
    note?: unknown;
  };
  if (typeof scimToken !== "string" || !scimToken.startsWith("pb_scim_")) return null;
  return {
    scimToken,
    tokenPrefix: typeof tokenPrefix === "string" ? tokenPrefix : "",
    note: typeof note === "string" ? note : "",
  };
}

/**
 * Organization SCIM token actions for the settings page. ADMIN-only on the
 * server (the route enforces the role); non-admins render nothing. The
 * plaintext token is shown exactly once — Patchbay stores only its hash and
 * never returns it again. Re-issuing rotates (old token works until the next
 * rotation); revoking clears every stored hash immediately.
 */
export function ScimTokenControl({
  hasToken,
  tokenPrefix,
  isAdmin,
}: {
  hasToken: boolean;
  tokenPrefix: string | null;
  isAdmin: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);
  const [issued, setIssued] = useState<ScimTokenIssueResult | null>(null);
  const [enrolled, setEnrolled] = useState(hasToken);
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);

  if (!isAdmin) return null;

  function issueToken() {
    setStatus(null);
    setIssued(null);
    setConfirmingRevoke(false);
    startTransition(async () => {
      const response = await apiFetch("/api/scim/token", { method: "POST" });
      if (!response.ok) {
        const body = (await response.json()) as { error?: { message?: string } };
        setStatus(body.error?.message ?? "Failed to issue SCIM token");
        return;
      }
      const parsed = parseScimTokenIssue(await response.json());
      if (!parsed) {
        setStatus("Unexpected response — token not shown");
        return;
      }
      setIssued(parsed);
      setEnrolled(true);
      setStatus(null);
    });
  }

  function revokeToken() {
    setStatus(null);
    setIssued(null);
    startTransition(async () => {
      const response = await apiFetch("/api/scim/token", { method: "DELETE" });
      if (!response.ok) {
        const body = (await response.json()) as { error?: { message?: string } };
        setStatus(body.error?.message ?? "Failed to revoke SCIM token");
        return;
      }
      setEnrolled(false);
      setConfirmingRevoke(false);
      setStatus("SCIM disabled — all issued tokens stopped working.");
    });
  }

  return (
    <div className="flex flex-col items-start gap-1.5">
      {issued ? (
        <div className="w-full max-w-md rounded-[16px] border border-amber-200 bg-amber-50 p-3 shadow-sm">
          <p className="text-xs font-semibold text-amber-800">Store this token now — shown once</p>
          <code className="mt-1.5 block break-all rounded-xl border border-amber-200 bg-white px-2.5 py-1.5 font-mono text-[11px] leading-relaxed text-[#1d1d1f]">
            {issued.scimToken}
          </code>
          <p className="mt-1.5 text-[11px] leading-relaxed text-amber-700">{issued.note}</p>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void navigator.clipboard?.writeText(issued.scimToken)}
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
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={issueToken}
            loading={pending}
            className="rounded-full"
          >
            {enrolled ? "Rotate token" : "Generate SCIM token"}
          </Button>
          {enrolled ? (
            confirmingRevoke ? (
              <>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={revokeToken}
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
      )}
      {enrolled && tokenPrefix ? (
        <span className="font-mono text-[11px] text-zinc-500">token prefix: {tokenPrefix}…</span>
      ) : null}
      {status ? <span className="text-xs font-medium text-zinc-500">{status}</span> : null}
    </div>
  );
}
