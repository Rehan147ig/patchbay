import { beforeEach, describe, expect, it, vi } from "vitest";
import { syncConnectorCertifications } from "./connector-certification";
import { prisma } from "@patchbay/db";

vi.mock("@patchbay/db", () => ({
  prisma: {
    connectorCertification: { upsert: vi.fn(), updateMany: vi.fn() },
  },
}));

vi.mock("@patchbay/vendor-connectors", async () => {
  const actual = await vi.importActual<typeof import("@patchbay/vendor-connectors")>(
    "@patchbay/vendor-connectors",
  );
  return { ...actual, listCapabilities: vi.fn() };
});

import { listCapabilities } from "@patchbay/vendor-connectors";

describe("syncConnectorCertifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.connectorCertification.upsert).mockResolvedValue({ id: "cert-1" } as never);
    vi.mocked(prisma.connectorCertification.updateMany).mockResolvedValue({ count: 0 } as never);
  });

  it("mirrors the static registry with measured metrics left null", async () => {
    vi.mocked(listCapabilities).mockReturnValue([
      {
        vendorSlug: "openai",
        ecosystem: "ai",
        package: "openai",
        language: "typescript",
        level: "DRAFT_PR",
        rulePackVersion: "openai/4.x",
        corpus: {
          id: "h8-eval-corpus",
          owner: "platform-eng",
          status: "ACTIVE",
          reviewedAt: "2026-08-17",
          expiresAt: "2026-12-31",
          metrics: {
            dependencyMatchRecallPct: 100,
            affectedUsagePrecisionPct: 96,
            patchValidationPct: 83,
            policyOutcomeCorrectPct: 100,
          },
        },
        certifiedAt: "2026-01-01",
      },
      {
        vendorSlug: "auth0",
        ecosystem: "auth",
        package: "auth0",
        language: "typescript",
        level: "PLAN",
      },
    ] as never);
    const result = await syncConnectorCertifications();
    expect(result).toEqual({ synced: 2, expired: 0 });
    expect(prisma.connectorCertification.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { connectorSlug_version: { connectorSlug: "openai", version: "openai/4.x" } },
        create: expect.objectContaining({
          capability: "DRAFT_PR",
          corpusVersion: "h8-eval-corpus",
          precision: 0.96,
          patchSuccessRate: 0.83,
          validationSuccessRate: null,
          status: "CERTIFIED",
          approvedBy: "system:corpus-gate",
        }),
      }),
    );
    // Unversioned entries converge on a stable sentinel, never on undefined.
    expect(prisma.connectorCertification.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { connectorSlug_version: { connectorSlug: "auth0", version: "unversioned" } },
      }),
    );
  });

  it("expires superseded rule-pack versions instead of leaving them CERTIFIED", async () => {
    vi.mocked(listCapabilities).mockReturnValue([
      {
        vendorSlug: "openai",
        ecosystem: "ai",
        package: "openai",
        language: "typescript",
        level: "DRAFT_PR",
        rulePackVersion: "openai/5.x",
      },
    ] as never);
    vi.mocked(prisma.connectorCertification.updateMany).mockResolvedValue({ count: 1 } as never);
    const result = await syncConnectorCertifications();
    expect(result).toEqual({ synced: 1, expired: 1 });
    expect(prisma.connectorCertification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ connectorSlug: "openai", status: "CERTIFIED" }),
        data: { status: "EXPIRED" },
      }),
    );
  });
});
