import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { POST } from "./route";

vi.mock("@patchbay/db", () => ({
  prisma: {
    remediationCase: { findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn(),
}));

vi.mock("../../../../remediations/[id]/validate/route", () => ({
  POST: vi.fn(),
}));

import { prisma } from "@patchbay/db";
import { requireRole } from "@/lib/auth";
import { POST as validatePlan } from "../../../../remediations/[id]/validate/route";

function request(): NextRequest {
  return new Request("http://localhost/api/maintenance/cases/case-1/validate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie: "pb_csrf=token123",
      "x-csrf-token": "token123",
    },
  }) as NextRequest;
}

const params = { params: Promise.resolve({ id: "case-1" }) };

describe("POST /api/maintenance/cases/[id]/validate (WP12)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requireRole).mockResolvedValue({
      id: "u-1",
      organizationId: "org-acme",
    } as never);
  });

  it("delegates to the canonical plan validation vector with the latest plan", async () => {
    vi.mocked(prisma.remediationCase.findFirst).mockResolvedValueOnce({
      id: "case-1",
      plans: [{ id: "plan-9" }],
    } as never);
    vi.mocked(validatePlan).mockResolvedValueOnce(
      Response.json({ data: { validationRunId: "val-1", status: "QUEUED" } }, { status: 202 }),
    );
    const req = request();
    const response = await POST(req, params);
    expect(response.status).toBe(202);
    expect(validatePlan).toHaveBeenCalledWith(req, { params: expect.any(Promise) });
    const delegatedParams = vi.mocked(validatePlan).mock.calls[0]?.[1] as {
      params: Promise<{ id: string }>;
    };
    await expect(delegatedParams.params).resolves.toEqual({ id: "plan-9" });
  });

  it("fails closed with guidance when the case has no plan", async () => {
    vi.mocked(prisma.remediationCase.findFirst).mockResolvedValueOnce({
      id: "case-1",
      plans: [],
    } as never);
    const response = await POST(request(), params);
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/run Plan first/);
    expect(validatePlan).not.toHaveBeenCalled();
  });

  it("returns 404 for foreign cases", async () => {
    vi.mocked(prisma.remediationCase.findFirst).mockResolvedValueOnce(null);
    const response = await POST(request(), params);
    expect(response.status).toBe(404);
  });
});
