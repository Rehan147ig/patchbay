"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@patchbay/ui";
import { apiFetch } from "@/lib/client-fetch";

export interface AutonomyPolicyState {
  maxOpenAutonomousPRs: number;
  minimumReleaseAgeDays: number;
  groupMinorPatches: boolean;
  vulnBypassStability: boolean;
  excludedPackages: string[];
}

function parsePolicy(body: unknown): AutonomyPolicyState | null {
  if (typeof body !== "object" || body === null) return null;
  const data = (body as { data?: unknown }).data;
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;
  if (
    typeof d.maxOpenAutonomousPRs !== "number" ||
    typeof d.minimumReleaseAgeDays !== "number" ||
    typeof d.groupMinorPatches !== "boolean" ||
    typeof d.vulnBypassStability !== "boolean" ||
    !Array.isArray(d.excludedPackages)
  ) {
    return null;
  }
  return {
    maxOpenAutonomousPRs: d.maxOpenAutonomousPRs,
    minimumReleaseAgeDays: d.minimumReleaseAgeDays,
    groupMinorPatches: d.groupMinorPatches,
    vulnBypassStability: d.vulnBypassStability,
    excludedPackages: d.excludedPackages.filter((p): p is string => typeof p === "string"),
  };
}

/**
 * Autonomous-track guardrails for the settings page (Renovate-style policy:
 * concurrency cap, minimum release age, minor grouping, CVE bypass,
 * exclusions). Loads current policy on mount; ADMIN-only editing (the route
 * enforces the role, non-admins get a read-only summary).
 */
export function AutonomyPolicyControl({ isAdmin }: { isAdmin: boolean }) {
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);
  const [policy, setPolicy] = useState<AutonomyPolicyState | null>(null);
  const [excludedText, setExcludedText] = useState("");

  useEffect(() => {
    let cancelled = false;
    apiFetch("/api/settings/autonomy")
      .then(async (response) => {
        if (!response.ok || cancelled) return;
        const parsed = parsePolicy(await response.json());
        if (parsed && !cancelled) {
          setPolicy(parsed);
          setExcludedText(parsed.excludedPackages.join(", "));
        }
      })
      .catch(() => {
        if (!cancelled) setStatus("Could not load autonomy policy");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function save(next: AutonomyPolicyState) {
    setStatus(null);
    startTransition(async () => {
      const response = await apiFetch("/api/settings/autonomy", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: { message?: string } };
        setStatus(body.error?.message ?? "Failed to save autonomy policy");
        return;
      }
      const parsed = parsePolicy(await response.json());
      if (!parsed) {
        setStatus("Unexpected response — policy may not have saved");
        return;
      }
      setPolicy(parsed);
      setExcludedText(parsed.excludedPackages.join(", "));
      setStatus("Saved");
    });
  }

  if (!policy) {
    return <p className="text-xs text-zinc-500">{status ?? "Loading autonomy policy…"}</p>;
  }

  const excludedPackages = excludedText
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const row = "flex items-center justify-between gap-3 border-b border-zinc-100 pb-3";
  const label = "text-xs font-medium text-zinc-500";
  const numberInput =
    "h-8 w-20 rounded-xl border border-zinc-200 bg-white px-2.5 text-xs font-medium text-[#1d1d1f] shadow-sm focus:border-[#0071e3] focus:outline-none focus:ring-2 focus:ring-[#0071e3]/20 disabled:opacity-50";

  return (
    <div className="space-y-3 text-sm">
      <div className={row}>
        <span className={label}>Max open autonomous PRs</span>
        <input
          type="number"
          min={0}
          max={50}
          disabled={!isAdmin || pending}
          value={policy.maxOpenAutonomousPRs}
          onChange={(e) => setPolicy({ ...policy, maxOpenAutonomousPRs: Number(e.target.value) })}
          className={numberInput}
          aria-label="Max open autonomous PRs"
        />
      </div>
      <div className={row}>
        <span className={label}>Minimum release age (days)</span>
        <input
          type="number"
          min={0}
          max={30}
          disabled={!isAdmin || pending}
          value={policy.minimumReleaseAgeDays}
          onChange={(e) => setPolicy({ ...policy, minimumReleaseAgeDays: Number(e.target.value) })}
          className={numberInput}
          aria-label="Minimum release age in days"
        />
      </div>
      <div className={row}>
        <span className={label}>Group minor bumps per package</span>
        <input
          type="checkbox"
          disabled={!isAdmin || pending}
          checked={policy.groupMinorPatches}
          onChange={(e) => setPolicy({ ...policy, groupMinorPatches: e.target.checked })}
          aria-label="Group minor bumps"
        />
      </div>
      <div className={row}>
        <span className={label}>CVE fixes skip the age wait</span>
        <input
          type="checkbox"
          disabled={!isAdmin || pending}
          checked={policy.vulnBypassStability}
          onChange={(e) => setPolicy({ ...policy, vulnBypassStability: e.target.checked })}
          aria-label="CVE fixes skip the age wait"
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="autonomy-excluded" className={label}>
          Excluded packages (comma-separated)
        </label>
        <input
          id="autonomy-excluded"
          type="text"
          disabled={!isAdmin || pending}
          value={excludedText}
          onChange={(e) => setExcludedText(e.target.value)}
          placeholder="react, @acme/internal"
          className="h-8 w-full rounded-xl border border-zinc-200 bg-white px-2.5 text-xs font-medium text-[#1d1d1f] shadow-sm focus:border-[#0071e3] focus:outline-none focus:ring-2 focus:ring-[#0071e3]/20 disabled:opacity-50"
        />
      </div>
      {isAdmin && (
        <Button disabled={pending} onClick={() => save({ ...policy, excludedPackages })}>
          {pending ? "Saving…" : "Save autonomy policy"}
        </Button>
      )}
      {status && <p className="text-xs text-zinc-500">{status}</p>}
      <p className="text-xs text-zinc-400">
        Draft PRs only, never auto-merge. Every bump is sandbox-proven and needs human approval
        before a PR opens.
      </p>
    </div>
  );
}
