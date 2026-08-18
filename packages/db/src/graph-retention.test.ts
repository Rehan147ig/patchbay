import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_READY_SNAPSHOTS, pruneGraphSnapshots, STALE_SNAPSHOT_AGE_MS } from "./graph-retention";

vi.mock("./client", () => ({
  prisma: {
    graphSnapshot: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

import { prisma } from "./client";

const snapshot = (id: string, completedAt: Date) => ({ id, completedAt });

describe("pruneGraphSnapshots (WP5)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("keeps only the latest MAX_READY_SNAPSHOTS READY snapshots", async () => {
    const now = new Date("2026-08-18T00:00:00Z");
    const ready = Array.from({ length: MAX_READY_SNAPSHOTS + 3 }, (_, i) =>
      snapshot(`r-${i}`, new Date(now.getTime() - i * 60_000)),
    );
    vi.mocked(prisma.graphSnapshot.findMany)
      .mockResolvedValueOnce(ready as never)
      .mockResolvedValueOnce([] as never);

    const result = await pruneGraphSnapshots({
      organizationId: "org-1",
      repositoryId: "repo-1",
      now,
    });

    expect(prisma.graphSnapshot.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["r-5", "r-6", "r-7"] } },
    });
    expect(result).toEqual({
      repositoryId: "repo-1",
      readyDeleted: 3,
      staleDeleted: 0,
      keptReady: MAX_READY_SNAPSHOTS,
    });
  });

  it("prunes stale INDEXING/FAILED snapshots older than STALE_SNAPSHOT_AGE_MS", async () => {
    const now = new Date("2026-08-18T00:00:00Z");
    const stale = snapshot("s-1", new Date(now.getTime() - STALE_SNAPSHOT_AGE_MS - 5_000));
    vi.mocked(prisma.graphSnapshot.findMany)
      .mockResolvedValueOnce([snapshot("r-1", now)] as never)
      .mockResolvedValueOnce([stale] as never);

    const result = await pruneGraphSnapshots({
      organizationId: "org-1",
      repositoryId: "repo-1",
      now,
    });

    expect(prisma.graphSnapshot.findMany).toHaveBeenLastCalledWith({
      where: {
        organizationId: "org-1",
        repositoryId: "repo-1",
        status: { in: ["INDEXING", "FAILED"] },
        createdAt: { lt: new Date(now.getTime() - STALE_SNAPSHOT_AGE_MS) },
      },
      select: { id: true },
    });
    expect(prisma.graphSnapshot.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["s-1"] } },
    });
    expect(result.staleDeleted).toBe(1);
  });

  it("keeps every READY snapshot when below the cap and prunes nothing", async () => {
    const now = new Date("2026-08-18T00:00:00Z");
    vi.mocked(prisma.graphSnapshot.findMany)
      .mockResolvedValueOnce([snapshot("r-1", now), snapshot("r-2", now)] as never)
      .mockResolvedValueOnce([] as never);

    const result = await pruneGraphSnapshots({
      organizationId: "org-1",
      repositoryId: "repo-1",
      now,
    });

    expect(prisma.graphSnapshot.deleteMany).not.toHaveBeenCalled();
    expect(result).toEqual({
      repositoryId: "repo-1",
      readyDeleted: 0,
      staleDeleted: 0,
      keptReady: 2,
    });
  });

  it("handles a repository with no snapshots", async () => {
    vi.mocked(prisma.graphSnapshot.findMany)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never);

    const result = await pruneGraphSnapshots({
      organizationId: "org-1",
      repositoryId: "repo-1",
    });

    expect(prisma.graphSnapshot.deleteMany).not.toHaveBeenCalled();
    expect(result.keptReady).toBe(0);
  });
});
