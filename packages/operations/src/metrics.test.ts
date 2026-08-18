import { describe, expect, it, vi } from "vitest";
import { computeOrganizationMetrics } from "./metrics";

function makePrisma(overrides: Record<string, unknown> = {}) {
  const base = {
    detectionRun: {
      findMany: vi.fn().mockResolvedValue([] as never),
    },
    validationRun: {
      groupBy: vi.fn().mockResolvedValue([] as never),
    },
    remediationPlan: {
      groupBy: vi.fn().mockResolvedValue([] as never),
    },
    prOutcome: {
      groupBy: vi.fn().mockResolvedValue([] as never),
      count: vi.fn().mockResolvedValue(0 as never),
    },
    pullRequest: {
      groupBy: vi.fn().mockResolvedValue([] as never),
    },
    agentRun: {
      groupBy: vi.fn().mockResolvedValue([] as never),
      aggregate: vi.fn().mockResolvedValue({ _sum: { costEstimateCents: 0 } } as never),
    },
    remediationCase: {
      findMany: vi.fn().mockResolvedValue([] as never),
    },
    auditEvent: {
      count: vi.fn().mockResolvedValue(0 as never),
    },
  };
  return { ...base, ...overrides } as typeof base & typeof overrides;
}

function groupOf(key: string, value: string, n: number) {
  return { [key]: value, _count: { _all: n } };
}

const INPUT = {
  organizationId: "org-acme",
  windowDays: 30,
  now: new Date("2026-08-01T00:00:00Z"),
};

describe("computeOrganizationMetrics", () => {
  it("returns empty metrics when the organization has no data", async () => {
    const metrics = await computeOrganizationMetrics(makePrisma(), INPUT);
    expect(metrics.detection.latencyP95Ms).toBeNull();
    expect(metrics.sandbox.passRatePct).toBeNull();
    expect(metrics.plans.acceptancePct).toBeNull();
    expect(metrics.pullRequests.mergeRatePct).toBeNull();
    expect(metrics.outcomes.falsePositiveRatePct).toBeNull();
    expect(metrics.agent.costPerSuccessfulRemediationCents).toBeNull();
    expect(metrics.timeToRemediationHours).toBeNull();
  });

  it("rolls up sandbox pass rate and plan acceptance", async () => {
    const prisma = makePrisma({
      validationRun: {
        groupBy: vi
          .fn()
          .mockResolvedValue([
            groupOf("status", "PASSED", 7),
            groupOf("status", "FAILED", 3),
            groupOf("status", "QUEUED", 2),
          ] as never),
      },
      remediationPlan: {
        groupBy: vi
          .fn()
          .mockResolvedValue([
            groupOf("status", "VALIDATED", 4),
            groupOf("status", "DRAFT", 1),
          ] as never),
      },
    });
    const metrics = await computeOrganizationMetrics(prisma, INPUT);
    expect(metrics.sandbox.passed).toBe(7);
    expect(metrics.sandbox.failed).toBe(3);
    expect(metrics.sandbox.passRatePct).toBe(70);
    expect(metrics.plans.total).toBe(5);
    expect(metrics.plans.acceptancePct).toBe(80);
  });

  it("rolls up PR merge rate and outcome classification", async () => {
    const prisma = makePrisma({
      pullRequest: {
        groupBy: vi
          .fn()
          .mockResolvedValue([
            groupOf("status", "MERGED", 3),
            groupOf("status", "CLOSED", 1),
            groupOf("status", "OPEN", 2),
          ] as never),
      },
      prOutcome: {
        groupBy: vi
          .fn()
          .mockResolvedValue([
            groupOf("classification", "SUCCESS", 2),
            groupOf("classification", "WRONG_PATCH", 1),
            groupOf("classification", "VALIDATION_FAILURE", 1),
            groupOf("classification", "UNCLASSIFIED", 5),
          ] as never),
        count: vi.fn().mockResolvedValue(9 as never),
      },
    });
    const metrics = await computeOrganizationMetrics(prisma, INPUT);
    expect(metrics.pullRequests.mergeRatePct).toBe(75);
    expect(metrics.outcomes.total).toBe(9);
    expect(metrics.outcomes.classified).toBe(4);
    expect(metrics.outcomes.success).toBe(2);
    expect(metrics.outcomes.falsePositive).toBe(2);
    expect(metrics.outcomes.falsePositiveRatePct).toBe(50);
  });

  it("computes detection latency p95 and agent telemetry", async () => {
    const prisma = makePrisma({
      detectionRun: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            { latencyMs: 100 },
            { latencyMs: 200 },
            { latencyMs: 300 },
            { latencyMs: 400 },
            { latencyMs: 500 },
          ] as never),
      },
      agentRun: {
        groupBy: vi
          .fn()
          .mockResolvedValue([
            groupOf("status", "SUCCEEDED", 8),
            groupOf("status", "FAILED", 1),
            groupOf("status", "BUDGET_EXCEEDED", 1),
          ] as never),
        aggregate: vi.fn().mockResolvedValue({ _sum: { costEstimateCents: 500 } } as never),
      },
    });
    const metrics = await computeOrganizationMetrics(prisma, INPUT);
    expect(metrics.detection.runCount).toBe(5);
    expect(metrics.detection.latencyP95Ms).toBe(500);
    expect(metrics.agent.runCount).toBe(10);
    expect(metrics.agent.failed).toBe(2);
    expect(metrics.agent.failureRatePct).toBe(20);
    expect(metrics.agent.budgetExceeded).toBe(1);
    expect(metrics.agent.costTotalCents).toBe(500);
  });

  it("computes cost per successful remediation and time to remediation", async () => {
    const prisma = makePrisma({
      pullRequest: {
        groupBy: vi.fn().mockResolvedValue([groupOf("status", "MERGED", 2)] as never),
      },
      prOutcome: {
        groupBy: vi.fn().mockResolvedValue([groupOf("classification", "SUCCESS", 1)] as never),
        count: vi.fn().mockResolvedValue(3 as never),
      },
      agentRun: {
        groupBy: vi.fn().mockResolvedValue([groupOf("status", "SUCCEEDED", 5)] as never),
        aggregate: vi.fn().mockResolvedValue({ _sum: { costEstimateCents: 300 } } as never),
      },
      remediationCase: {
        findMany: vi.fn().mockResolvedValue([
          {
            createdAt: new Date("2026-07-01T00:00:00Z"),
            terminalAt: new Date("2026-07-03T00:00:00Z"),
          },
          {
            createdAt: new Date("2026-07-01T00:00:00Z"),
            terminalAt: new Date("2026-07-05T12:00:00Z"),
          },
        ] as never),
      },
    });
    const metrics = await computeOrganizationMetrics(prisma, INPUT);
    expect(metrics.agent.costPerSuccessfulRemediationCents).toBe(100);
    expect(metrics.timeToRemediationHours).toBe(78);
  });
});
