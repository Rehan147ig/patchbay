import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "bullmq";
import { prisma } from "@patchbay/db";
import { processDetectReleases } from "./detect-releases";

vi.mock("@patchbay/db", () => ({
  prisma: {
    detectionRun: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    releaseRecord: {
      findFirst: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    vendor: { upsert: vi.fn() },
    vendorProduct: { upsert: vi.fn() },
    releaseEvidence: { create: vi.fn() },
  },
  Prisma: { JsonNull: "Prisma.JsonNull" },
}));

vi.mock("@patchbay/queue", () => ({
  enqueue: vi.fn(),
  JobType: {
    CLASSIFY_RELEASE: "classify-release",
    MATCH_RELEASE: "match-release",
  },
}));

vi.mock("@patchbay/vendor-connectors", () => ({
  getWatchtowerAdapters: vi.fn(),
}));

import { getWatchtowerAdapters } from "@patchbay/vendor-connectors";
import { enqueue } from "@patchbay/queue";

const job = { data: { correlationId: "c-1" } } as Job;

function mockAdapters() {
  vi.mocked(getWatchtowerAdapters).mockReturnValue([
    {
      slug: "npm:openai",
      source: "NPM",
      fetch: vi.fn().mockResolvedValue({
        evidence: [
          {
            externalId: "npm:openai@4.8.1",
            vendorSlug: "openai",
            packageName: "openai",
            version: "4.8.1",
            previousVersion: "4.0.0",
            source: "NPM",
            canonicalUrl: "https://www.npmjs.com/package/openai/v/4.8.1",
            contentHash: "hash-481",
            publishedAt: new Date("2026-08-01T00:00:00Z"),
          },
        ],
        cursor: { etag: '"x"', latestVersion: "4.8.1", seenVersions: ["4.8.1"] },
      }),
    },
  ] as never);
}

describe("processDetectReleases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws error if job data is invalid", async () => {
    await expect(processDetectReleases({ data: {} } as Job)).rejects.toThrow(
      "invalid detect-releases job data",
    );
  });

  it("observes evidence and persists the cursor", async () => {
    mockAdapters();
    vi.mocked(prisma.detectionRun.findFirst).mockResolvedValueOnce(null);
    vi.mocked(prisma.detectionRun.create).mockResolvedValueOnce({ id: "run-1" } as never);
    vi.mocked(prisma.releaseRecord.findFirst).mockResolvedValueOnce(null);
    vi.mocked(prisma.vendor.upsert).mockResolvedValueOnce({ id: "v-1" } as never);
    vi.mocked(prisma.vendorProduct.upsert).mockResolvedValueOnce({ id: "p-1" } as never);
    vi.mocked(prisma.releaseRecord.create).mockResolvedValueOnce({
      id: "r-1",
    } as never);
    vi.mocked(prisma.releaseEvidence.create).mockResolvedValueOnce({ id: "e-1" } as never);

    await processDetectReleases(job);

    expect(prisma.detectionRun.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ adapter: "npm:openai" }) }),
    );
    expect(prisma.releaseRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          version: "4.8.1",
          previousVersion: "4.0.0",
          status: "OBSERVED",
        }),
      }),
    );
    expect(prisma.detectionRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "COMPLETED",
          cursor: { etag: '"x"', latestVersion: "4.8.1", seenVersions: ["4.8.1"] },
        }),
      }),
    );
    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(enqueue).toHaveBeenCalledWith("classify-release", {
      releaseId: "r-1",
      correlationId: "c-1",
    });
  });

  it("resumes from the last completed run cursor", async () => {
    mockAdapters();
    vi.mocked(prisma.detectionRun.findFirst).mockResolvedValueOnce({
      cursor: { etag: '"prev"', latestVersion: "4.0.0", seenVersions: ["3.3.0", "4.0.0"] },
    } as never);
    vi.mocked(prisma.detectionRun.create).mockResolvedValueOnce({ id: "run-2" } as never);

    await processDetectReleases(job);

    const adapter = vi
      .mocked(getWatchtowerAdapters)()
      .find((a) => (a as { slug: string }).slug === "npm:openai");
    expect(adapter?.fetch).toHaveBeenCalledWith({
      etag: '"prev"',
      latestVersion: "4.0.0",
      seenVersions: ["3.3.0", "4.0.0"],
    });
  });

  it("skips duplicate evidence and reconciles the predecessor", async () => {
    mockAdapters();
    vi.mocked(prisma.detectionRun.findFirst).mockResolvedValueOnce(null);
    vi.mocked(prisma.detectionRun.create).mockResolvedValueOnce({ id: "run-3" } as never);
    vi.mocked(prisma.releaseRecord.findFirst).mockResolvedValueOnce({ id: "r-existing" } as never);
    vi.mocked(prisma.releaseRecord.updateMany).mockResolvedValueOnce({ count: 1 } as never);

    await processDetectReleases(job);

    expect(prisma.releaseRecord.create).not.toHaveBeenCalled();
    expect(prisma.releaseRecord.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { previousVersion: "4.0.0" },
      }),
    );
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("marks the run failed when the adapter throws", async () => {
    vi.mocked(getWatchtowerAdapters).mockReturnValue([
      {
        slug: "npm:stripe",
        source: "NPM",
        fetch: vi.fn().mockRejectedValue(new Error("registry timeout")),
      },
    ] as never);
    vi.mocked(prisma.detectionRun.findFirst).mockResolvedValueOnce(null);
    vi.mocked(prisma.detectionRun.create).mockResolvedValueOnce({ id: "run-4" } as never);

    await processDetectReleases(job);

    expect(prisma.detectionRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "FAILED",
          error: expect.stringContaining("registry timeout"),
        }),
      }),
    );
  });
});
