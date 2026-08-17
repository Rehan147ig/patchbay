"use client";

import { useEffect, useState } from "react";
import { StatusPill } from "@patchbay/ui";
import { apiFetch } from "@/lib/client-fetch";
import { DETECTION_RUN_STATUS_TONE } from "@/lib/format";
import { formatDate } from "@/lib/format";

interface DetectionRunView {
  id: string;
  adapter: string;
  status: "RUNNING" | "COMPLETED" | "FAILED";
  observedCount: number;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
}

const POLL_INTERVAL_MS = 15_000;

/**
 * Live Watchtower detection-runs feed. Polls /api/watchtower/runs every 15s
 * so a freshly started run appears without a full page reload.
 */
export function WatchtowerRunsPanel() {
  const [runs, setRuns] = useState<DetectionRunView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function refresh() {
      try {
        const response = await apiFetch("/api/watchtower/runs");
        if (!response.ok) {
          setError("Failed to load detection runs");
          return;
        }
        const body = (await response.json()) as { data: { runs: DetectionRunView[] } };
        if (!cancelled) {
          setRuns(body.data.runs);
          setError(null);
        }
      } catch {
        if (!cancelled) setError("Failed to load detection runs");
      } finally {
        if (!cancelled) timer = setTimeout(refresh, POLL_INTERVAL_MS);
      }
    }

    void refresh();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (error) {
    return (
      <p role="alert" className="text-xs text-red-600">
        {error}
      </p>
    );
  }
  if (runs === null) {
    return <p className="text-xs text-slate-400">Loading detection runs…</p>;
  }
  if (runs.length === 0) {
    return <p className="text-xs text-slate-400">No detection runs yet.</p>;
  }

  return (
    <ul className="space-y-1.5">
      {runs.map((run) => (
        <li key={run.id} className="flex items-center justify-between gap-3 text-xs">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate font-mono text-slate-700">{run.adapter}</span>
            <StatusPill label={run.status} tone={DETECTION_RUN_STATUS_TONE[run.status]} />
            {run.observedCount > 0 ? (
              <span className="tabular-nums text-slate-500">{run.observedCount} observed</span>
            ) : null}
          </div>
          <span className="shrink-0 text-slate-400">
            {(run.completedAt ?? run.startedAt) ? formatDate(run.completedAt ?? run.startedAt) : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}
