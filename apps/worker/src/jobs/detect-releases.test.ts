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
    organization: { upsert: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
  Prisma: { JsonNull: "Prisma.JsonNull" },
  storeRawEvidence: vi.fn(),
}));

vi.mock("@patchbay/queue", () => ({
  enqueue: vi.fn(),
  JobType: {
    CLASSIFY_RELEASE: "classify-release",
    MATCH_RELEASE: "match-release",
  },
}));

vi.mock("@patchbay/vendor-connectors", async () => {
  const actual = await vi.importActual<typeof import("@patchbay/vendor-connectors")>(
    "@patchbay/vendor-connectors",
  );
  return {
    ...actual,
    getWatchtowerAdapters: vi.fn(),
  };
});

import { getWatchtowerAdapters, TrustViolationError } from "@patchbay/vendor-connectors";
import { enqueue } from "@patchbay/queue";
import { storeRawEvidence } from "@patchbay/db";

const job = { data: { correlationId: "c-1" } } as Job;

const NPM_EVIDENCE = {
  externalId: "npm:openai@4.8.1",
  vendorSlug: "openai",
  packageName: "openai",
  version: "4.8.1",
  previousVersion: "4.0.0",
  source: "NPM",
  canonicalUrl: "https://www.npmjs.com/package/openai/v/4.8.1",
  contentHash: "hash-481",
  rawPayload: JSON.stringify({ package: "openai", version: "4.8.1" }),
  publishedAt: new Date("2026-08-01T00:00:00Z"),
};

function mockAdapters() {
  vi.mocked(getWatchtowerAdapters).mockReturnValue([
    {
      slug: "npm:openai",
      source: "NPM",
      fetch: vi.fn().mockResolvedValue({
        evidence: [NPM_EVIDENCE],
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

  it("observes evidence, stores the raw payload and persists the cursor", async () => {
    mockAdapters();
    vi.mocked(prisma.detectionRun.findFirst).mockResolvedValueOnce(null);
    vi.mocked(prisma.detectionRun.create).mockResolvedValueOnce({ id: "run-1" } as never);
    vi.mocked(prisma.releaseRecord.findFirst).mockResolvedValueOnce(null);
    vi.mocked(storeRawEvidence).mockResolvedValueOnce({
      key: "sha256/ab/ab12.json",
      written: true,
      contentHash: "hash-481",
    });
    vi.mocked(prisma.vendor.upsert).mockResolvedValueOnce({ id: "v-1" } as never);
    vi.mocked(prisma.vendorProduct.upsert).mockResolvedValueOnce({ id: "p-1" } as never);
    vi.mocked(prisma.releaseRecord.create).mockResolvedValueOnce({
      id: "r-1",
    } as never);
    vi.mocked(prisma.releaseEvidence.create).mockResolvedValueOnce({ id: "e-1" } as never);
    vi.mocked(prisma.organization.upsert).mockResolvedValueOnce({ id: "org-watchtower" } as never);
    vi.mocked(prisma.auditEvent.create).mockResolvedValue({ id: "audit-1" } as never);

    await processDetectReleases(job);

    expect(prisma.detectionRun.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ adapter: "npm:openai" }) }),
    );
    // Raw payload is content-addressed before the release row is written.
    expect(storeRawEvidence).toHaveBeenCalledWith(NPM_EVIDENCE.rawPayload);
    expect(prisma.releaseRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          version: "4.8.1",
          previousVersion: "4.0.0",
          status: "OBSERVED",
          authenticity: "SOURCE_TRUSTED",
        }),
      }),
    );
    expect(prisma.releaseEvidence.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          objectStorageKey: "sha256/ab/ab12.json",
          contentHash: "hash-481",
        }),
      }),
    );
    expect(prisma.detectionRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "COMPLETED",
          observedCount: 1,
          latencyMs: expect.any(Number),
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
    const priorCursor = {
      etag: '"prev"',
      latestVersion: "4.0.0",
      seenVersions: ["3.3.0", "4.0.0"],
    };
    vi.mocked(prisma.detectionRun.findFirst).mockResolvedValueOnce({
      cursor: priorCursor,
    } as never);
    vi.mocked(prisma.detectionRun.create).mockResolvedValueOnce({ id: "run-2" } as never);
    // Resumed evidence for 4.8.1 is already persisted globally: the dedupe path is exercised.
    vi.mocked(prisma.releaseRecord.findFirst).mockResolvedValueOnce({ id: "r-existing" } as never);
    vi.mocked(prisma.releaseRecord.updateMany).mockResolvedValueOnce({ count: 1 } as never);
    vi.mocked(prisma.organization.upsert).mockResolvedValueOnce({ id: "org-watchtower" } as never);
    vi.mocked(prisma.auditEvent.create).mockResolvedValue({ id: "audit-1" } as never);

    await processDetectReleases(job);

    const adapter = vi
      .mocked(getWatchtowerAdapters)()
      .find((a) => (a as { slug: string }).slug === "npm:openai");
    expect(adapter?.fetch).toHaveBeenCalledWith(priorCursor);
    // The resumed run is created from the last completed cursor.
    expect(prisma.detectionRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "RUNNING", cursor: priorCursor }),
      }),
    );
    // Evidence is intentionally deduplicated, never re-created on resume.
    expect(prisma.releaseRecord.create).not.toHaveBeenCalled();
    expect(prisma.releaseRecord.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "r-existing", previousVersion: null },
        data: { previousVersion: "4.0.0" },
      }),
    );
    expect(enqueue).not.toHaveBeenCalled();
    // The run completes with the poll cursor and no failure update is made.
    expect(prisma.detectionRun.update).toHaveBeenCalledTimes(1);
    expect(prisma.detectionRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "COMPLETED",
          completedAt: expect.any(Date),
          observedCount: 1,
          cursor: { etag: '"x"', latestVersion: "4.8.1", seenVersions: ["4.8.1"] },
        }),
      }),
    );
  });

  it("skips duplicate evidence and reconciles the predecessor", async () => {
    mockAdapters();
    vi.mocked(prisma.detectionRun.findFirst).mockResolvedValueOnce(null);
    vi.mocked(prisma.detectionRun.create).mockResolvedValueOnce({ id: "run-3" } as never);
    vi.mocked(prisma.releaseRecord.findFirst).mockResolvedValueOnce({ id: "r-existing" } as never);
    vi.mocked(prisma.releaseRecord.updateMany).mockResolvedValueOnce({ count: 1 } as never);
    vi.mocked(prisma.organization.upsert).mockResolvedValueOnce({ id: "org-watchtower" } as never);
    vi.mocked(prisma.auditEvent.create).mockResolvedValue({ id: "audit-1" } as never);

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
    vi.mocked(prisma.organization.upsert).mockResolvedValueOnce({ id: "org-watchtower" } as never);
    vi.mocked(prisma.auditEvent.create).mockResolvedValue({ id: "audit-1" } as never);

    await processDetectReleases(job);

    expect(prisma.detectionRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "FAILED",
          error: expect.stringContaining("registry timeout"),
          rejectionReason: null,
        }),
      }),
    );
    // Generic failures are audited as detection.run.failed (the first audit
    // event of a run is detection.run.started).
    const auditActions = vi
      .mocked(prisma.auditEvent.create)
      .mock.calls.map((c) => (c[0] as { data: { action: string } }).data.action);
    expect(auditActions).toContain("detection.run.started");
    expect(auditActions).toContain("detection.run.failed");
  });

  it("classifies a trust violation (e.g. domain not allowed) as a rejected poll and audits it", async () => {
    vi.mocked(getWatchtowerAdapters).mockReturnValue([
      {
        slug: "openapi:stripe",
        source: "OPENAPI",
        fetch: vi
          .fn()
          .mockRejectedValue(
            new TrustViolationError(
              "domain_not_allowed",
              "domain evil.example.com is not in the trust profile allowlist",
            ),
          ),
      },
    ] as never);
    vi.mocked(prisma.detectionRun.findFirst).mockResolvedValueOnce(null);
    vi.mocked(prisma.detectionRun.create).mockResolvedValueOnce({ id: "run-reject" } as never);
    vi.mocked(prisma.organization.upsert).mockResolvedValueOnce({ id: "org-watchtower" } as never);
    vi.mocked(prisma.auditEvent.create).mockResolvedValue({ id: "audit-1" } as never);

    await processDetectReleases(job);

    expect(prisma.detectionRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "FAILED",
          rejectionReason: "domain_not_allowed",
          error: expect.stringContaining("not in the trust profile allowlist"),
        }),
      }),
    );
    const auditActions = vi
      .mocked(prisma.auditEvent.create)
      .mock.calls.map(
        (c) => (c[0] as { data: { action: string; metadata: { reason?: string } } }).data,
      );
    const rejected = auditActions.find((d) => d.action === "detection.poll.rejected");
    expect(rejected).toBeDefined();
    expect(rejected?.metadata?.reason).toBe("domain_not_allowed");
  });

  it("rejects a malformed persisted cursor without polling and audits the rejection", async () => {
    const adapter = {
      slug: "npm:openai",
      source: "NPM",
      fetch: vi.fn(),
    };
    vi.mocked(getWatchtowerAdapters).mockReturnValue([adapter] as never);
    vi.mocked(prisma.detectionRun.findFirst).mockResolvedValueOnce({
      cursor: { etag: 42 },
    } as never);
    vi.mocked(prisma.detectionRun.create).mockResolvedValueOnce({ id: "run-cursor" } as never);
    vi.mocked(prisma.organization.upsert).mockResolvedValueOnce({ id: "org-watchtower" } as never);
    vi.mocked(prisma.auditEvent.create).mockResolvedValue({ id: "audit-1" } as never);

    await processDetectReleases(job);

    expect(adapter.fetch).not.toHaveBeenCalled();
    expect(prisma.detectionRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "FAILED",
          rejectionReason: "cursor_invalid",
          error: expect.stringContaining("malformed persisted cursor"),
        }),
      }),
    );
    const audit = vi.mocked(prisma.auditEvent.create).mock.calls[0]![0] as {
      data: { action: string; metadata: { reason?: string } };
    };
    expect(audit.data.action).toBe("detection.poll.rejected");
    expect(audit.data.metadata?.reason).toBe("cursor_invalid");
  });

  it("marks OpenAPI evidence as UNVERIFIED observation, never source-trusted", async () => {
    vi.mocked(getWatchtowerAdapters).mockReturnValue([
      {
        slug: "openapi:stripe",
        source: "OPENAPI",
        fetch: vi.fn().mockResolvedValue({
          evidence: [
            {
              externalId: "openapi:stripe@2026-08-01@abc",
              vendorSlug: "stripe",
              packageName: "stripe",
              version: "2026-08-01",
              source: "OPENAPI",
              canonicalUrl: "https://api.stripe.com/openapi/spec3.json",
              contentHash: "hash-spec",
              rawPayload: "{}",
              publishedAt: new Date("2026-08-01T00:00:00Z"),
            },
          ],
          cursor: { etag: '"spec"', lastContentHash: "hash-spec", lastSpec: {} },
        }),
      },
    ] as never);
    vi.mocked(prisma.detectionRun.findFirst).mockResolvedValueOnce(null);
    vi.mocked(prisma.detectionRun.create).mockResolvedValueOnce({ id: "run-openapi" } as never);
    vi.mocked(prisma.releaseRecord.findFirst).mockResolvedValueOnce(null);
    vi.mocked(storeRawEvidence).mockResolvedValueOnce({
      key: "sha256/ab/ab12.json",
      written: true,
      contentHash: "hash-spec",
    });
    vi.mocked(prisma.vendor.upsert).mockResolvedValueOnce({ id: "v-1" } as never);
    vi.mocked(prisma.vendorProduct.upsert).mockResolvedValueOnce({ id: "p-1" } as never);
    vi.mocked(prisma.releaseRecord.create).mockResolvedValueOnce({ id: "r-openapi" } as never);
    vi.mocked(prisma.releaseEvidence.create).mockResolvedValueOnce({ id: "e-1" } as never);
    vi.mocked(prisma.organization.upsert).mockResolvedValueOnce({ id: "org-watchtower" } as never);
    vi.mocked(prisma.auditEvent.create).mockResolvedValue({ id: "audit-1" } as never);

    await processDetectReleases(job);

    expect(prisma.releaseRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          source: "OPENAPI",
          authenticity: "UNVERIFIED",
        }),
      }),
    );
  });

  it("continues polling other adapters when one adapter fails", async () => {
    vi.mocked(getWatchtowerAdapters).mockReturnValue([
      {
        slug: "npm:stripe",
        source: "NPM",
        fetch: vi.fn().mockRejectedValue(new Error("registry timeout")),
      },
      {
        slug: "npm:openai",
        source: "NPM",
        fetch: vi.fn().mockResolvedValue({
          evidence: [],
          cursor: { etag: '"x"', latestVersion: "4.8.1", seenVersions: ["4.8.1"] },
        }),
      },
    ] as never);
    vi.mocked(prisma.detectionRun.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.detectionRun.create)
      .mockResolvedValueOnce({ id: "run-fail" } as never)
      .mockResolvedValueOnce({ id: "run-ok" } as never);
    vi.mocked(prisma.organization.upsert).mockResolvedValueOnce({ id: "org-watchtower" } as never);
    vi.mocked(prisma.auditEvent.create).mockResolvedValue({ id: "audit-1" } as never);

    await processDetectReleases(job);

    expect(prisma.detectionRun.create).toHaveBeenCalledTimes(2);
    const updates = vi.mocked(prisma.detectionRun.update).mock.calls.map((c) => {
      const data = (c[0] as { data: { status: string } }).data;
      return data.status;
    });
    expect(updates).toEqual(expect.arrayContaining(["FAILED", "COMPLETED"]));
  });
});
