import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { GET } from "./route";

vi.mock("@patchbay/db", () => ({
  prisma: {
    remediationCase: { findMany: vi.fn() },
    remediationPlan: { findMany: vi.fn() },
    pullRequest: { findMany: vi.fn() },
    prOutcome: { findMany: vi.fn() },
    validationRun: { findMany: vi.fn() },
    agentRun: { findMany: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
  withOrgContext: (client: never) => client,
}));

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn(),
}));

import { prisma } from "@patchbay/db";
import { requireRole } from "@/lib/auth";

describe("GET /api/export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireRole).mockResolvedValue({
      id: "u-admin",
      organizationId: "org-acme",
    } as never);
    vi.mocked(prisma.remediationCase.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.remediationPlan.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.pullRequest.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.prOutcome.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.validationRun.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.agentRun.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.auditEvent.create).mockResolvedValue({} as never);
  });

  it("exports operational records and audits the export", async () => {
    vi.mocked(prisma.pullRequest.findMany).mockResolvedValue([
      { id: "pr-1", url: "https://github.com/acme/repo/pull/7", status: "MERGED" },
    ] as never);
    const response = await GET(new Request("http://localhost/api/export") as NextRequest);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { counts: Record<string, number>; data: { pullRequests: unknown[] } };
    };
    expect(body.data.counts.pullRequests).toBe(1);
    expect(body.data.data.pullRequests).toHaveLength(1);
    expect(prisma.auditEvent.create).toHaveBeenCalledTimes(1);
  });

  it("does not export raw agent inputs or outputs", async () => {
    vi.mocked(prisma.agentRun.findMany).mockResolvedValue([
      { id: "run-1", redactedInputDigest: "abc", latencyMs: 42 },
    ] as never);
    const response = await GET(new Request("http://localhost/api/export") as NextRequest);
    const body = (await response.json()) as {
      data: { data: { agentRuns: Array<Record<string, unknown>> } };
    };
    expect(body.data.data.agentRuns[0]).not.toHaveProperty("inputJson");
    expect(body.data.data.agentRuns[0]).not.toHaveProperty("outputJson");
    expect(body.data.data.agentRuns[0]).toHaveProperty("redactedInputDigest");
  });
});
