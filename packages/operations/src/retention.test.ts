import { describe, expect, it, vi } from "vitest";
import { purgeExpiredAgentRuns } from "./retention";

function makePrisma(overrides: Record<string, unknown> = {}) {
  const base = {
    agentRun: {
      findMany: vi.fn().mockResolvedValue([] as never),
      update: vi.fn().mockResolvedValue({} as never),
    },
    auditEvent: {
      create: vi.fn().mockResolvedValue({} as never),
    },
  };
  return { ...base, ...overrides } as typeof base & typeof overrides;
}

const INPUT = {
  retentionDays: 90,
  correlationId: "corr-1",
  now: new Date("2026-08-01T00:00:00Z"),
};

describe("purgeExpiredAgentRuns", () => {
  it("purges terminal runs older than the retention window", async () => {
    const prisma = makePrisma({
      agentRun: {
        findMany: vi.fn().mockResolvedValue([
          { id: "run-1", organizationId: "org-acme" },
          { id: "run-2", organizationId: "org-acme" },
        ] as never),
        update: vi.fn().mockResolvedValue({} as never),
      },
    });
    const result = await purgeExpiredAgentRuns(prisma, INPUT);
    expect(result).toEqual({ eligible: 2, purged: 2 });
    expect(prisma.agentRun.update).toHaveBeenCalledTimes(2);
    expect(prisma.agentRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { inputJson: null, outputJson: null, tokenUsage: null },
      }),
    );
    expect(prisma.auditEvent.create).toHaveBeenCalledTimes(2);
  });

  it("filters eligibility to terminal statuses before the cutoff", async () => {
    const prisma = makePrisma();
    await purgeExpiredAgentRuns(prisma, INPUT);
    const [args] = vi.mocked(prisma.agentRun.findMany).mock.calls;
    const where = args?.[0]?.where as {
      status: { in: string[] };
      completedAt: { not: null; lt: Date };
      organizationId?: string;
    };
    expect(where.status.in).toContain("SUCCEEDED");
    expect(where.status.in).toContain("FAILED");
    expect(where.status.in).toContain("BUDGET_EXCEEDED");
    expect(where.completedAt.lt.getTime()).toBe(new Date("2026-05-03T00:00:00Z").getTime());
  });

  it("purges nothing when no runs are eligible", async () => {
    const prisma = makePrisma();
    const result = await purgeExpiredAgentRuns(prisma, INPUT);
    expect(result).toEqual({ eligible: 0, purged: 0 });
    expect(prisma.agentRun.update).not.toHaveBeenCalled();
    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });
});
