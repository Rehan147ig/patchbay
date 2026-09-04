import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { POST } from "./route";

vi.mock("@patchbay/db", () => ({
  prisma: {
    remediationPlan: { findFirst: vi.fn() },
    autonomyPolicy: { findUnique: vi.fn() },
    remediationCase: { count: vi.fn() },
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

function requestWithCsrf(): NextRequest {
  return new Request("http://localhost/api/remediations/p-1/create-pr", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie: "pb_csrf=token123",
      "x-csrf-token": "token123",
    },
    body: JSON.stringify({}),
  }) as NextRequest;
}

const AUTONOMOUS_PAYLOAD = {
  source: "AUTONOMOUS",
  ecosystem: "npm",
  packageName: "lodash",
  fromVersion: "4.17.20",
  toVersion: "4.17.21",
  updateType: "patch",
};

function planFor(rawPayload: unknown, overrides: Record<string, unknown> = {}) {
  return {
    id: "p-1",
    confidence: 95,
    requiresHumanReview: true,
    impactAssessment: {
      repository: { organizationId: "org-acme" },
      changeEvent: {
        vendor: { slug: "autonomous-generic" },
        rawPayload,
        detectedAt: new Date("2024-01-01T00:00:00Z"),
      },
      affectedUsages: [],
    },
    patches: [{ id: "patch-1", patchedContent: "pkg bump" }],
    validations: [{ status: "PASSED" }],
    approvals: [{ userId: "u-admin", decision: "APPROVED", patchedHash: null, expiresAt: null }],
    pullRequests: [],
    ...overrides,
  };
}

describe("POST /api/remediations/[id]/create-pr (autonomous parity + idempotency)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireRole).mockResolvedValue(memberUser as never);
    vi.mocked(prisma.remediationCaseEvent.create).mockResolvedValue({} as never);
    vi.mocked(prisma.auditEvent.create).mockResolvedValue({} as never);
    vi.mocked(prisma.capabilityGate.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.autonomyPolicy.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.remediationCase.count).mockResolvedValue(0 as never);
  });

  it("replays idempotently when a PR already exists (race-safe)", async () => {
    vi.mocked(prisma.remediationPlan.findFirst).mockResolvedValue(
      planFor(AUTONOMOUS_PAYLOAD, {
        pullRequests: [{ id: "pr-1", status: "DRAFT", url: "https://github.com/x/y/pull/1" }],
      }) as never,
    );
    const response = await POST(requestWithCsrf(), { params: Promise.resolve({ id: "p-1" }) });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { idempotent: boolean } };
    expect(body.data.idempotent).toBe(true);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("blocks autonomous majors at parity with the cases vector", async () => {
    vi.mocked(prisma.remediationPlan.findFirst).mockResolvedValue(
      planFor({
        ...AUTONOMOUS_PAYLOAD,
        fromVersion: "4.17.21",
        toVersion: "5.0.0",
        updateType: "major",
      }) as never,
    );
    const response = await POST(requestWithCsrf(), { params: Promise.resolve({ id: "p-1" }) });
    expect(response.status).toBe(422);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("blocks autonomous bumps past the concurrency cap", async () => {
    vi.mocked(prisma.remediationPlan.findFirst).mockResolvedValue(
      planFor(AUTONOMOUS_PAYLOAD) as never,
    );
    vi.mocked(prisma.remediationCase.count).mockResolvedValue(5 as never);
    const response = await POST(requestWithCsrf(), { params: Promise.resolve({ id: "p-1" }) });
    expect(response.status).toBe(422);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("enqueues an eligible autonomous patch bump", async () => {
    vi.mocked(prisma.remediationPlan.findFirst).mockResolvedValue(
      planFor(AUTONOMOUS_PAYLOAD) as never,
    );
    const response = await POST(requestWithCsrf(), { params: Promise.resolve({ id: "p-1" }) });
    expect(response.status).toBe(202);
    expect(enqueue).toHaveBeenCalled();
  });
});
