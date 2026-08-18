import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "bullmq";
import { prisma } from "@patchbay/db";
import { processGraphIndex } from "./graph-index";

vi.mock("@patchbay/db", async () => {
  const actual = await vi.importActual<typeof import("@patchbay/db")>("@patchbay/db");
  return {
    ...actual,
    prisma: {
      repository: { findUnique: vi.fn() },
      graphIndexJob: { findUnique: vi.fn(), update: vi.fn() },
      graphSnapshot: {
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      graphNode: { findMany: vi.fn(), createMany: vi.fn() },
      graphEdge: { findMany: vi.fn(), createMany: vi.fn() },
      graphSourceEvidence: { findMany: vi.fn(), createMany: vi.fn() },
      vendor: { findMany: vi.fn() },
      $transaction: vi.fn(),
    },
    pruneGraphSnapshots: vi.fn(),
  };
});

vi.mock("@patchbay/repo-analysis", async () => {
  const actual =
    await vi.importActual<typeof import("@patchbay/repo-analysis")>("@patchbay/repo-analysis");
  return {
    ...actual,
    resolveFixtureDir: vi.fn().mockReturnValue("C:/fixtures/openai-node-legacy"),
    extractGraph: vi.fn(),
    computeReextractionSet: vi.fn(),
    inverseIndex: vi.fn(),
    mergeIncrementalExtraction: vi.fn(),
  };
});

vi.mock("../lib/audit", () => ({
  writeAuditEvent: vi.fn(),
}));

vi.mock("@patchbay/audit", () => ({
  AuditAction: {
    GRAPH_INDEX_STARTED: "graph.index.started",
    GRAPH_INDEX_REUSED: "graph.index.reused",
    GRAPH_INDEX_COMPLETED: "graph.index.completed",
    GRAPH_INDEX_FAILED: "graph.index.failed",
  },
}));

vi.mock("@patchbay/domain", async () => {
  const actual = await vi.importActual<typeof import("@patchbay/domain")>("@patchbay/domain");
  return {
    ...actual,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };
});

import {
  computeReextractionSet,
  extractGraph,
  inverseIndex,
  mergeIncrementalExtraction,
} from "@patchbay/repo-analysis";
import { pruneGraphSnapshots } from "@patchbay/db";

const job = (data: unknown) => ({ data }) as Job;

function prevSnapshotRows() {
  return {
    nodes: [
      {
        id: "n-index",
        stableKey: "m:src/index.ts",
        kind: "MODULE",
        displayName: "index",
        filePath: "src/index.ts",
        startLine: 1,
        endLine: 10,
        propertiesJson: null,
        contentHash: "h-index",
      },
      {
        id: "n-logger",
        stableKey: "m:src/lib/logger.ts",
        kind: "MODULE",
        displayName: "logger",
        filePath: "src/lib/logger.ts",
        startLine: 1,
        endLine: 5,
        propertiesJson: null,
        contentHash: "h-logger",
      },
    ],
    edges: [
      {
        id: "e-1",
        fromNodeId: "n-index",
        toNodeId: "n-logger",
        kind: "IMPORTS",
        provenance: "EXTRACTED",
        confidence: 1,
        evidenceJson: null,
      },
    ],
    evidence: [
      {
        nodeId: "n-logger",
        edgeId: null,
        filePath: "src/lib/logger.ts",
        startLine: 1,
        endLine: 5,
        sourceHash: "ev-hash",
        extractor: "graph-extractor",
        extractorVersion: "1",
      },
    ],
  };
}

function baseMocks() {
  vi.mocked(prisma.repository.findUnique).mockResolvedValue({
    id: "repo-1",
    organizationId: "org-1",
    metadata: { fixture: "openai-node-legacy" },
  } as never);
  vi.mocked(prisma.graphIndexJob.findUnique).mockResolvedValue({
    id: "job-1",
    repositoryId: "repo-1",
    mode: "INCREMENTAL",
    status: "PENDING",
    changedPaths: ["src/lib/logger.ts"],
  } as never);
  vi.mocked(prisma.graphIndexJob.update).mockResolvedValue({} as never);
  vi.mocked(prisma.vendor.findMany).mockResolvedValue([
    { slug: "openai" },
    { slug: "stripe" },
  ] as never);
  vi.mocked(prisma.graphSnapshot.findFirst).mockImplementation(((args: {
    where?: { commitSha?: string };
  }) => {
    if (args?.where?.commitSha) return Promise.resolve(null);
    return Promise.resolve({
      id: "prev-1",
      commitSha: "sha-old",
      rootTreeHash: "tree-old",
    });
  }) as never);
  vi.mocked(prisma.graphSnapshot.create).mockResolvedValue({ id: "snap-1" } as never);
  vi.mocked(prisma.graphSnapshot.update).mockResolvedValue({
    id: "snap-1",
    nodesAffected: 2,
    edgesAffected: 1,
  } as never);
  vi.mocked(prisma.graphNode.createMany).mockResolvedValue({ count: 2 } as never);
  vi.mocked(prisma.graphEdge.createMany).mockResolvedValue({ count: 1 } as never);
  vi.mocked(prisma.graphSourceEvidence.createMany).mockResolvedValue({ count: 1 } as never);
  const prev = prevSnapshotRows();
  vi.mocked(prisma.graphNode.findMany).mockResolvedValue(prev.nodes as never);
  vi.mocked(prisma.graphEdge.findMany).mockResolvedValue(prev.edges as never);
  vi.mocked(prisma.graphSourceEvidence.findMany).mockResolvedValue(prev.evidence as never);
  vi.mocked(inverseIndex).mockReturnValue({
    reverseImports: new Map([["src/lib/logger.ts", ["src/index.ts"]]]),
    reverseCalls: new Map(),
  });
  vi.mocked(prisma.$transaction).mockImplementation((async (fn: unknown) =>
    (fn as (tx: unknown) => Promise<unknown>)(prisma)) as never);
  vi.mocked(pruneGraphSnapshots).mockResolvedValue({
    repositoryId: "repo-1",
    readyDeleted: 0,
    staleDeleted: 0,
    keptReady: 1,
  } as never);
}

describe("processGraphIndex incremental wiring (WP5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("re-extracts only invalidated files and merges with the baseline snapshot", async () => {
    baseMocks();
    vi.mocked(computeReextractionSet).mockReturnValue({
      reextract: ["src/index.ts", "src/lib/logger.ts"],
      changed: ["src/lib/logger.ts"],
      invalidated: ["src/index.ts"],
      invalidatingManifests: [],
    });
    vi.mocked(extractGraph).mockResolvedValue({
      commitSha: "sha-new",
      rootTreeHash: "tree-new",
      nodeFacts: [
        {
          key: "m:src/index.ts",
          kind: "MODULE",
          displayName: "index",
          filePath: "src/index.ts",
          startLine: 1,
          endLine: 10,
          properties: {},
          contentHash: "h-index-new",
          evidence: [],
        },
      ],
      edgeFacts: [],
      errors: [],
    });
    vi.mocked(mergeIncrementalExtraction).mockImplementation((baseline, incremental) => ({
      commitSha: incremental.commitSha,
      rootTreeHash: incremental.rootTreeHash,
      nodeFacts: [
        ...incremental.nodeFacts,
        {
          key: "m:src/lib/logger.ts",
          kind: "MODULE",
          displayName: "logger",
          filePath: "src/lib/logger.ts",
          startLine: 1,
          endLine: 5,
          properties: {},
          contentHash: "h-logger",
          evidence: [],
        },
      ],
      edgeFacts: [],
      errors: [],
    }));

    const result = await processGraphIndex(
      job({ jobId: "job-1", repositoryId: "repo-1", correlationId: "c-1", mode: "INCREMENTAL" }),
    );

    expect(extractGraph).toHaveBeenCalledWith(
      expect.objectContaining({
        changedFiles: new Map([
          ["src/index.ts", ""],
          ["src/lib/logger.ts", ""],
        ]),
      }),
    );
    expect(mergeIncrementalExtraction).toHaveBeenCalled();
    expect(prisma.graphSnapshot.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          commitSha: "sha-new",
          sourceHash: expect.stringMatching(/^[0-9a-f]{16}$/),
        }),
      }),
    );
    expect(result).toMatchObject({
      snapshotId: "snap-1",
      reused: false,
      nodeCount: 2,
      mode: "INCREMENTAL",
      reextractedPaths: ["src/index.ts", "src/lib/logger.ts"],
    });
  });

  it("falls back to a full extraction when a manifest change invalidates everything", async () => {
    baseMocks();
    vi.mocked(prisma.graphIndexJob.findUnique).mockResolvedValue({
      id: "job-1",
      repositoryId: "repo-1",
      mode: "INCREMENTAL",
      status: "PENDING",
      changedPaths: ["pnpm-lock.yaml"],
    } as never);
    vi.mocked(computeReextractionSet).mockReturnValue({
      reextract: ["pnpm-lock.yaml", "src/index.ts", "src/lib/logger.ts"],
      changed: ["pnpm-lock.yaml"],
      invalidated: ["src/index.ts", "src/lib/logger.ts"],
      invalidatingManifests: ["pnpm-lock.yaml"],
    });
    vi.mocked(extractGraph).mockResolvedValue({
      commitSha: "sha-new",
      rootTreeHash: "tree-new",
      nodeFacts: [],
      edgeFacts: [],
      errors: [],
    });

    const result = await processGraphIndex(
      job({ jobId: "job-1", repositoryId: "repo-1", correlationId: "c-1", mode: "INCREMENTAL" }),
    );

    expect(extractGraph).toHaveBeenCalledWith(expect.objectContaining({ changedFiles: undefined }));
    expect(mergeIncrementalExtraction).not.toHaveBeenCalled();
    expect(result.reextractedPaths).toBeNull();
  });

  it("runs retention after a successful snapshot and reports the result", async () => {
    baseMocks();
    vi.mocked(computeReextractionSet).mockReturnValue({
      reextract: ["src/lib/logger.ts"],
      changed: ["src/lib/logger.ts"],
      invalidated: [],
      invalidatingManifests: [],
    });
    vi.mocked(extractGraph).mockResolvedValue({
      commitSha: "sha-new",
      rootTreeHash: "tree-new",
      nodeFacts: [
        {
          key: "m:src/lib/logger.ts",
          kind: "MODULE",
          displayName: "logger",
          filePath: "src/lib/logger.ts",
          startLine: 1,
          endLine: 5,
          properties: {},
          contentHash: "h-logger-new",
          evidence: [],
        },
      ],
      edgeFacts: [],
      errors: [],
    });
    vi.mocked(mergeIncrementalExtraction).mockImplementation((_, incremental) => ({
      commitSha: incremental.commitSha,
      rootTreeHash: incremental.rootTreeHash,
      nodeFacts: incremental.nodeFacts,
      edgeFacts: [],
      errors: [],
    }));

    const result = await processGraphIndex(
      job({ jobId: "job-1", repositoryId: "repo-1", correlationId: "c-1", mode: "INCREMENTAL" }),
    );

    expect(pruneGraphSnapshots).toHaveBeenCalledWith({
      organizationId: "org-1",
      repositoryId: "repo-1",
    });
    expect(result.retention).toEqual({ readyDeleted: 0, staleDeleted: 0 });
  });

  it("loads the previous snapshot facts for the reverse index", async () => {
    baseMocks();
    vi.mocked(computeReextractionSet).mockReturnValue({
      reextract: ["src/lib/logger.ts"],
      changed: ["src/lib/logger.ts"],
      invalidated: [],
      invalidatingManifests: [],
    });
    vi.mocked(extractGraph).mockResolvedValue({
      commitSha: "sha-new",
      rootTreeHash: "tree-new",
      nodeFacts: [],
      edgeFacts: [],
      errors: [],
    });
    vi.mocked(mergeIncrementalExtraction).mockImplementation((baseline, incremental) => ({
      commitSha: incremental.commitSha,
      rootTreeHash: incremental.rootTreeHash,
      nodeFacts: baseline.nodeFacts,
      edgeFacts: baseline.edgeFacts,
      errors: [],
    }));

    await processGraphIndex(
      job({ jobId: "job-1", repositoryId: "repo-1", correlationId: "c-1", mode: "INCREMENTAL" }),
    );

    expect(prisma.graphNode.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ snapshotId: "prev-1", repositoryId: "repo-1" }),
      }),
    );
    expect(prisma.graphEdge.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ snapshotId: "prev-1" }),
      }),
    );
    expect(inverseIndex).toHaveBeenCalledWith(
      expect.objectContaining({
        nodeFacts: expect.arrayContaining([
          expect.objectContaining({ key: "m:src/index.ts", filePath: "src/index.ts" }),
        ]),
        edgeFacts: expect.arrayContaining([
          expect.objectContaining({
            kind: "IMPORTS",
            fromKey: "m:src/index.ts",
            toKey: "m:src/lib/logger.ts",
            provenance: "EXTRACTED",
          }),
        ]),
      }),
    );
  });
});
