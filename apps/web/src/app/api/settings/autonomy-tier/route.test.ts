import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { GET, PUT } from "./route";

vi.mock("@patchbay/db", () => ({
  prisma: {
    autonomyPolicy: { findUnique: vi.fn(), upsert: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
}));

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn(),
}));

import { prisma } from "@patchbay/db";
import { requireRole } from "@/lib/auth";

const adminUser = { id: "u-admin", organizationId: "org-acme" };

function requestWithCsrf(method: string, body?: unknown): NextRequest {
  return new Request("http://localhost/api/settings/autonomy-tier", {
    method,
    headers: {
      "Content-Type": "application/json",
      cookie: "pb_csrf=token123",
      "x-csrf-token": "token123",
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }) as NextRequest;
}

describe("GET /api/settings/autonomy-tier (WP12)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requireRole).mockResolvedValue(adminUser as never);
  });

  it("returns the stored tier and marks it explicit", async () => {
    vi.mocked(prisma.autonomyPolicy.upsert).mockResolvedValueOnce({
      defaultDecision: "ALLOW_DRAFT_PR",
    } as never);
    const response = await GET(requestWithCsrf("GET"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { tier: string; explicit: boolean } };
    expect(body.data).toEqual({ tier: "ALLOW_DRAFT_PR", explicit: true });
  });

  it("falls back to the recommended tier for legacy (unset) rows", async () => {
    vi.mocked(prisma.autonomyPolicy.upsert).mockResolvedValueOnce({
      defaultDecision: null,
    } as never);
    const response = await GET(requestWithCsrf("GET"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { tier: string; explicit: boolean } };
    expect(body.data).toEqual({ tier: "REQUIRE_APPROVAL", explicit: false });
  });
});

describe("PUT /api/settings/autonomy-tier (WP12)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requireRole).mockResolvedValue(adminUser as never);
    vi.mocked(prisma.auditEvent.create).mockResolvedValue({} as never);
  });

  it("persists the tier and audits the transition", async () => {
    vi.mocked(prisma.autonomyPolicy.findUnique).mockResolvedValueOnce({
      defaultDecision: "ALLOW_DRAFT_PR",
    } as never);
    vi.mocked(prisma.autonomyPolicy.upsert).mockResolvedValueOnce({
      id: "pol-1",
      defaultDecision: "PLAN_ONLY",
    } as never);
    const response = await PUT(requestWithCsrf("PUT", { tier: "PLAN_ONLY" }));
    expect(response.status).toBe(200);
    expect(prisma.autonomyPolicy.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ defaultDecision: "PLAN_ONLY" }),
      }),
    );
    expect(prisma.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "autonomy.tier_changed" }),
      }),
    );
  });

  it("rejects unknown tiers with a 422", async () => {
    const response = await PUT(requestWithCsrf("PUT", { tier: "YOLO_MERGE" }));
    expect(response.status).toBe(422);
    expect(prisma.autonomyPolicy.upsert).not.toHaveBeenCalled();
  });
});
