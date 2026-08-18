import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_IMPACT_MODULES,
  graphQueryMetrics,
  graphQueryP95,
  latestSnapshot,
  packageImpact,
} from "./graph-reads";

vi.mock("./client", () => ({
  prisma: {
    graphSnapshot: {
      findFirst: vi.fn(),
    },
    graphNode: {
      groupBy: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    graphEdge: {
      findMany: vi.fn(),
    },
    graphSourceEvidence: {
      count: vi.fn(),
    },
  },
}));

import { prisma } from "./client";

describe("graph-reads query bounds (WP5)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns sourceHash in the latest READY snapshot", async () => {
    const row = {
      id: "snap-1",
      status: "READY",
      commitSha: "abc123",
      rootTreeHash: "tree-1",
      sourceHash: "hash16",
      nodesAffected: 3,
      edgesAffected: 2,
      createdAt: new Date(),
      completedAt: new Date(),
    };
    vi.mocked(prisma.graphSnapshot.findFirst).mockResolvedValueOnce(row as never);

    const summary = await latestSnapshot({
      organizationId: "org-1",
      repositoryId: "repo-1",
    });

    expect(prisma.graphSnapshot.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "org-1", repositoryId: "repo-1", status: "READY" },
        orderBy: { completedAt: "desc" },
      }),
    );
    expect(summary?.sourceHash).toBe("hash16");
  });

  it("exposes the latestSnapshot query p95 latency metric", async () => {
    vi.mocked(prisma.graphSnapshot.findFirst).mockResolvedValueOnce(null);
    for (let i = 0; i < 10; i += 1) {
      await latestSnapshot({ organizationId: "org-1", repositoryId: "repo-1" });
    }
    const p95 = graphQueryP95("latestSnapshot");
    expect(p95).not.toBeNull();
    expect(graphQueryMetrics().latestSnapshot!.samples).toBeGreaterThanOrEqual(10);
  });
});

describe("packageImpact result bounds (WP5)", () => {
  it("caps impacted modules at MAX_IMPACT_MODULES", async () => {
    vi.mocked(prisma.graphSnapshot.findFirst).mockResolvedValueOnce({
      id: "snap-1",
      nodes: [],
      edges: [],
      evidence: [],
    } as never);
    vi.mocked(prisma.graphNode.findFirst).mockResolvedValueOnce({
      id: "dep-1",
      propertiesJson: { resolvedVersion: "4.0.0", declaredRanges: "^4.0.0" },
    } as never);
    vi.mocked(prisma.graphEdge.findMany)
      .mockResolvedValueOnce(
        Array.from({ length: MAX_IMPACT_MODULES + 50 }, (_, i) => ({
          fromNodeId: `m-${i}`,
          toNodeId: "dep-1",
          kind: "USES_PACKAGE",
        })) as never,
      )
      .mockResolvedValueOnce([] as never);
    vi.mocked(prisma.graphNode.findMany)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce(
        Array.from({ length: MAX_IMPACT_MODULES + 50 }, (_, i) => ({
          id: `m-${i}`,
          filePath: `src/m-${i}.ts`,
          displayName: `m-${i}`,
        })) as never,
      );
    vi.mocked(prisma.graphSourceEvidence.count).mockResolvedValue(0);

    const result = await packageImpact({
      organizationId: "org-1",
      repositoryId: "repo-1",
      packageName: "openai",
    });

    expect(result).not.toBeNull();
    expect(result!.modules.length).toBeLessThanOrEqual(MAX_IMPACT_MODULES);
    expect(result!.modules.length).toBe(MAX_IMPACT_MODULES);
  });

  it("records packageImpact p95 latency", async () => {
    vi.mocked(prisma.graphSnapshot.findFirst).mockResolvedValue(null);
    for (let i = 0; i < 4; i += 1) {
      await packageImpact({
        organizationId: "org-1",
        repositoryId: "repo-1",
        packageName: "openai",
      });
    }
    expect(graphQueryMetrics().packageImpact!.samples).toBeGreaterThanOrEqual(4);
  });
});
