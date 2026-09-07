"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@patchbay/ui";
import { apiFetch } from "@/lib/client-fetch";
import { DeniedState, ErrorState, LoadingSkeleton, StaleBadge } from "@/components/data-states";

interface QueuesSnapshot {
  status: "ok" | "degraded";
  redis: string;
  queue: Record<string, number> | null;
  dlqQueue: Record<string, number> | null;
  openDeadLetters: number;
  workers: Array<{ workerId: string; fresh: boolean; lastBeatAt: string }>;
  jobOutcomes: Record<string, { completed: number; failed: number }>;
}

export interface DeadLetterRow {
  id: string;
  jobType: string;
  errorCode: string | null;
  errorMessage: string | null;
  attemptsMade: number;
  correlationId: string | null;
  createdAt: string;
  payloadPreview: string;
}

/**
 * Operations interactions (WP12 §11.2): live queue snapshot with refresh,
 * dead-letter replay (ADMIN only — others get the reason as a tooltip, not
 * a dead button). Server props carry gates, certifications, and dead
 * letters; the queue snapshot polls the API so depth is never stale.
 */
export function OperationsClient({
  deadLetters,
  isAdmin,
}: {
  deadLetters: DeadLetterRow[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<QueuesSnapshot | null>(null);
  const [snapshotError, setSnapshotError] = useState<{ message: string; denied: boolean } | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [replayingId, setReplayingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await apiFetch("/api/operations/queues", { method: "GET" });
      if (response.status === 403) {
        setSnapshotError({ message: "Queue monitoring requires ADMIN.", denied: true });
        return;
      }
      if (!response.ok) {
        const body = (await response.json()) as { error?: { message?: string } };
        setSnapshotError({
          message: body.error?.message ?? "Queue snapshot failed",
          denied: false,
        });
        return;
      }
      const body = (await response.json()) as { data: QueuesSnapshot };
      setSnapshot(body.data);
      setSnapshotError(null);
    } catch {
      setSnapshotError({ message: "Network error while loading queue depth", denied: false });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(load, 30_000);
    return () => clearInterval(timer);
  }, [load]);

  async function replay(id: string) {
    setReplayingId(id);
    setNotice(null);
    try {
      const response = await apiFetch("/api/operations/replay", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deadLetterId: id }),
      });
      const body = (await response.json()) as {
        data?: { jobId: string };
        error?: { message?: string };
      };
      if (!response.ok) {
        setNotice({ tone: "error", text: body.error?.message ?? "Replay failed" });
        return;
      }
      setNotice({ tone: "ok", text: `Replayed as job ${body.data?.jobId}.` });
      router.refresh();
    } catch {
      setNotice({ tone: "error", text: "Network error while replaying" });
    } finally {
      setReplayingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <section aria-label="Queue depth">
        <div className="mb-2 flex items-center gap-2">
          <h2 className="text-[15px] font-semibold text-zinc-900">Queue depth</h2>
          {snapshot?.status === "degraded" ? (
            <StaleBadge label="Redis unreachable — DB counts only" />
          ) : null}
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setLoading(true);
              void load();
            }}
          >
            Refresh
          </Button>
        </div>
        {loading ? (
          <LoadingSkeleton rows={2} label="Loading queue depth" />
        ) : snapshotError ? (
          snapshotError.denied ? (
            <DeniedState description="Queue monitoring requires the ADMIN role." />
          ) : (
            <ErrorState message={snapshotError.message} />
          )
        ) : snapshot ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <DepthCard label="Waiting" value={snapshot.queue?.waiting ?? null} />
            <DepthCard label="Active" value={snapshot.queue?.active ?? null} />
            <DepthCard label="Failed" value={snapshot.queue?.failed ?? null} />
            <DepthCard label="DLQ waiting" value={snapshot.dlqQueue?.waiting ?? null} />
          </div>
        ) : null}
        {snapshot && snapshot.workers.length > 0 ? (
          <p className="mt-2 text-[12px] text-zinc-500">
            Workers:{" "}
            {snapshot.workers
              .map((w) => `${w.workerId} (${w.fresh ? "live" : `stale since ${w.lastBeatAt}`})`)
              .join(", ")}
          </p>
        ) : null}
      </section>

      <section aria-label="Dead letters">
        <h2 className="mb-2 text-[15px] font-semibold text-zinc-900">
          Dead letters {deadLetters.length > 0 ? `(${deadLetters.length} open)` : ""}
        </h2>
        {notice ? (
          <p
            role={notice.tone === "error" ? "alert" : "status"}
            className="mb-2 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2 text-[13px] text-zinc-700"
          >
            {notice.text}
          </p>
        ) : null}
        {deadLetters.length === 0 ? (
          <p className="rounded-xl border border-dashed border-zinc-300 px-4 py-6 text-center text-[13px] text-zinc-500">
            No open dead letters. Terminally failed jobs land here with classified error codes and a
            replay action.
          </p>
        ) : (
          <ul className="space-y-2">
            {deadLetters.map((row) => (
              <li key={row.id} className="rounded-xl border border-zinc-200 bg-white px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="min-w-0 flex-1 font-mono text-[12px] font-semibold text-zinc-900">
                    {row.jobType}
                  </p>
                  <span className="rounded-full bg-red-100 px-2.5 py-1 font-mono text-[11px] text-red-800">
                    {row.errorCode ?? "JOB_FAILED"}
                  </span>
                  <span className="text-[11px] text-zinc-500">
                    {row.attemptsMade} attempts · {new Date(row.createdAt).toLocaleString()}
                  </span>
                  <span
                    title={
                      isAdmin
                        ? "Re-enqueue this job after freshness checks"
                        : "Replaying dead letters requires the ADMIN role"
                    }
                  >
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={!isAdmin || replayingId === row.id}
                      onClick={() => replay(row.id)}
                    >
                      {replayingId === row.id ? "Replaying…" : "Replay"}
                    </Button>
                  </span>
                </div>
                {row.errorMessage ? (
                  <p className="mt-1 truncate text-[12px] text-zinc-600">{row.errorMessage}</p>
                ) : null}
                {row.correlationId ? (
                  <p className="mt-1 font-mono text-[11px] text-zinc-500">
                    Correlation ID: {row.correlationId}
                  </p>
                ) : null}
                <details className="mt-1">
                  <summary className="cursor-pointer text-[11px] text-zinc-500">
                    Scrubbed payload preview
                  </summary>
                  <pre className="mt-1 max-h-32 overflow-auto rounded bg-zinc-50 p-2 font-mono text-[11px] text-zinc-600">
                    {row.payloadPreview}
                  </pre>
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function DepthCard({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-widest text-zinc-400">{label}</p>
      <p className="mt-1 text-[20px] font-semibold text-zinc-900">{value === null ? "—" : value}</p>
    </div>
  );
}
