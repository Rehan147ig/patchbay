import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { GET } from "./route";

vi.mock("@patchbay/db", () => ({
  prisma: {
    remediationCase: { findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn(),
}));

import { prisma } from "@patchbay/db";
import { requireRole } from "@/lib/auth";

function request(): NextRequest {
  return new Request("http://localhost/api/maintenance/cases/case-1", {
    method: "GET",
  }) as NextRequest;
}

describe("GET /api/maintenance/cases/[id] (WP12)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requireRole).mockResolvedValue({
      id: "u-1",
      organizationId: "org-acme",
    } as never);
  });

  it("returns the full case detail for the owning org", async () => {
    vi.mocked(prisma.remediationCase.findFirst).mockResolvedValueOnce({ id: "case-1" } as never);
    const response = await GET(request(), { params: Promise.resolve({ id: "case-1" }) });
    expect(response.status).toBe(200);
    expect(prisma.remediationCase.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "case-1", organizationId: "org-acme" },
        include: expect.objectContaining({
          events: expect.anything(),
          plans: expect.anything(),
          policyDecisions: expect.anything(),
          attempts: expect.anything(),
        }),
      }),
    );
  });

  it("returns 404 for foreign cases (no cross-tenant oracle)", async () => {
    vi.mocked(prisma.remediationCase.findFirst).mockResolvedValueOnce(null);
    const response = await GET(request(), { params: Promise.resolve({ id: "case-x" }) });
    expect(response.status).toBe(404);
  });
});
