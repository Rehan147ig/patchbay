import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";

vi.mock("@patchbay/db", () => ({
  prisma: {
    remediationCase: { count: vi.fn(), findMany: vi.fn() },
  },
}));

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn(),
}));

import { prisma } from "@patchbay/db";
import { requireRole } from "@/lib/auth";

function request(query = ""): NextRequest {
  return new NextRequest(`http://localhost/api/maintenance/cases${query}`, {
    method: "GET",
  });
}

describe("GET /api/maintenance/cases (WP12)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requireRole).mockResolvedValue({
      id: "u-1",
      organizationId: "org-acme",
    } as never);
    vi.mocked(prisma.remediationCase.count).mockResolvedValue(2);
    vi.mocked(prisma.remediationCase.findMany).mockResolvedValue([] as never);
  });

  it("lists org cases with pagination", async () => {
    const response = await GET(request("?page=2&pageSize=10"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { pagination: { page: number; pageSize: number; total: number } };
    };
    expect(body.data.pagination).toEqual({ page: 2, pageSize: 10, total: 2 });
    expect(prisma.remediationCase.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "org-acme" },
        skip: 10,
        take: 10,
      }),
    );
  });

  it("filters by status and repository", async () => {
    const response = await GET(request("?status=OBSERVED&repositoryId=repo-1"));
    expect(response.status).toBe(200);
    expect(prisma.remediationCase.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "org-acme", status: "OBSERVED", repositoryId: "repo-1" },
      }),
    );
  });

  it("rejects unknown statuses with a 422", async () => {
    const response = await GET(request("?status=BOGUS"));
    expect(response.status).toBe(422);
    expect(prisma.remediationCase.findMany).not.toHaveBeenCalled();
  });
});
