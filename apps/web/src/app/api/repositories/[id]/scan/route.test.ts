import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { GET } from "./route";

vi.mock("@patchbay/db", () => ({
  prisma: {
    repository: { findFirst: vi.fn() },
    repositoryScan: { findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn(),
}));

import { prisma } from "@patchbay/db";
import { requireRole } from "@/lib/auth";

function request(): NextRequest {
  return new Request("http://localhost/api/repositories/repo-1/scan", {
    method: "GET",
  }) as NextRequest;
}

const params = { params: Promise.resolve({ id: "repo-1" }) };

describe("GET /api/repositories/[id]/scan (WP12 progress polling)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requireRole).mockResolvedValue({
      id: "u-1",
      organizationId: "org-acme",
    } as never);
    vi.mocked(prisma.repository.findFirst).mockResolvedValue({ id: "repo-1" } as never);
  });

  it("returns the latest scan for progress polling", async () => {
    vi.mocked(prisma.repositoryScan.findFirst).mockResolvedValueOnce({
      id: "scan-1",
      status: "RUNNING",
    } as never);
    const response = await GET(request(), params);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { scan: { status: string } } };
    expect(body.data.scan.status).toBe("RUNNING");
  });

  it("fails closed when no scan exists yet or the repo is foreign", async () => {
    vi.mocked(prisma.repositoryScan.findFirst).mockResolvedValueOnce(null);
    await expect(GET(request(), params)).resolves.toMatchObject({ status: 422 });
    vi.mocked(prisma.repository.findFirst).mockResolvedValueOnce(null);
    await expect(GET(request(), params)).resolves.toMatchObject({ status: 422 });
  });
});
