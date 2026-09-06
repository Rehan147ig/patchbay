import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ARTIFACT_RETENTION_DAYS, purgeValidationArtifacts } from "./artifact-retention";
import { prisma } from "./client";
import { deleteEvidenceObject } from "./object-store";

vi.mock("./client", () => ({
  prisma: {
    validationArtifact: {
      findMany: vi.fn(),
      count: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock("./object-store", () => ({
  deleteEvidenceObject: vi.fn(),
}));

const now = new Date("2026-09-06T00:00:00Z");

function artifact(id: string, stdoutUri: string | null, stderrUri: string | null) {
  return { id, stdoutUri, stderrUri };
}

describe("purgeValidationArtifacts", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(deleteEvidenceObject).mockResolvedValue(true);
    vi.mocked(prisma.validationArtifact.count).mockResolvedValue(0);
    vi.mocked(prisma.validationArtifact.deleteMany).mockResolvedValue({ count: 0 });
  });

  it("purges eligible rows and their unreferenced objects", async () => {
    vi.mocked(prisma.validationArtifact.findMany).mockResolvedValueOnce([
      artifact("a-1", "sha256/ab/ab.json", null),
      artifact("a-2", null, "sha256/cd/cd.json"),
    ] as never);
    vi.mocked(prisma.validationArtifact.deleteMany).mockResolvedValueOnce({ count: 2 });

    const result = await purgeValidationArtifacts({ olderThanDays: 90, now });
    expect(prisma.validationArtifact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { createdAt: { lt: new Date("2026-06-08T00:00:00Z") } },
        take: 500,
      }),
    );
    expect(deleteEvidenceObject).toHaveBeenCalledWith("sha256/ab/ab.json");
    expect(deleteEvidenceObject).toHaveBeenCalledWith("sha256/cd/cd.json");
    expect(prisma.validationArtifact.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["a-1", "a-2"] } },
    });
    expect(result).toEqual({
      eligible: 2,
      artifactsDeleted: 2,
      objectsDeleted: 2,
      objectFailures: 0,
    });
  });

  it("keeps objects referenced by surviving artifacts", async () => {
    const shared = `sha256/ab/${"ab".repeat(32)}.json`;
    vi.mocked(prisma.validationArtifact.findMany).mockResolvedValueOnce([
      artifact("a-1", shared, shared),
    ] as never);
    // One live artifact outside the purge batch references the same key.
    vi.mocked(prisma.validationArtifact.count).mockResolvedValue(1);

    const result = await purgeValidationArtifacts({ olderThanDays: 90, now });
    expect(deleteEvidenceObject).not.toHaveBeenCalled();
    expect(result.objectsDeleted).toBe(0);
    // The row itself still purges; only the shared object survives.
    expect(prisma.validationArtifact.deleteMany).toHaveBeenCalled();
  });

  it("dedupes identical URIs within one artifact", async () => {
    const shared = `sha256/ab/${"ab".repeat(32)}.json`;
    vi.mocked(prisma.validationArtifact.findMany).mockResolvedValueOnce([
      artifact("a-1", shared, shared),
    ] as never);

    await purgeValidationArtifacts({ olderThanDays: 90, now });
    expect(deleteEvidenceObject).toHaveBeenCalledTimes(1);
  });

  it("counts object failures without aborting the purge", async () => {
    vi.mocked(prisma.validationArtifact.findMany).mockResolvedValueOnce([
      artifact("a-1", "sha256/ab/ab.json", null),
    ] as never);
    vi.mocked(deleteEvidenceObject).mockRejectedValueOnce(new Error("disk hiccup"));
    vi.mocked(prisma.validationArtifact.deleteMany).mockResolvedValueOnce({ count: 1 });

    const result = await purgeValidationArtifacts({ olderThanDays: 90, now });
    expect(result).toMatchObject({ objectFailures: 1, artifactsDeleted: 1 });
  });

  it("does nothing when nothing is eligible", async () => {
    vi.mocked(prisma.validationArtifact.findMany).mockResolvedValueOnce([]);
    const result = await purgeValidationArtifacts({ olderThanDays: 90, now });
    expect(result).toEqual({
      eligible: 0,
      artifactsDeleted: 0,
      objectsDeleted: 0,
      objectFailures: 0,
    });
    expect(prisma.validationArtifact.deleteMany).not.toHaveBeenCalled();
  });

  it("defaults to a 90-day window", () => {
    expect(DEFAULT_ARTIFACT_RETENTION_DAYS).toBe(90);
  });
});
