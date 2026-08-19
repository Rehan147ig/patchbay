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
    capabilityGate: { upsert: vi.fn(), findUnique: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
  createNotification: vi.fn(),
  NotificationType: {
    SCAN_COMPLETED: "scan.completed",
    SCAN_FAILED: "scan.failed",
    CASE_CREATED: "case.created",
    PLAN_CREATED: "plan.created",
    PR_CREATED: "pull_request.created",
    CAPABILITY_GATE_SUSPENDED: "capability_gate.suspended",
  },
}));

import { prisma, createNotification } from "@patchbay/db";

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
    vi.mocked(prisma.capabilityGate.findUnique).mockResolvedValue({
      status: "ACTIVE",
      reason: null,
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

  it("notifies on the transition into SUSPENDED only", async () => {
    vi.mocked(prisma.capabilityGate.findUnique)
      .mockResolvedValueOnce({ status: "ACTIVE", reason: null } as never)
      .mockResolvedValueOnce({
        status: "SUSPENDED",
        reason: "merge rate 0% below threshold",
      } as never);
    await processEvaluateCapabilityHealth(
      jobWith({
        organizationId: "org-acme",
        vendorSlug: "stripe",
        correlationId: "corr-1",
      }),
    );
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-acme",
        type: "capability_gate.suspended",
        title: "Capability suspended: stripe DRAFT_PR",
        correlationId: "corr-1",
      }),
    );
  });

  it("does not notify when the gate is already suspended", async () => {
    vi.mocked(prisma.capabilityGate.findUnique).mockResolvedValue({
      status: "SUSPENDED",
      reason: "merge rate 0% below threshold",
    } as never);
    await processEvaluateCapabilityHealth(
      jobWith({
        organizationId: "org-acme",
        vendorSlug: "stripe",
        correlationId: "corr-1",
      }),
    );
    expect(createNotification).not.toHaveBeenCalled();
  });

  it("exposes tunable SLO defaults", () => {
    expect(CAPABILITY_HEALTH_DEFAULTS.windowDays).toBe(30);
    expect(CAPABILITY_HEALTH_DEFAULTS.minMergeRatePct).toBe(50);
    expect(CAPABILITY_HEALTH_DEFAULTS.maxFailureRatePct).toBe(50);
    expect(CAPABILITY_HEALTH_DEFAULTS.maxLatencyP95Ms).toBe(60_000);
  });
});
