import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";

vi.mock("@patchbay/db", () => ({
  prisma: {
    detectionRun: { findMany: vi.fn() },
    validationRun: { groupBy: vi.fn() },
    remediationPlan: { groupBy: vi.fn() },
    prOutcome: { groupBy: vi.fn(), count: vi.fn() },
    pullRequest: { groupBy: vi.fn() },
    agentRun: { groupBy: vi.fn(), aggregate: vi.fn() },
    remediationCase: { findMany: vi.fn() },
    auditEvent: { count: vi.fn() },
  },
  withOrgContext: (client: never) => client,
}));

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn(),
}));

import { prisma } from "@patchbay/db";
import { requireRole } from "@/lib/auth";

describe("GET /api/operations/metrics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireRole).mockResolvedValue({
      id: "u-1",
      organizationId: "org-acme",
    } as never);
    vi.mocked(prisma.detectionRun.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.validationRun.groupBy).mockResolvedValue([] as never);
    vi.mocked(prisma.remediationPlan.groupBy).mockResolvedValue([] as never);
    vi.mocked(prisma.prOutcome.groupBy).mockResolvedValue([] as never);
    vi.mocked(prisma.prOutcome.count).mockResolvedValue(0 as never);
    vi.mocked(prisma.pullRequest.groupBy).mockResolvedValue([] as never);
    vi.mocked(prisma.agentRun.groupBy).mockResolvedValue([] as never);
    vi.mocked(prisma.agentRun.aggregate).mockResolvedValue({
      _sum: { costEstimateCents: 0 },
    } as never);
    vi.mocked(prisma.remediationCase.findMany).mockResolvedValue([] as never);
  });

  it("returns the SLO rollup for the organization", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/operations/metrics?windowDays=30"),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { metrics: { windowDays: number; pullRequests: { mergeRatePct: number | null } } };
    };
    expect(body.data.metrics.windowDays).toBe(30);
    expect(body.data.metrics.pullRequests.mergeRatePct).toBeNull();
  });

  it("rejects an out-of-range window", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/operations/metrics?windowDays=999"),
    );
    expect(response.status).toBe(422);
  });
});
