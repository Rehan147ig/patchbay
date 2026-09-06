import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { PatchbayError } from "@patchbay/domain";
import { POST } from "./route";

vi.mock("@patchbay/db", () => ({
  prisma: {
    deadLetterJob: { findFirst: vi.fn(), updateMany: vi.fn() },
    repository: { findFirst: vi.fn() },
    validationRun: { findFirst: vi.fn() },
    remediationPlan: { findFirst: vi.fn() },
    pullRequest: { findFirst: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
}));

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn(),
}));

vi.mock("@patchbay/queue", () => ({
  JobType: {
    SCAN_REPOSITORY: "scan-repository",
    ANALYZE_CHANGE: "analyze-change",
    RUN_VALIDATION: "run-validation",
    CREATE_PR: "create-pr",
  },
  enqueue: vi.fn(),
}));

import { prisma } from "@patchbay/db";
import { requireRole } from "@/lib/auth";
import { enqueue } from "@patchbay/queue";

const adminUser = { id: "u-admin", organizationId: "org-acme" };

function requestWithCsrf(body: unknown): NextRequest {
  return new Request("http://localhost/api/operations/replay", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie: "pb_csrf=token123",
      "x-csrf-token": "token123",
    },
    body: JSON.stringify(body),
  }) as NextRequest;
}

function openDeadLetter(overrides: Record<string, unknown> = {}) {
  return {
    id: "dl-1",
    organizationId: "org-acme",
    jobType: "create-pr",
    payload: { remediationPlanId: "plan-1", organizationId: "org-acme" },
    status: "OPEN",
    ...overrides,
  };
}

describe("POST /api/operations/replay (WP10)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requireRole).mockResolvedValue(adminUser as never);
    vi.mocked(prisma.auditEvent.create).mockResolvedValue({} as never);
    vi.mocked(enqueue).mockResolvedValue({ id: "replay:dl-1" } as never);
  });

  it("replays an OPEN dead letter after freshness guards pass", async () => {
    vi.mocked(prisma.deadLetterJob.findFirst).mockResolvedValueOnce(openDeadLetter() as never);
    vi.mocked(prisma.remediationPlan.findFirst).mockResolvedValueOnce({ id: "plan-1" } as never);
    vi.mocked(prisma.pullRequest.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.deadLetterJob.updateMany).mockResolvedValueOnce({ count: 1 } as never);

    const response = await POST(requestWithCsrf({ deadLetterId: "dl-1" }));
    expect(response.status).toBe(202);
    const body = (await response.json()) as {
      data: { deadLetterId: string; jobId: string; jobType: string };
    };
    expect(body.data).toMatchObject({
      deadLetterId: "dl-1",
      jobId: "replay:dl-1",
      jobType: "create-pr",
    });
    // Idempotent claim first, transport second.
    expect(prisma.deadLetterJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "dl-1", status: "OPEN" } }),
    );
    expect(enqueue).toHaveBeenCalledWith(
      "create-pr",
      expect.objectContaining({ remediationPlanId: "plan-1" }),
      { jobId: "replay:dl-1" },
    );
    expect(prisma.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "job.replayed" }),
      }),
    );
  });

  it("returns 404 for a foreign dead letter (no cross-tenant oracle)", async () => {
    vi.mocked(prisma.deadLetterJob.findFirst).mockResolvedValueOnce(null);
    const response = await POST(requestWithCsrf({ deadLetterId: "dl-x" }));
    expect(response.status).toBe(404);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("refuses an already-replayed dead letter", async () => {
    vi.mocked(prisma.deadLetterJob.findFirst).mockResolvedValueOnce(
      openDeadLetter({ status: "REPLAYED" }) as never,
    );
    const response = await POST(requestWithCsrf({ deadLetterId: "dl-1" }));
    expect(response.status).toBe(422);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("refuses non-replayable job types fail-closed", async () => {
    vi.mocked(prisma.deadLetterJob.findFirst).mockResolvedValueOnce(
      openDeadLetter({ jobType: "siem-forward" }) as never,
    );
    const response = await POST(requestWithCsrf({ deadLetterId: "dl-1" }));
    expect(response.status).toBe(422);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("refuses replay when the PR was already delivered (stale)", async () => {
    vi.mocked(prisma.deadLetterJob.findFirst).mockResolvedValueOnce(openDeadLetter() as never);
    vi.mocked(prisma.remediationPlan.findFirst).mockResolvedValueOnce({ id: "plan-1" } as never);
    vi.mocked(prisma.pullRequest.findFirst).mockResolvedValueOnce({ id: "pr-1" } as never);
    const response = await POST(requestWithCsrf({ deadLetterId: "dl-1" }));
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/already exists/);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("refuses replay when validation already resolved (stale)", async () => {
    vi.mocked(prisma.deadLetterJob.findFirst).mockResolvedValueOnce(
      openDeadLetter({
        jobType: "run-validation",
        payload: { validationRunId: "val-1", remediationPlanId: "plan-1" },
      }) as never,
    );
    vi.mocked(prisma.validationRun.findFirst).mockResolvedValueOnce({ status: "PASSED" } as never);
    const response = await POST(requestWithCsrf({ deadLetterId: "dl-1" }));
    expect(response.status).toBe(422);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("refuses replay for an archived repository (stale)", async () => {
    vi.mocked(prisma.deadLetterJob.findFirst).mockResolvedValueOnce(
      openDeadLetter({
        jobType: "scan-repository",
        payload: { repositoryId: "repo-1" },
      }) as never,
    );
    vi.mocked(prisma.repository.findFirst).mockResolvedValueOnce({
      fullName: "acme/app",
      status: "ARCHIVED",
    } as never);
    const response = await POST(requestWithCsrf({ deadLetterId: "dl-1" }));
    expect(response.status).toBe(422);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("loses a concurrent replay race with a 422 (idempotent claim)", async () => {
    vi.mocked(prisma.deadLetterJob.findFirst).mockResolvedValueOnce(openDeadLetter() as never);
    vi.mocked(prisma.remediationPlan.findFirst).mockResolvedValueOnce({ id: "plan-1" } as never);
    vi.mocked(prisma.pullRequest.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.deadLetterJob.updateMany).mockResolvedValueOnce({ count: 0 } as never);
    const response = await POST(requestWithCsrf({ deadLetterId: "dl-1" }));
    expect(response.status).toBe(422);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("requires ADMIN (operators only)", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(
      new PatchbayError("Forbidden", { statusCode: 403, code: "FORBIDDEN" }),
    );
    const response = await POST(requestWithCsrf({ deadLetterId: "dl-1" }));
    expect(response.status).toBe(403);
    expect(enqueue).not.toHaveBeenCalled();
  });
});
