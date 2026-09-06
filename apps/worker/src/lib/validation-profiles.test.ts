import { beforeEach, describe, expect, it, vi } from "vitest";
import { recordValidationArtifact, resolveValidationProfile } from "./validation-profiles";
import { prisma } from "@patchbay/db";
import { SANDBOX_MAX_RAW_OUTPUT_CHARS } from "@patchbay/sandbox-runner";

vi.mock("@patchbay/db", () => ({
  prisma: {
    validationProfile: { findFirst: vi.fn() },
    validationArtifact: { create: vi.fn() },
  },
  storeRawEvidence: vi.fn(),
}));

import { storeRawEvidence } from "@patchbay/db";

function profileRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "prof-1",
    organizationId: "org-1",
    repositoryId: null,
    name: "default",
    commandIds: ["pnpm-install-frozen", "pnpm-test"],
    image: "node:20-slim",
    imageDigest: null,
    timeoutMs: 120_000,
    memoryLimit: "512m",
    networkPolicy: "none",
    version: 3,
    ...overrides,
  };
}

describe("resolveValidationProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves ids, image, and bounds from a valid profile", async () => {
    vi.mocked(prisma.validationProfile.findFirst).mockResolvedValueOnce(profileRow() as never);
    const resolved = await resolveValidationProfile("prof-1", "org-1");
    expect(prisma.validationProfile.findFirst).toHaveBeenCalledWith({
      where: { id: "prof-1", organizationId: "org-1" },
    });
    expect(resolved).toEqual({
      profileId: "prof-1",
      profileName: "default",
      profileVersion: 3,
      commands: ["pnpm install --frozen-lockfile", "pnpm test"],
      image: "node:20-slim",
      expectedDigest: null,
      timeoutMs: 120_000,
      memoryLimit: "512m",
      networkPolicy: "none",
    });
  });

  it("passes a pinned digest through as the expected digest", async () => {
    const digest = `sha256:${"a".repeat(64)}`;
    vi.mocked(prisma.validationProfile.findFirst).mockResolvedValueOnce(
      profileRow({ imageDigest: digest }) as never,
    );
    const resolved = await resolveValidationProfile("prof-1", "org-1");
    expect(resolved.expectedDigest).toBe(digest);
  });

  it("fails closed on a missing or foreign profile (no cross-tenant oracle)", async () => {
    vi.mocked(prisma.validationProfile.findFirst).mockResolvedValueOnce(null);
    await expect(resolveValidationProfile("prof-x", "org-1")).rejects.toThrow(
      "validation profile not found: prof-x",
    );
  });

  it("fails closed on an unknown command id", async () => {
    vi.mocked(prisma.validationProfile.findFirst).mockResolvedValueOnce(
      profileRow({ commandIds: ["pnpm-install-frozen", "rm -rf /"] }) as never,
    );
    await expect(resolveValidationProfile("prof-1", "org-1")).rejects.toThrow(
      /unknown validation command id/,
    );
  });

  it("fails closed on a raw command string stored as an id", async () => {
    vi.mocked(prisma.validationProfile.findFirst).mockResolvedValueOnce(
      profileRow({ commandIds: ["pnpm test"] }) as never,
    );
    await expect(resolveValidationProfile("prof-1", "org-1")).rejects.toThrow(
      /unknown validation command id/,
    );
  });

  it("fails closed on an image outside the deployment allowlist", async () => {
    vi.mocked(prisma.validationProfile.findFirst).mockResolvedValueOnce(
      profileRow({ image: "evil:latest" }) as never,
    );
    await expect(resolveValidationProfile("prof-1", "org-1")).rejects.toThrow(/allowlist/);
  });

  it("fails closed on timeouts above the server ceiling", async () => {
    vi.mocked(prisma.validationProfile.findFirst).mockResolvedValueOnce(
      profileRow({ timeoutMs: 3_600_000 }) as never,
    );
    await expect(resolveValidationProfile("prof-1", "org-1")).rejects.toThrow(
      /fails server policy/,
    );
  });

  it("fails closed on memory above the server ceiling", async () => {
    vi.mocked(prisma.validationProfile.findFirst).mockResolvedValueOnce(
      profileRow({ memoryLimit: "8g" }) as never,
    );
    await expect(resolveValidationProfile("prof-1", "org-1")).rejects.toThrow(/ceiling/);
  });

  it("fails closed on a malformed memory limit or digest", async () => {
    vi.mocked(prisma.validationProfile.findFirst).mockResolvedValueOnce(
      profileRow({ memoryLimit: "unlimited" }) as never,
    );
    await expect(resolveValidationProfile("prof-1", "org-1")).rejects.toThrow(
      /fails server policy/,
    );
    vi.mocked(prisma.validationProfile.findFirst).mockResolvedValueOnce(
      profileRow({ imageDigest: "not-a-digest" }) as never,
    );
    await expect(resolveValidationProfile("prof-1", "org-1")).rejects.toThrow(
      /fails server policy/,
    );
  });

  it("fails closed on an unsupported network policy", async () => {
    vi.mocked(prisma.validationProfile.findFirst).mockResolvedValueOnce(
      profileRow({ networkPolicy: "host-network" }) as never,
    );
    await expect(resolveValidationProfile("prof-1", "org-1")).rejects.toThrow(
      /fails server policy/,
    );
  });
});

describe("recordValidationArtifact", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(storeRawEvidence).mockImplementation(async (payload: string) => ({
      key: `sha256/${payload.length}`,
      written: true,
      contentHash: "hash",
    }));
    vi.mocked(prisma.validationArtifact.create).mockResolvedValue({ id: "art-1" } as never);
  });

  it("stores full logs by content hash and attests with a descriptor hash", async () => {
    const result = await recordValidationArtifact({
      validationRunId: "val-1",
      organizationId: "org-1",
      validationProfileId: "prof-1",
      commandsExecuted: ["pnpm install --frozen-lockfile"],
      exitCodes: [0],
      image: "node:20-slim",
      imageDigest: "sha256:abc",
      fullStdout: "hello",
      fullStderr: "",
    });
    expect(storeRawEvidence).toHaveBeenCalledWith("hello");
    // Empty streams store no object.
    expect(storeRawEvidence).toHaveBeenCalledTimes(1);
    expect(prisma.validationArtifact.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-1",
        validationRunId: "val-1",
        validationProfileId: "prof-1",
        commandsExecuted: ["pnpm install --frozen-lockfile"],
        exitCodes: [0],
        image: "node:20-slim",
        imageDigest: "sha256:abc",
        stdoutUri: "sha256/5",
        stderrUri: null,
        stdoutComplete: true,
        stderrComplete: true,
        commandSetHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        artifactHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    });
    expect(result).toEqual({
      artifactId: "art-1",
      artifactHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it("encodes missing exit codes as -1 and flags capped streams incomplete", async () => {
    const huge = "x".repeat(SANDBOX_MAX_RAW_OUTPUT_CHARS);
    await recordValidationArtifact({
      validationRunId: "val-2",
      organizationId: "org-1",
      validationProfileId: null,
      commandsExecuted: ["pnpm test"],
      exitCodes: [null],
      image: null,
      imageDigest: null,
      fullStdout: huge,
      fullStderr: "err",
    });
    expect(prisma.validationArtifact.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        exitCodes: [-1],
        stdoutComplete: false,
        stderrComplete: true,
      }),
    });
  });

  it("propagates duplicate-run conflicts loudly (no silent overwrite)", async () => {
    vi.mocked(prisma.validationArtifact.create).mockRejectedValueOnce(
      Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
    );
    await expect(
      recordValidationArtifact({
        validationRunId: "val-1",
        organizationId: "org-1",
        validationProfileId: null,
        commandsExecuted: ["pnpm test"],
        exitCodes: [0],
        image: null,
        imageDigest: null,
        fullStdout: "ok",
        fullStderr: "",
      }),
    ).rejects.toThrow("Unique constraint failed");
  });
});
