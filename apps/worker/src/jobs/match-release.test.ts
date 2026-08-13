import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "bullmq";
import { prisma } from "@patchbay/db";
import { processMatchRelease } from "./match-release";

vi.mock("@patchbay/db", () => ({
  prisma: {
    releaseRecord: {
      findUnique: vi.fn(),
    },
    repositoryDependency: {
      findMany: vi.fn(),
    },
    releaseRepositoryMatch: {
      createMany: vi.fn(),
    },
  },
}));

vi.mock("../lib/audit", () => ({
  writeAuditEvent: vi.fn(),
}));

const job = { data: { releaseId: "r-1", correlationId: "c-1" } } as Job;

describe("processMatchRelease", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws error if job data is invalid", async () => {
    await expect(processMatchRelease({ data: {} } as Job)).rejects.toThrow(
      "invalid match-release job data",
    );
  });

  it("throws error if release is not found", async () => {
    vi.mocked(prisma.releaseRecord.findUnique).mockResolvedValueOnce(null);
    await expect(processMatchRelease(job)).rejects.toThrow("release not found: r-1");
  });

  it("matches repositories that resolved exactly to the released version", async () => {
    vi.mocked(prisma.releaseRecord.findUnique).mockResolvedValueOnce({
      id: "r-1",
      version: "3.3.0",
      product: { packageName: "openai" },
    } as never);
    vi.mocked(prisma.repositoryDependency.findMany).mockResolvedValueOnce([
      {
        id: "d-1",
        organizationId: "org-acme",
        repositoryId: "repo-1",
        commitSha: "abc123",
        packageName: "openai",
        declaredRange: "^3.3.0",
        resolvedVersion: "3.3.0",
        lockfileKind: "pnpm",
        observedAt: new Date("2026-08-01T00:00:00Z"),
      },
      {
        id: "d-2",
        organizationId: "org-acme",
        repositoryId: "repo-2",
        commitSha: "abc123",
        packageName: "openai",
        declaredRange: "^3.3.0",
        resolvedVersion: "3.2.1",
        lockfileKind: "pnpm",
        observedAt: new Date("2026-08-01T00:00:00Z"),
      },
      {
        id: "d-3",
        organizationId: "org-acme",
        repositoryId: "repo-3",
        commitSha: "abc123",
        packageName: "stripe",
        declaredRange: "^22.0.0",
        resolvedVersion: "22.5.0",
        lockfileKind: "pnpm",
        observedAt: new Date("2026-08-01T00:00:00Z"),
      },
    ]);

    const result = await processMatchRelease(job);

    expect(result).toEqual({ releaseId: "r-1", candidates: 2, exactMatches: 1, rangeMatches: 1 });
    expect(prisma.releaseRepositoryMatch.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skipDuplicates: true,
        data: expect.arrayContaining([
          expect.objectContaining({
            dependencyId: "d-1",
            matchReason: expect.stringContaining("resolved openai to 3.3.0"),
          }),
          expect.objectContaining({
            dependencyId: "d-2",
            matchReason: expect.stringContaining("declared range ^3.3.0 admits 3.3.0"),
          }),
        ]),
      }),
    );
  });

  it("writes no matches when nothing is affected", async () => {
    vi.mocked(prisma.releaseRecord.findUnique).mockResolvedValueOnce({
      id: "r-2",
      version: "4.0.0",
      product: { packageName: "openai" },
    } as never);
    vi.mocked(prisma.repositoryDependency.findMany).mockResolvedValueOnce([
      {
        id: "d-1",
        organizationId: "org-acme",
        repositoryId: "repo-1",
        commitSha: "abc123",
        packageName: "openai",
        declaredRange: "^3.0.0",
        resolvedVersion: "3.3.0",
        lockfileKind: "pnpm",
        observedAt: new Date("2026-08-01T00:00:00Z"),
      },
    ]);

    const result = await processMatchRelease({
      data: { releaseId: "r-2", correlationId: "c-2" },
    } as Job);

    expect(result).toEqual({ releaseId: "r-2", candidates: 0, exactMatches: 0, rangeMatches: 0 });
    expect(prisma.releaseRepositoryMatch.createMany).not.toHaveBeenCalled();
  });
});
