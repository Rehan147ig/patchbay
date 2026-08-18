import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { forbidden } from "@patchbay/domain";
import { POST } from "./route";

vi.mock("@patchbay/db", () => ({
  prisma: {
    pullRequest: { findFirst: vi.fn() },
    prOutcome: { findUnique: vi.fn(), upsert: vi.fn() },
    agentRun: { findFirst: vi.fn() },
    validationRun: { findFirst: vi.fn() },
    remediationCase: { findUnique: vi.fn(), update: vi.fn() },
    remediationCaseEvent: { create: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
}));

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn(),
}));

vi.mock("@patchbay/queue", () => ({
  JobType: { EVALUATE_CAPABILITY_HEALTH: "EVALUATE_CAPABILITY_HEALTH" },
  enqueue: vi.fn(),
}));

vi.mock("@patchbay/vendor-connectors", () => ({
  getCapability: vi.fn().mockReturnValue({
    level: "DRAFT_PR",
    rulePackVersion: "rules-2.1.0",
    extractorVersion: "ext-3.0.0",
  }),
}));

import { prisma } from "@patchbay/db";
import { requireRole } from "@/lib/auth";
import { enqueue } from "@patchbay/queue";

function requestWithCsrf(body: unknown): NextRequest {
  return new Request("http://localhost/api/pull-requests/pr-1/outcome", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie: "pb_csrf=token123",
      "x-csrf-token": "token123",
    },
    body: JSON.stringify(body),
  }) as NextRequest;
}

function mergedPullRequest() {
  return {
    id: "pr-1",
    status: "MERGED",
    remediationPlan: {
      id: "plan-1",
      remediationCaseId: "case-1",
      policyDecision: { decision: "ALLOW_DRAFT_PR" },
      impactAssessment: {
        changeEvent: { vendor: { slug: "stripe" } },
      },
    },
  };
}

describe("POST /api/pull-requests/[id]/outcome", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireRole).mockResolvedValue({
      id: "u-1",
      organizationId: "org-acme",
    } as never);
    vi.mocked(prisma.pullRequest.findFirst).mockResolvedValue(mergedPullRequest() as never);
    vi.mocked(prisma.prOutcome.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.prOutcome.upsert).mockResolvedValue({ id: "outcome-1" } as never);
    vi.mocked(prisma.agentRun.findFirst).mockResolvedValue({
      model: "mock",
      promptTemplateVersion: "prompt-1.4.0",
    } as never);
    vi.mocked(prisma.validationRun.findFirst).mockResolvedValue({ id: "val-1" } as never);
    vi.mocked(prisma.remediationCase.findUnique).mockResolvedValue({
      id: "case-1",
      organizationId: "org-acme",
      status: "APPROVAL_REQUIRED",
    } as never);
    vi.mocked(prisma.remediationCase.update).mockResolvedValue({} as never);
    vi.mocked(prisma.remediationCaseEvent.create).mockResolvedValue({} as never);
    vi.mocked(prisma.auditEvent.create).mockResolvedValue({} as never);
  });

  it("requires MEMBER", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(forbidden("requires MEMBER") as never);
    const response = await POST(requestWithCsrf({ classification: "SUCCESS" }), {
      params: Promise.resolve({ id: "pr-1" }),
    });
    expect(response.status).toBe(403);
  });

  it("records user feedback classification on a merged PR", async () => {
    const response = await POST(
      requestWithCsrf({ classification: "WRONG_PATCH", note: "diff was off" }),
      {
        params: Promise.resolve({ id: "pr-1" }),
      },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { classification: string } };
    expect(body.data.classification).toBe("WRONG_PATCH");
    expect(prisma.prOutcome.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { pullRequestId: "pr-1" },
        create: expect.objectContaining({
          classification: "WRONG_PATCH",
          source: "USER_FEEDBACK",
          recordedBy: "u-1",
          note: "diff was off",
          rulePackVersion: "rules-2.1.0",
          extractorVersion: "ext-3.0.0",
          validationRunId: "val-1",
        }),
      }),
    );
    expect(enqueue).toHaveBeenCalledWith("EVALUATE_CAPABILITY_HEALTH", {
      organizationId: "org-acme",
      vendorSlug: "stripe",
      correlationId: expect.any(String),
    });
  });

  it("rejects feedback on an open pull request", async () => {
    vi.mocked(prisma.pullRequest.findFirst).mockResolvedValue({
      id: "pr-1",
      status: "OPEN",
      remediationPlan: null,
    } as never);
    const response = await POST(requestWithCsrf({ classification: "SUCCESS" }), {
      params: Promise.resolve({ id: "pr-1" }),
    });
    expect(response.status).toBe(422);
    expect(prisma.prOutcome.upsert).not.toHaveBeenCalled();
  });

  it("rejects the UNCLASSIFIED sentinel as a feedback verdict", async () => {
    const response = await POST(requestWithCsrf({ classification: "UNCLASSIFIED" }), {
      params: Promise.resolve({ id: "pr-1" }),
    });
    expect(response.status).toBe(422);
    expect(prisma.prOutcome.upsert).not.toHaveBeenCalled();
  });

  it("hides pull requests of other organizations", async () => {
    vi.mocked(prisma.pullRequest.findFirst).mockResolvedValueOnce(null as never);
    const response = await POST(requestWithCsrf({ classification: "SUCCESS" }), {
      params: Promise.resolve({ id: "pr-1" }),
    });
    expect(response.status).toBe(404);
  });
});
