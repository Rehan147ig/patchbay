import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { POST } from "./route";

vi.mock("@patchbay/db", () => ({
  prisma: {
    remediationCase: { findFirst: vi.fn(), update: vi.fn() },
    remediationCaseEvent: { create: vi.fn() },
    agentRun: { findFirst: vi.fn(), create: vi.fn() },
    auditEvent: { create: vi.fn() },
    $transaction: vi.fn((actions) => Promise.all(actions)),
  },
}));

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn(),
}));

vi.mock("@patchbay/queue", () => ({
  JobType: { AGENT_PLAN: "AGENT_PLAN" },
  enqueue: vi.fn(),
}));

import { prisma } from "@patchbay/db";
import { requireRole } from "@/lib/auth";
import { enqueue } from "@patchbay/queue";

function request(): NextRequest {
  return new Request("http://localhost/api/maintenance/cases/case-1/plan", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie: "pb_csrf=token123",
      "x-csrf-token": "token123",
    },
  }) as NextRequest;
}

const params = { params: Promise.resolve({ id: "case-1" }) };

function eligibleCase() {
  return {
    id: "case-1",
    status: "POLICY_ELIGIBLE",
    reasonCode: "usage-evidence",
    releaseId: "rel-1",
    releaseRepositoryMatchId: "match-1",
    repositoryId: "repo-1",
  };
}

describe("POST /api/maintenance/cases/[id]/plan (WP12)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requireRole).mockResolvedValue({
      id: "u-1",
      organizationId: "org-acme",
    } as never);
    vi.mocked(prisma.auditEvent.create).mockResolvedValue({} as never);
    vi.mocked(prisma.agentRun.findFirst).mockResolvedValue(null);
  });

  it("starts planning and moves the case to PLANNING", async () => {
    vi.mocked(prisma.remediationCase.findFirst).mockResolvedValueOnce(eligibleCase() as never);
    vi.mocked(prisma.agentRun.create).mockResolvedValueOnce({ id: "run-1" } as never);
    const response = await POST(request(), params);
    expect(response.status).toBe(202);
    const body = (await response.json()) as { data: { eligible: boolean; agentRunId: string } };
    expect(body.data).toMatchObject({ eligible: true, agentRunId: "run-1" });
    expect(enqueue).toHaveBeenCalledWith(
      "AGENT_PLAN",
      expect.objectContaining({ agentRunId: "run-1" }),
    );
    expect(prisma.remediationCase.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "PLANNING" }) }),
    );
  });

  it("replays idempotently onto a live run", async () => {
    vi.mocked(prisma.remediationCase.findFirst).mockResolvedValueOnce(eligibleCase() as never);
    vi.mocked(prisma.agentRun.findFirst).mockResolvedValueOnce({
      id: "run-live",
      status: "RUNNING",
    } as never);
    const response = await POST(request(), params);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { replay: boolean } };
    expect(body.data.replay).toBe(true);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("reports ineligibility with next-action guidance instead of failing", async () => {
    vi.mocked(prisma.remediationCase.findFirst).mockResolvedValueOnce({
      ...eligibleCase(),
      status: "OBSERVED",
    } as never);
    const response = await POST(request(), params);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { eligible: boolean; message: string } };
    expect(body.data.eligible).toBe(false);
    expect(body.data.message).toMatch(/cannot be planned automatically/);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("fails closed without a release-funnel match", async () => {
    vi.mocked(prisma.remediationCase.findFirst).mockResolvedValueOnce({
      ...eligibleCase(),
      releaseId: null,
      releaseRepositoryMatchId: null,
    } as never);
    const response = await POST(request(), params);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { eligible: boolean } };
    expect(body.data.eligible).toBe(false);
    expect(enqueue).not.toHaveBeenCalled();
  });
});
