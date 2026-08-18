import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "bullmq";
import {
  processEvaluateCapabilityHealth,
  CAPABILITY_HEALTH_DEFAULTS,
} from "./evaluate-capability-health";

vi.mock("@patchbay/db", () => ({
  prisma: {
    pullRequest: { findMany: vi.fn() },
    agentRun: { findMany: vi.fn() },
    capabilityGate: { upsert: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
}));

import { prisma } from "@patchbay/db";

function jobWith(data: unknown): Job {
  return { data, name: "evaluate-capability-health" } as Job;
}

describe("processEvaluateCapabilityHealth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.pullRequest.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.agentRun.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.capabilityGate.upsert).mockResolvedValue({
      id: "gate-1",
      status: "ACTIVE",
    } as never);
    vi.mocked(prisma.auditEvent.create).mockResolvedValue({} as never);
  });

  it("throws on malformed job data", async () => {
    await expect(processEvaluateCapabilityHealth(jobWith({}))).rejects.toThrow(
      /invalid evaluate-capability-health job data/,
    );
  });

  it("reports healthy and does not touch the gate with no data", async () => {
    const verdict = await processEvaluateCapabilityHealth(
      jobWith({
        organizationId: "org-acme",
        vendorSlug: "stripe",
        correlationId: "corr-1",
      }),
    );
    expect(verdict.healthy).toBe(true);
    expect(prisma.capabilityGate.upsert).not.toHaveBeenCalled();
  });

  it("suspends the DRAFT_PR gate when the merge rate fails", async () => {
    vi.mocked(prisma.pullRequest.findMany).mockResolvedValue([
      {
        status: "CLOSED",
        remediationPlan: {
          impactAssessment: {
            changeEvent: { vendor: { slug: "stripe" } },
          },
        },
      },
      {
        status: "CLOSED",
        remediationPlan: {
          impactAssessment: {
            changeEvent: { vendor: { slug: "stripe" } },
          },
        },
      },
    ] as never);
    const verdict = await processEvaluateCapabilityHealth(
      jobWith({
        organizationId: "org-acme",
        vendorSlug: "stripe",
        correlationId: "corr-1",
      }),
    );
    expect(verdict.healthy).toBe(false);
    expect(prisma.capabilityGate.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId_vendorSlug_level: {
            organizationId: "org-acme",
            vendorSlug: "stripe",
            level: "DRAFT_PR",
          },
        },
        create: expect.objectContaining({
          status: "SUSPENDED",
          reason: expect.stringContaining("merge rate 0% below threshold"),
        }),
      }),
    );
  });

  it("exposes tunable SLO defaults", () => {
    expect(CAPABILITY_HEALTH_DEFAULTS.windowDays).toBe(30);
    expect(CAPABILITY_HEALTH_DEFAULTS.minMergeRatePct).toBe(50);
    expect(CAPABILITY_HEALTH_DEFAULTS.maxFailureRatePct).toBe(50);
    expect(CAPABILITY_HEALTH_DEFAULTS.maxLatencyP95Ms).toBe(60_000);
  });
});
