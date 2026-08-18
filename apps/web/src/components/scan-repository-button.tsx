"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@patchbay/ui";
import { apiFetch } from "@/lib/client-fetch";

const POLL_INTERVAL_MS = 2_500;
const MAX_POLLS = 120; // ~5 minutes; scans and graph indexing are bounded by the worker
export const MAX_GRAPH_WAIT_POLLS = 4; // Number of polls to wait for graph index job after scan completion (~10s)

export type ScanStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";
export type GraphStatus = "INDEXING" | "READY" | "FAILED";

export interface ScanItem {
  id?: string;
  status: ScanStatus;
}

export interface GraphIndexJobItem {
  id?: string;
  status: GraphStatus;
}

export interface RepositoryPollData {
  repository?: {
    scans?: ScanItem[];
    graphIndexJobs?: GraphIndexJobItem[];
  };
}

export interface RepositoryPollResponse {
  data?: RepositoryPollData;
}

export interface PollStateEvaluation {
  done: boolean;
  statusText: string;
  shouldRefresh: boolean;
  nextGraphWaitCount: number;
}

/**
 * Pure evaluation function for repository scan + graph index polling state.
 *
 * Terminal conditions:
 * - Scan FAILED -> done, error message, refresh
 * - Graph FAILED -> done, error message, refresh
 * - Scan COMPLETED and Graph READY -> done, complete message, refresh
 * - Scan COMPLETED and Graph empty after grace period -> done, honest "index not queued" message
 *
 * Non-terminal conditions:
 * - Scan QUEUED / RUNNING -> keep polling (even if graphIndexJobs is empty)
 * - Scan COMPLETED and Graph INDEXING -> keep polling
 * - Scan COMPLETED and Graph empty within grace period -> keep polling
 */
export function evaluateScanPoll(
  data: RepositoryPollData | undefined,
  graphWaitCount = 0,
): PollStateEvaluation {
  const latestScan = data?.repository?.scans?.[0];
  const latestGraph = data?.repository?.graphIndexJobs?.[0];

  const scanStatus = latestScan?.status;
  const graphStatus = latestGraph?.status;

  if (!scanStatus) {
    return {
      done: false,
      statusText: "Queued — waiting for the worker…",
      shouldRefresh: false,
      nextGraphWaitCount: 0,
    };
  }

  if (scanStatus === "FAILED") {
    return {
      done: true,
      statusText: "Scan failed — see the scan history for details.",
      shouldRefresh: true,
      nextGraphWaitCount: 0,
    };
  }

  if (scanStatus === "QUEUED" || scanStatus === "RUNNING") {
    const isIndexing = graphStatus === "INDEXING";
    return {
      done: false,
      statusText: `Scanning… (${scanStatus})${isIndexing ? " · indexing graph…" : ""}`,
      shouldRefresh: false,
      nextGraphWaitCount: 0,
    };
  }

  // Scan is COMPLETED here
  if (graphStatus === "FAILED") {
    return {
      done: true,
      statusText: "Graph indexing failed — see the scan history for details.",
      shouldRefresh: true,
      nextGraphWaitCount: 0,
    };
  }

  if (graphStatus === "READY") {
    return {
      done: true,
      statusText: "Scan complete — refreshing…",
      shouldRefresh: true,
      nextGraphWaitCount: 0,
    };
  }

  if (graphStatus === "INDEXING") {
    return {
      done: false,
      statusText: "Scanning… (COMPLETED) · indexing graph…",
      shouldRefresh: false,
      nextGraphWaitCount: 0,
    };
  }

  // Scan is COMPLETED, but graphIndexJobs is empty (wait a few poll cycles for the worker to enqueue it)
  if (graphWaitCount < MAX_GRAPH_WAIT_POLLS) {
    return {
      done: false,
      statusText: "Scan complete · waiting for graph indexing…",
      shouldRefresh: false,
      nextGraphWaitCount: graphWaitCount + 1,
    };
  }

  return {
    done: true,
    statusText: "Graph index not queued — reload to refresh.",
    shouldRefresh: true,
    nextGraphWaitCount: graphWaitCount,
  };
}

/**
 * Enqueues a repository scan via the API, then polls the repository endpoint
 * until the scan and chained graph-index job reach a terminal state,
 * reading object statuses from repository.scans and repository.graphIndexJobs.
 */
export function ScanRepositoryButton({
  repositoryId,
  disabled,
}: {
  repositoryId: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const graphWaitCountRef = useRef(0);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  function scan() {
    setStatus(null);
    graphWaitCountRef.current = 0;
    startTransition(async () => {
      const response = await apiFetch(`/api/repositories/${repositoryId}/scan`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: { message?: string } };
        setStatus(body.error?.message ?? "Failed to enqueue scan");
        return;
      }
      setStatus("Queued — waiting for the worker…");
      router.refresh();
      poll(0);
    });
  }

  function poll(attempt: number) {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      if (attempt >= MAX_POLLS) {
        setStatus("Scan still running — reload to refresh.");
        return;
      }
      let body: RepositoryPollResponse;
      try {
        const response = await apiFetch(`/api/repositories/${repositoryId}`);
        if (!response.ok) {
          setStatus("Failed to check scan status — reload to refresh.");
          return;
        }
        body = (await response.json()) as RepositoryPollResponse;
      } catch {
        setStatus("Failed to check scan status — reload to refresh.");
        return;
      }

      const evaluation = evaluateScanPoll(body.data, graphWaitCountRef.current);
      graphWaitCountRef.current = evaluation.nextGraphWaitCount;
      setStatus(evaluation.statusText);

      if (evaluation.done) {
        if (evaluation.shouldRefresh) {
          router.refresh();
        }
        return;
      }

      poll(attempt + 1);
    }, POLL_INTERVAL_MS);
  }

  return (
    <div className="flex items-center gap-3">
      <Button variant="secondary" size="sm" onClick={scan} loading={pending} disabled={disabled}>
        Scan now
      </Button>
      {status ? <span className="text-xs text-slate-500">{status}</span> : null}
    </div>
  );
}
