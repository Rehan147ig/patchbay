import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { POST } from "./route";

vi.mock("@patchbay/db", () => ({
  prisma: {
    remediationPlan: { findUnique: vi.fn() },
    validationRun: { create: vi.fn() },
    auditEvent: { create: vi.fn() },
    capabilityGate: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn(),
}));

vi.mock("@patchbay/queue", () => ({
  JobType: { RUN_VALIDATION: "RUN_VALIDATION" },
  enqueue: vi.fn(),
}));

import { prisma } from "@patchbay/db";
import { requireRole } from "@/lib/auth";
import { enqueue } from "@patchbay/queue";

const memberUser = { id: "u-member", organizationId: "org-acme" };

function requestWithCsrf(): NextRequest {
  return new Request("http://localhost/api/remediations/p-1/validate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie: "pb_csrf=token123",
      "x-csrf-token": "token123",
    },
  }) as NextRequest;
}

function planFor(slug: string, overrides: Record<string, unknown> = {}) {
  return {
    id: "p-1",
    impactAssessment: {
      repository: { organizationId: "org-acme" },
      changeEvent: { vendor: { slug } },
    },
    patches: [{ id: "patch-1" }],
    ...overrides,
  };
}

describe("POST /api/remediations/[id]/validate (WP9 certification gate)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireRole).mockResolvedValue(memberUser as never);
    vi.mocked(prisma.validationRun.create).mockResolvedValue({
      id: "vr-1",
      remediationPlanId: "p-1",
      status: "QUEUED",
    } as never);
    vi.mocked(prisma.auditEvent.create).mockResolvedValue({} as never);
    vi.mocked(prisma.capabilityGate.findUnique).mockResolvedValue(null as never);
  });

  it("blocks validation when the connector is not certified for VALIDATE", async () => {
    vi.mocked(prisma.remediationPlan.findUnique).mockResolvedValue(planFor("anthropic") as never);
    const response = await POST(requestWithCsrf(), { params: Promise.resolve({ id: "p-1" }) });
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/not certified for VALIDATE/);
    expect(prisma.validationRun.create).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("queues validation for a certified connector", async () => {
    vi.mocked(prisma.remediationPlan.findUnique).mockResolvedValue(planFor("openai") as never);
    const response = await POST(requestWithCsrf(), { params: Promise.resolve({ id: "p-1" }) });
    expect(response.status).toBe(202);
    expect(prisma.validationRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          remediationPlanId: "p-1",
          status: "QUEUED",
          commands: ["pnpm install --frozen-lockfile"],
        }),
      }),
    );
    expect(enqueue).toHaveBeenCalledWith("RUN_VALIDATION", {
      validationRunId: "vr-1",
      remediationPlanId: "p-1",
      organizationId: "org-acme",
      correlationId: expect.any(String),
    });
  });

  it("returns 400 for plans from another organization", async () => {
    vi.mocked(prisma.remediationPlan.findUnique).mockResolvedValue(
      planFor("openai", {
        impactAssessment: {
          repository: { organizationId: "org-other" },
          changeEvent: { vendor: { slug: "openai" } },
        },
      }) as never,
    );
    const response = await POST(requestWithCsrf(), { params: Promise.resolve({ id: "p-1" }) });
    expect(response.status).toBe(422);
    expect(enqueue).not.toHaveBeenCalled();
  });
});
