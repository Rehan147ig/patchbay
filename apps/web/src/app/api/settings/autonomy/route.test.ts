import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { GET, PUT } from "./route";

vi.mock("@patchbay/db", () => ({
  prisma: {
    autonomyPolicy: { upsert: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
}));

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn(),
}));

import { prisma } from "@patchbay/db";
import { requireRole } from "@/lib/auth";

const memberUser = { id: "u-member", organizationId: "org-acme" };
const adminUser = { id: "u-admin", organizationId: "org-acme" };

const stored = {
  maxOpenAutonomousPRs: 5,
  minimumReleaseAgeDays: 3,
  groupMinorPatches: true,
  vulnBypassStability: true,
  excludedPackages: [],
};

function getRequest(): NextRequest {
  return new Request("http://localhost/api/settings/autonomy") as NextRequest;
}

function putRequest(body: unknown): NextRequest {
  return new Request("http://localhost/api/settings/autonomy", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      cookie: "pb_csrf=token123",
      "x-csrf-token": "token123",
    },
    body: JSON.stringify(body),
  }) as NextRequest;
}

describe("GET /api/settings/autonomy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireRole).mockResolvedValue(memberUser as never);
    vi.mocked(prisma.autonomyPolicy.upsert).mockResolvedValue(stored as never);
  });

  it("returns the policy, lazily creating safe defaults", async () => {
    const response = await GET(getRequest());
    expect(response.status).toBe(200);
    expect(vi.mocked(prisma.autonomyPolicy.upsert)).toHaveBeenCalledWith({
      where: { organizationId: "org-acme" },
      update: {},
      create: { organizationId: "org-acme" },
    });
    const body = (await response.json()) as { data: typeof stored };
    expect(body.data).toEqual(stored);
  });
});

describe("PUT /api/settings/autonomy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireRole).mockResolvedValue(adminUser as never);
    vi.mocked(prisma.autonomyPolicy.upsert).mockResolvedValue(stored as never);
    vi.mocked(prisma.auditEvent.create).mockResolvedValue({} as never);
  });

  it("updates the policy and audit-logs the change", async () => {
    const next = { ...stored, maxOpenAutonomousPRs: 2, excludedPackages: ["react"] };
    vi.mocked(prisma.autonomyPolicy.upsert).mockResolvedValue(next as never);
    const response = await PUT(putRequest(next));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: typeof next };
    expect(body.data).toEqual(next);
    expect(vi.mocked(prisma.auditEvent.create)).toHaveBeenCalled();
  });

  it("rejects out-of-range values", async () => {
    const response = await PUT(putRequest({ ...stored, maxOpenAutonomousPRs: 500 }));
    expect(response.status).toBe(422);
  });
});
