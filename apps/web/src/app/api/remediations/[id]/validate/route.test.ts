import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { POST } from "./route";

vi.mock("@patchbay/db", () => ({
  prisma: {
    remediationPlan: { findFirst: vi.fn() },
    validationRun: { create: vi.fn() },
    validationProfile: { findFirst: vi.fn() },
    auditEvent: { create: vi.fn() },
    capabilityGate: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn(),
}));

vi.mock("@/lib/billing", () => ({
  assertDeliveryQuota: vi.fn(),
}));

vi.mock("@patchbay/queue", () => ({
  JobType: { RUN_VALIDATION: "RUN_VALIDATION" },
  enqueue: vi.fn(),
}));

import { prisma } from "@patchbay/db";
import { requireRole } from "@/lib/auth";
import { assertDeliveryQuota } from "@/lib/billing";
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
      repository: { id: "repo-1", organizationId: "org-acme" },
      changeEvent: { vendor: { slug } },
    },
    patches: [{ id: "patch-1" }],
    ...overrides,
  };
}

describe("POST /api/remediations/[id]/validate (WP9 certification gate)", () => {
  beforeEach(() => {
    // reset (not clear): mockResolvedValueOnce queues from prior tests must
    // not leak into the next test's profile-selection sequence.
    vi.resetAllMocks();
    vi.mocked(requireRole).mockResolvedValue(memberUser as never);
    vi.mocked(prisma.validationRun.create).mockResolvedValue({
      id: "vr-1",
      remediationPlanId: "p-1",
      status: "QUEUED",
    } as never);
    vi.mocked(prisma.validationProfile.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.auditEvent.create).mockResolvedValue({} as never);
    vi.mocked(prisma.capabilityGate.findUnique).mockResolvedValue(null as never);
  });

  it("blocks validation when the connector is not certified for VALIDATE", async () => {
    vi.mocked(prisma.remediationPlan.findFirst).mockResolvedValue(planFor("auth0") as never);
    const response = await POST(requestWithCsrf(), { params: Promise.resolve({ id: "p-1" }) });
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/not certified for VALIDATE/);
    expect(prisma.validationRun.create).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("queues validation for a certified connector", async () => {
    vi.mocked(prisma.remediationPlan.findFirst).mockResolvedValue(planFor("openai") as never);
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

  it("returns 404-style validation failure for plans from another organization", async () => {
    // Org scoping lives inside the query now, so a foreign plan is simply
    // never returned by the mocked delegate.
    vi.mocked(prisma.remediationPlan.findFirst).mockResolvedValue(null as never);
    const response = await POST(requestWithCsrf(), { params: Promise.resolve({ id: "p-1" }) });
    expect(response.status).toBe(422);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("records SKIPPED and does not enqueue in github-checks-only mode", async () => {
    vi.stubEnv("SANDBOX_VALIDATION_MODE", "github-checks-only");
    vi.mocked(prisma.remediationPlan.findFirst).mockResolvedValue(planFor("openai") as never);
    vi.mocked(prisma.validationRun.create).mockResolvedValue({
      id: "vr-skipped",
      remediationPlanId: "p-1",
      status: "SKIPPED",
    } as never);
    const response = await POST(requestWithCsrf(), { params: Promise.resolve({ id: "p-1" }) });
    expect(response.status).toBe(202);
    const body = (await response.json()) as { data: { status: string } };
    expect(body.data.status).toBe("SKIPPED");
    expect(prisma.validationRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "SKIPPED",
          stdout: expect.stringContaining("customer CI"),
        }),
      }),
    );
    expect(enqueue).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("attaches the repo-specific profile over the org default (WP8)", async () => {
    vi.mocked(prisma.remediationPlan.findFirst).mockResolvedValue(planFor("openai") as never);
    vi.mocked(prisma.validationProfile.findFirst)
      .mockResolvedValueOnce({ id: "prof-repo" } as never)
      .mockResolvedValueOnce({ id: "prof-default" } as never);
    const response = await POST(requestWithCsrf(), { params: Promise.resolve({ id: "p-1" }) });
    expect(response.status).toBe(202);
    expect(prisma.validationProfile.findFirst).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { organizationId: "org-acme", repositoryId: "repo-1" },
      }),
    );
    expect(prisma.validationRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ validationProfileId: "prof-repo" }),
      }),
    );
  });

  it("falls back to the org-default profile when no repo profile exists (WP8)", async () => {
    vi.mocked(prisma.remediationPlan.findFirst).mockResolvedValue(planFor("openai") as never);
    vi.mocked(prisma.validationProfile.findFirst)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce({ id: "prof-default" } as never);
    const response = await POST(requestWithCsrf(), { params: Promise.resolve({ id: "p-1" }) });
    expect(response.status).toBe(202);
    expect(prisma.validationProfile.findFirst).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { organizationId: "org-acme", repositoryId: null },
      }),
    );
    expect(prisma.validationRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ validationProfileId: "prof-default" }),
      }),
    );
  });

  it("records a null profile when no profile exists (legacy static commands, WP8)", async () => {
    vi.mocked(prisma.remediationPlan.findFirst).mockResolvedValue(planFor("openai") as never);
    const response = await POST(requestWithCsrf(), { params: Promise.resolve({ id: "p-1" }) });
    expect(response.status).toBe(202);
    expect(prisma.validationRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          validationProfileId: null,
          commands: ["pnpm install --frozen-lockfile"],
        }),
      }),
    );
  });

  it("returns 402 when the monthly validation quota is spent (WP11)", async () => {
    const { planLimitExceeded } = await import("@patchbay/domain");
    vi.mocked(assertDeliveryQuota).mockRejectedValueOnce(
      planLimitExceeded("Monthly validations quota exceeded", { tier: "FREE" }),
    );
    vi.mocked(prisma.remediationPlan.findFirst).mockResolvedValue(planFor("openai") as never);
    const response = await POST(requestWithCsrf(), { params: Promise.resolve({ id: "p-1" }) });
    expect(response.status).toBe(402);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("PLAN_LIMIT_EXCEEDED");
    expect(prisma.validationRun.create).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });
});
