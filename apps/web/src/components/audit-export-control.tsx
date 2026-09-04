"use client";

import { useState, useTransition } from "react";
import { Button } from "@patchbay/ui";
import { apiFetch } from "@/lib/client-fetch";

export interface AuditExportTokenIssueResult {
  auditExportToken: string;
  tokenPrefix: string;
  note: string;
}

/** Response shape the audit token route returns; guards against malformed replies. */
export function parseAuditExportTokenIssue(body: unknown): AuditExportTokenIssueResult | null {
  if (typeof body !== "object" || body === null) return null;
  const data = (body as { data?: unknown }).data;
  if (typeof data !== "object" || data === null) return null;
  const { auditExportToken, tokenPrefix, note } = data as {
    auditExportToken?: unknown;
    tokenPrefix?: unknown;
    note?: unknown;
  };
  if (typeof auditExportToken !== "string" || !auditExportToken.startsWith("pb_audit_")) {
    return null;
  }
  return {
    auditExportToken,
    tokenPrefix: typeof tokenPrefix === "string" ? tokenPrefix : "",
    note: typeof note === "string" ? note : "",
  };
}

/**
 * SIEM audit-export actions for the settings page. ADMIN-only on the server;
 * non-admins render nothing. Shows the streaming endpoint, issues/rotates the
 * `pb_audit_` bearer token (shown exactly once), and offers one-click
 * 24h downloads (session-cookie authenticated).
 */
export function AuditExportControl({
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
  const [issued, setIssued] = useState<AuditExportTokenIssueResult | null>(null);
  const [enrolled, setEnrolled] = useState(hasToken);
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);

  if (!isAdmin) return null;

  function issueToken() {
    setStatus(null);
    setIssued(null);
    setConfirmingRevoke(false);
    startTransition(async () => {
      const response = await apiFetch("/api/audit/token", { method: "POST" });
      if (!response.ok) {
        const body = (await response.json()) as { error?: { message?: string } };
        setStatus(body.error?.message ?? "Failed to issue export token");
        return;
      }
      const parsed = parseAuditExportTokenIssue(await response.json());
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
      const response = await apiFetch("/api/audit/token", { method: "DELETE" });
      if (!response.ok) {
        const body = (await response.json()) as { error?: { message?: string } };
        setStatus(body.error?.message ?? "Failed to revoke export token");
        return;
      }
      setEnrolled(false);
      setConfirmingRevoke(false);
      setStatus("Export token revoked — SOC automation using it stops working.");
    });
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <code className="block w-full break-all rounded-xl border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 font-mono text-[11px] text-zinc-600">
        GET /api/audit/export?format=jsonl
      </code>
      <div className="flex flex-wrap items-center gap-2">
        <a
          href="/api/audit/export?format=jsonl"
          className="rounded-full bg-[#0071e3] px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-[#0077ed]"
        >
          Download 24h JSONL
        </a>
        <a
          href="/api/audit/export?format=cef"
          className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-600 shadow-sm transition-colors hover:bg-zinc-50"
        >
          Download 24h CEF
        </a>
      </div>
      {issued ? (
        <div className="w-full max-w-md rounded-[16px] border border-amber-200 bg-amber-50 p-3 shadow-sm">
          <p className="text-xs font-semibold text-amber-800">Store this token now — shown once</p>
          <code className="mt-1.5 block break-all rounded-xl border border-amber-200 bg-white px-2.5 py-1.5 font-mono text-[11px] leading-relaxed text-[#1d1d1f]">
            {issued.auditExportToken}
          </code>
          <p className="mt-1.5 text-[11px] leading-relaxed text-amber-700">{issued.note}</p>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void navigator.clipboard?.writeText(issued.auditExportToken)}
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
            {enrolled ? "Rotate token" : "Generate export token"}
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
