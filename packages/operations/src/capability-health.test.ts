import { describe, expect, it, vi } from "vitest";
import { CapabilityGateStatus, PrOutcomeClassification, PullRequestStatus } from "@patchbay/domain";
import {
  evaluateCapabilityHealth,
  setCapabilityGate,
  enforceCapabilityHealth,
  FALSE_POSITIVE_CLASSIFICATIONS,
} from "./capability-health";

function prFor(vendorSlug: string, status: string) {
  return {
    status,
    remediationPlan: {
      impactAssessment: {
        changeEvent: { vendor: { slug: vendorSlug } },
      },
    },
  };
}

function makePrisma(overrides: Record<string, unknown> = {}) {
  const base = {
    pullRequest: {
      findMany: vi.fn().mockResolvedValue([] as never),
    },
    agentRun: {
      findMany: vi.fn().mockResolvedValue([] as never),
    },
    capabilityGate: {
      upsert: vi.fn().mockResolvedValue({ id: "gate-1", status: "ACTIVE" } as never),
    },
    auditEvent: {
      create: vi.fn().mockResolvedValue({} as never),
    },
  };
  return { ...base, ...overrides } as typeof base & typeof overrides;
}

const INPUT = {
  organizationId: "org-acme",
  vendorSlug: "stripe",
  level: "DRAFT_PR",
  windowDays: 30,
  minMergeRatePct: 50,
  maxFailureRatePct: 50,
  maxLatencyP95Ms: 60_000,
  correlationId: "corr-1",
  now: new Date("2026-08-01T00:00:00Z"),
};

describe("evaluateCapabilityHealth", () => {
  it("reports healthy with no data (insufficient evidence)", async () => {
    const prisma = makePrisma();
    const verdict = await evaluateCapabilityHealth(prisma, INPUT);
    expect(verdict.healthy).toBe(true);
    expect(verdict.hasData).toBe(false);
    expect(verdict.metrics.terminalPrCount).toBe(0);
  });

  it("suspends when the merge rate falls below threshold", async () => {
    const prisma = makePrisma({
      pullRequest: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            prFor("stripe", PullRequestStatus.MERGED),
            prFor("stripe", PullRequestStatus.CLOSED),
            prFor("stripe", PullRequestStatus.CLOSED),
          ] as never),
      },
    });
    const verdict = await evaluateCapabilityHealth(prisma, INPUT);
    expect(verdict.healthy).toBe(false);
    expect(verdict.metrics.mergeRatePct).toBe(33);
    expect(verdict.reasons.join(" ")).toMatch(/merge rate 33% below threshold 50%/);
  });

  it("ignores PRs of other vendors", async () => {
    const prisma = makePrisma({
      pullRequest: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            prFor("openai", PullRequestStatus.MERGED),
            prFor("openai", PullRequestStatus.MERGED),
          ] as never),
      },
    });
    const verdict = await evaluateCapabilityHealth(prisma, INPUT);
    expect(verdict.healthy).toBe(true);
    expect(verdict.metrics.terminalPrCount).toBe(0);
  });

  it("suspends when agent failure rate exceeds threshold", async () => {
    const prisma = makePrisma({
      agentRun: {
        findMany: vi.fn().mockResolvedValue([
          { status: "SUCCEEDED", latencyMs: 1_000 },
          { status: "FAILED", latencyMs: 2_000 },
          { status: "BUDGET_EXCEEDED", latencyMs: null },
        ] as never),
      },
    });
    const verdict = await evaluateCapabilityHealth(prisma, INPUT);
    expect(verdict.healthy).toBe(false);
    expect(verdict.metrics.failureRatePct).toBe(67);
    expect(verdict.reasons.join(" ")).toMatch(/failure rate 67% above threshold 50%/);
  });

  it("suspends when agent latency p95 exceeds threshold", async () => {
    const prisma = makePrisma({
      agentRun: {
        findMany: vi.fn().mockResolvedValue([
          { status: "SUCCEEDED", latencyMs: 10_000 },
          { status: "SUCCEEDED", latencyMs: 20_000 },
          { status: "SUCCEEDED", latencyMs: 100_000 },
        ] as never),
      },
    });
    const verdict = await evaluateCapabilityHealth(prisma, INPUT);
    expect(verdict.healthy).toBe(false);
    expect(verdict.metrics.latencyP95Ms).toBe(100_000);
    expect(verdict.reasons.join(" ")).toMatch(/latency p95 100000ms above threshold 60000ms/);
  });
});

describe("setCapabilityGate", () => {
  it("creates a gate and audits a suspension", async () => {
    const prisma = makePrisma({
      capabilityGate: {
        upsert: vi.fn().mockResolvedValue({ id: "gate-1", status: "SUSPENDED" } as never),
      },
    });
    const result = await setCapabilityGate(prisma, {
      organizationId: "org-acme",
      vendorSlug: "stripe",
      level: "DRAFT_PR",
      status: CapabilityGateStatus.SUSPENDED,
      reason: "merge rate low",
      correlationId: "corr-1",
    });
    expect(result.status).toBe(CapabilityGateStatus.SUSPENDED);
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
          status: CapabilityGateStatus.SUSPENDED,
          suspendedAt: expect.any(Date),
        }),
      }),
    );
    expect(prisma.auditEvent.create).toHaveBeenCalledTimes(1);
  });

  it("does not audit an idempotent no-op write", async () => {
    const prisma = makePrisma({
      capabilityGate: {
        upsert: vi.fn().mockResolvedValue({ id: "gate-1", status: "SUSPENDED" } as never),
      },
    });
    const result = await setCapabilityGate(prisma, {
      organizationId: "org-acme",
      vendorSlug: "stripe",
      level: "DRAFT_PR",
      status: CapabilityGateStatus.SUSPENDED,
      reason: null,
      correlationId: "corr-1",
    });
    expect(result.changed).toBe(false);
    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });
});

describe("enforceCapabilityHealth", () => {
  it("suspends the gate when the verdict is unhealthy", async () => {
    const prisma = makePrisma({
      pullRequest: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            prFor("stripe", PullRequestStatus.CLOSED),
            prFor("stripe", PullRequestStatus.CLOSED),
          ] as never),
      },
    });
    const verdict = await enforceCapabilityHealth(prisma, INPUT);
    expect(verdict.healthy).toBe(false);
    expect(prisma.capabilityGate.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ status: CapabilityGateStatus.SUSPENDED }),
      }),
    );
  });

  it("leaves the gate alone when healthy", async () => {
    const prisma = makePrisma({
      pullRequest: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            prFor("stripe", PullRequestStatus.MERGED),
            prFor("stripe", PullRequestStatus.MERGED),
          ] as never),
      },
    });
    const verdict = await enforceCapabilityHealth(prisma, INPUT);
    expect(verdict.healthy).toBe(true);
    expect(prisma.capabilityGate.upsert).not.toHaveBeenCalled();
  });
});

describe("FALSE_POSITIVE_CLASSIFICATIONS", () => {
  it("lists the failure categories used by the false-positive SLO", () => {
    expect(FALSE_POSITIVE_CLASSIFICATIONS).toContain(PrOutcomeClassification.WRONG_IMPACT);
    expect(FALSE_POSITIVE_CLASSIFICATIONS).toContain(PrOutcomeClassification.WRONG_PATCH);
    expect(FALSE_POSITIVE_CLASSIFICATIONS).toContain(PrOutcomeClassification.INSUFFICIENT_TESTS);
    expect(FALSE_POSITIVE_CLASSIFICATIONS).toContain(PrOutcomeClassification.VALIDATION_FAILURE);
  });
});
