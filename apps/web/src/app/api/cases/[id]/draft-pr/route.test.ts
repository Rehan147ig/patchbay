import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { POST } from "./route";

vi.mock("@patchbay/db", () => ({
  prisma: {
    remediationCase: { findFirst: vi.fn() },
    remediationCaseEvent: { create: vi.fn() },
    auditEvent: { create: vi.fn() },
    capabilityGate: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn(),
}));

vi.mock("@patchbay/queue", () => ({
  JobType: { CREATE_PR: "CREATE_PR" },
  enqueue: vi.fn(),
}));

import { prisma } from "@patchbay/db";
import { requireRole } from "@/lib/auth";
import { enqueue } from "@patchbay/queue";

const memberUser = { id: "u-member", organizationId: "org-acme" };

function requestWithCsrf(body: unknown): NextRequest {
  return new Request("http://localhost/api/cases/c-1/draft-pr", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie: "pb_csrf=token123",
      "x-csrf-token": "token123",
    },
    body: JSON.stringify(body),
  }) as NextRequest;
}

function caseFor(slug: string, overrides: Record<string, unknown> = {}) {
  return {
    id: "c-1",
    status: "PATCH_PROPOSED",
    reasonCode: "METHOD_RENAMED",
    release: { product: { vendor: { slug } } },
    plans: [
      {
        id: "p-1",
        status: "VALIDATED",
        confidence: 90,
        requiresHumanReview: false,
        impactAssessment: { affectedUsages: [] },
        patches: [{ id: "patch-1" }],
        validations: [{ status: "PASSED" }],
        approvals: [{ decision: "APPROVED" }],
        pullRequests: [],
        ...overrides,
      },
    ],
  };
}

describe("POST /api/cases/[id]/draft-pr (WP9 certification gate)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireRole).mockResolvedValue(memberUser as never);
    vi.mocked(prisma.remediationCaseEvent.create).mockResolvedValue({} as never);
    vi.mocked(prisma.auditEvent.create).mockResolvedValue({} as never);
    vi.mocked(prisma.capabilityGate.findUnique).mockResolvedValue(null as never);
  });

  it("blocks a case whose connector is not certified for DRAFT_PR", async () => {
    vi.mocked(prisma.remediationCase.findFirst).mockResolvedValue(caseFor("auth0") as never);
    const response = await POST(requestWithCsrf({}), { params: Promise.resolve({ id: "c-1" }) });
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/not certified for DRAFT_PR/);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("queues CREATE_PR for a certified connector when policy passes", async () => {
    vi.mocked(prisma.remediationCase.findFirst).mockResolvedValue(caseFor("openai") as never);
    const response = await POST(requestWithCsrf({}), { params: Promise.resolve({ id: "c-1" }) });
    expect(response.status).toBe(202);
    expect(enqueue).toHaveBeenCalledWith("CREATE_PR", {
      remediationPlanId: "p-1",
      organizationId: "org-acme",
      correlationId: expect.any(String),
    });
    expect(prisma.remediationCaseEvent.create).toHaveBeenCalledTimes(1);
  });

  it("blocks a certified connector whose DRAFT_PR kill switch is closed (WP10)", async () => {
    vi.mocked(prisma.remediationCase.findFirst).mockResolvedValue(caseFor("openai") as never);
    vi.mocked(prisma.capabilityGate.findUnique).mockResolvedValue({
      status: "SUSPENDED",
      reason: "merge rate below threshold",
    } as never);
    const response = await POST(requestWithCsrf({}), { params: Promise.resolve({ id: "c-1" }) });
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/is suspended: merge rate below threshold/);
    expect(enqueue).not.toHaveBeenCalled();
  });
});
