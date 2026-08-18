import { describe, expect, it } from "vitest";
import {
  evaluateScanPoll,
  MAX_GRAPH_WAIT_POLLS,
  type RepositoryPollData,
} from "./scan-repository-button";

describe("evaluateScanPoll", () => {
  it("handles missing or empty scan data as queued", () => {
    expect(evaluateScanPoll(undefined)).toEqual({
      done: false,
      statusText: "Queued — waiting for the worker…",
      shouldRefresh: false,
      nextGraphWaitCount: 0,
    });

    expect(evaluateScanPoll({ repository: { scans: [] } })).toEqual({
      done: false,
      statusText: "Queued — waiting for the worker…",
      shouldRefresh: false,
      nextGraphWaitCount: 0,
    });
  });

  it("keeps polling when scan is QUEUED or RUNNING even if graphIndexJobs is empty", () => {
    const queuedData: RepositoryPollData = {
      repository: {
        scans: [{ id: "s-1", status: "QUEUED" }],
        graphIndexJobs: [],
      },
    };
    expect(evaluateScanPoll(queuedData)).toEqual({
      done: false,
      statusText: "Scanning… (QUEUED)",
      shouldRefresh: false,
      nextGraphWaitCount: 0,
    });

    const runningData: RepositoryPollData = {
      repository: {
        scans: [{ id: "s-1", status: "RUNNING" }],
        graphIndexJobs: [],
      },
    };
    expect(evaluateScanPoll(runningData)).toEqual({
      done: false,
      statusText: "Scanning… (RUNNING)",
      shouldRefresh: false,
      nextGraphWaitCount: 0,
    });
  });

  it("indicates graph indexing in progress if scan is still running but graph job started", () => {
    const runningWithGraph: RepositoryPollData = {
      repository: {
        scans: [{ id: "s-1", status: "RUNNING" }],
        graphIndexJobs: [{ id: "g-1", status: "INDEXING" }],
      },
    };
    expect(evaluateScanPoll(runningWithGraph)).toEqual({
      done: false,
      statusText: "Scanning… (RUNNING) · indexing graph…",
      shouldRefresh: false,
      nextGraphWaitCount: 0,
    });
  });

  it("stops immediately with refresh when scan status is FAILED", () => {
    const failedScan: RepositoryPollData = {
      repository: {
        scans: [{ id: "s-1", status: "FAILED" }],
        graphIndexJobs: [],
      },
    };
    expect(evaluateScanPoll(failedScan)).toEqual({
      done: true,
      statusText: "Scan failed — see the scan history for details.",
      shouldRefresh: true,
      nextGraphWaitCount: 0,
    });
  });

  it("stops immediately with refresh when graph index status is FAILED", () => {
    const failedGraph: RepositoryPollData = {
      repository: {
        scans: [{ id: "s-1", status: "COMPLETED" }],
        graphIndexJobs: [{ id: "g-1", status: "FAILED" }],
      },
    };
    expect(evaluateScanPoll(failedGraph)).toEqual({
      done: true,
      statusText: "Graph indexing failed — see the scan history for details.",
      shouldRefresh: true,
      nextGraphWaitCount: 0,
    });
  });

  it("completes and refreshes when scan is COMPLETED and graph is READY", () => {
    const completedReady: RepositoryPollData = {
      repository: {
        scans: [{ id: "s-1", status: "COMPLETED" }],
        graphIndexJobs: [{ id: "g-1", status: "READY" }],
      },
    };
    expect(evaluateScanPoll(completedReady)).toEqual({
      done: true,
      statusText: "Scan complete — refreshing…",
      shouldRefresh: true,
      nextGraphWaitCount: 0,
    });
  });

  it("keeps polling while scan is COMPLETED and graph is INDEXING", () => {
    const indexing: RepositoryPollData = {
      repository: {
        scans: [{ id: "s-1", status: "COMPLETED" }],
        graphIndexJobs: [{ id: "g-1", status: "INDEXING" }],
      },
    };
    expect(evaluateScanPoll(indexing)).toEqual({
      done: false,
      statusText: "Scanning… (COMPLETED) · indexing graph…",
      shouldRefresh: false,
      nextGraphWaitCount: 0,
    });
  });

  it("waits for graph index job when scan is COMPLETED and graph is empty within grace period", () => {
    const completedNoGraph: RepositoryPollData = {
      repository: {
        scans: [{ id: "s-1", status: "COMPLETED" }],
        graphIndexJobs: [],
      },
    };

    // First attempt waiting for graph job
    const res0 = evaluateScanPoll(completedNoGraph, 0);
    expect(res0.done).toBe(false);
    expect(res0.statusText).toBe("Scan complete · waiting for graph indexing…");
    expect(res0.nextGraphWaitCount).toBe(1);

    // Subsequent attempts within threshold
    const res1 = evaluateScanPoll(completedNoGraph, 1);
    expect(res1.done).toBe(false);
    expect(res1.nextGraphWaitCount).toBe(2);
  });

  it("shows honest index not queued message when grace period expires", () => {
    const completedNoGraph: RepositoryPollData = {
      repository: {
        scans: [{ id: "s-1", status: "COMPLETED" }],
        graphIndexJobs: [],
      },
    };

    const resExpired = evaluateScanPoll(completedNoGraph, MAX_GRAPH_WAIT_POLLS);
    expect(resExpired.done).toBe(true);
    expect(resExpired.shouldRefresh).toBe(true);
    expect(resExpired.statusText).toBe("Graph index not queued — reload to refresh.");
  });
});
