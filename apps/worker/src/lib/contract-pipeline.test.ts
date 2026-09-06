import { beforeEach, describe, expect, it, vi } from "vitest";
import { ingestContractSnapshot } from "./contract-pipeline";
import { prisma } from "@patchbay/db";

vi.mock("@patchbay/db", () => ({
  prisma: {
    contractSource: { findUnique: vi.fn() },
    contractSnapshot: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    contractChange: { findUnique: vi.fn(), create: vi.fn() },
  },
  storeRawEvidence: vi.fn(),
}));

import { storeRawEvidence } from "@patchbay/db";

const SOURCE = { id: "src-1", organizationId: null };
const BASE = {
  sourceId: "src-1",
  organizationId: null as string | null,
  rawText: JSON.stringify({ version: "4.8.1" }),
  normalizedJson: { version: "4.8.1" },
  parserVersion: "fake/1",
};

describe("ingestContractSnapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.contractSource.findUnique).mockResolvedValue(SOURCE as never);
    vi.mocked(storeRawEvidence).mockImplementation(async (payload: string) => {
      const { createHash } = await import("node:crypto");
      const contentHash = createHash("sha256").update(payload, "utf8").digest("hex");
      return {
        key: `sha256/${contentHash.slice(0, 2)}/${contentHash}.json`,
        written: true,
        contentHash,
      };
    });
    vi.mocked(prisma.contractSnapshot.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.contractSnapshot.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.contractSnapshot.create).mockImplementation((async (args: unknown) => ({
      id: "snap-new",
      ...(args as { data: Record<string, unknown> }).data,
    })) as never);
    vi.mocked(prisma.contractChange.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.contractChange.create).mockImplementation((async () => ({
      id: "chg-1",
    })) as never);
  });

  it("rejects sources the caller org does not own (tenant boundary)", async () => {
    vi.mocked(prisma.contractSource.findUnique).mockResolvedValue({
      ...SOURCE,
      organizationId: "org-other",
    } as never);
    await expect(ingestContractSnapshot({ ...BASE, organizationId: "org-1" })).rejects.toThrow(
      /another organization/,
    );
    expect(prisma.contractSnapshot.create).not.toHaveBeenCalled();
  });

  it("rejects unknown sources instead of inventing rows", async () => {
    vi.mocked(prisma.contractSource.findUnique).mockResolvedValue(null);
    await expect(ingestContractSnapshot(BASE)).rejects.toThrow(/not found/);
  });

  it("returns the existing row without writes on identical bytes (content-addressed dedupe)", async () => {
    vi.mocked(prisma.contractSnapshot.findUnique).mockResolvedValue({ id: "snap-old" } as never);
    const result = await ingestContractSnapshot(BASE);
    expect(result).toMatchObject({ snapshotId: "snap-old", deduplicated: true, changes: [] });
    expect(prisma.contractSnapshot.create).not.toHaveBeenCalled();
    expect(storeRawEvidence).not.toHaveBeenCalled();
  });

  it("records a genesis snapshot with no change rows (no transition exists yet)", async () => {
    const result = await ingestContractSnapshot(BASE);
    expect(result.deduplicated).toBe(false);
    expect(result.previousSnapshotId).toBeNull();
    expect(result.changes).toEqual([]);
    expect(prisma.contractSnapshot.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sourceId: "src-1",
          parserVersion: "fake/1",
          rawArtifactUri: expect.stringMatching(/^sha256\//),
        }),
      }),
    );
    expect(prisma.contractChange.create).not.toHaveBeenCalled();
  });

  it("persists caller-computed changes only when the normalized form actually moved", async () => {
    vi.mocked(prisma.contractSnapshot.findFirst).mockResolvedValue({
      id: "snap-old",
      normalizedHash: "old-hash",
    } as never);
    const change = {
      identity: "version:4.8.0->4.8.1",
      changeType: "SDK_VERSION_UPGRADE",
      severity: "MEDIUM",
      description: "bump",
      migrationHints: [],
    };
    const moved = await ingestContractSnapshot({ ...BASE, changes: [change] });
    expect(moved.previousSnapshotId).toBe("snap-old");
    expect(moved.changes).toEqual([{ id: "chg-1", identity: change.identity, created: true }]);

    vi.mocked(prisma.contractSnapshot.findFirst).mockResolvedValue({
      id: "snap-old",
      normalizedHash: moved.normalizedHash,
    } as never);
    vi.mocked(prisma.contractSnapshot.findUnique).mockResolvedValue(null);
    const sameShape = await ingestContractSnapshot({
      ...BASE,
      rawText: JSON.stringify({ version: "4.8.1", extra: true }),
      changes: [change],
    });
    expect(sameShape.changes).toEqual([]);
  });

  it("converges on unique races instead of duplicating change rows", async () => {
    vi.mocked(prisma.contractSnapshot.findFirst).mockResolvedValue({
      id: "snap-old",
      normalizedHash: "old-hash",
    } as never);
    vi.mocked(prisma.contractChange.create).mockRejectedValue({ code: "P2002" });
    const result = await ingestContractSnapshot({
      ...BASE,
      changes: [
        {
          identity: "version:4.8.0->4.8.1",
          changeType: "SDK_VERSION_UPGRADE",
          severity: "MEDIUM",
          description: "bump",
          migrationHints: [],
        },
      ],
    });
    expect(result.changes).toEqual([
      { id: null, identity: "version:4.8.0->4.8.1", created: false },
    ]);
  });

  it("refuses to record a snapshot when the evidence store disagrees on bytes", async () => {
    vi.mocked(storeRawEvidence).mockResolvedValue({
      key: "sha256/ab/00.json",
      written: true,
      contentHash: "0".repeat(64),
    });
    await expect(ingestContractSnapshot(BASE)).rejects.toThrow(/hash mismatch/);
    expect(prisma.contractSnapshot.create).not.toHaveBeenCalled();
  });

  it("rejects malformed change records at the boundary (fail-closed validation)", async () => {
    vi.mocked(prisma.contractSnapshot.findFirst).mockResolvedValue({
      id: "snap-old",
      normalizedHash: "old-hash",
    } as never);
    await expect(
      ingestContractSnapshot({
        ...BASE,
        changes: [{ identity: "", changeType: "X" } as never],
      }),
    ).rejects.toThrow();
    expect(prisma.contractChange.create).not.toHaveBeenCalled();
  });
});
