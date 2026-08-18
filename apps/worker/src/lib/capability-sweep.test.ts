import { beforeEach, describe, expect, it, vi } from "vitest";
import { sweepCapabilityHealth } from "./capability-sweep";

vi.mock("@patchbay/db", () => ({
  prisma: {
    pullRequest: { findMany: vi.fn() },
  },
}));

vi.mock("@patchbay/queue", () => ({
  JobType: { EVALUATE_CAPABILITY_HEALTH: "EVALUATE_CAPABILITY_HEALTH" },
  enqueue: vi.fn(),
}));

import { prisma } from "@patchbay/db";
import { enqueue } from "@patchbay/queue";

function prRow(organizationId: string, vendorSlug: string) {
  return {
    organizationId,
    remediationPlan: {
      impactAssessment: {
        changeEvent: { vendor: { slug: vendorSlug } },
      },
    },
  };
}

describe("sweepCapabilityHealth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.pullRequest.findMany).mockResolvedValue([] as never);
  });

  it("enqueues one evaluation per (organization, vendor) pair", async () => {
    vi.mocked(prisma.pullRequest.findMany).mockResolvedValue([
      prRow("org-a", "stripe"),
      prRow("org-a", "stripe"),
      prRow("org-a", "openai"),
      prRow("org-b", "stripe"),
    ] as never);
    const result = await sweepCapabilityHealth(new Date("2026-08-01T00:00:00Z"));
    expect(result.evaluated).toBe(3);
    expect(enqueue).toHaveBeenCalledTimes(3);
    expect(enqueue).toHaveBeenCalledWith(
      "EVALUATE_CAPABILITY_HEALTH",
      expect.objectContaining({ organizationId: "org-a", vendorSlug: "stripe" }),
    );
    expect(enqueue).toHaveBeenCalledWith(
      "EVALUATE_CAPABILITY_HEALTH",
      expect.objectContaining({ organizationId: "org-a", vendorSlug: "openai" }),
    );
    expect(enqueue).toHaveBeenCalledWith(
      "EVALUATE_CAPABILITY_HEALTH",
      expect.objectContaining({ organizationId: "org-b", vendorSlug: "stripe" }),
    );
  });

  it("limits the query to terminal PRs in the window", async () => {
    await sweepCapabilityHealth(new Date("2026-08-01T00:00:00Z"));
    expect(prisma.pullRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ["MERGED", "CLOSED"] },
          createdAt: { gte: expect.any(Date) },
        }),
      }),
    );
  });

  it("enqueues nothing when there is no terminal activity", async () => {
    const result = await sweepCapabilityHealth(new Date("2026-08-01T00:00:00Z"));
    expect(result.evaluated).toBe(0);
    expect(enqueue).not.toHaveBeenCalled();
  });
});
