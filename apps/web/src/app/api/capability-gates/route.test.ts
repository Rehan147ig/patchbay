import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { forbidden } from "@patchbay/domain";
import { GET, POST } from "./route";

vi.mock("@patchbay/db", () => ({
  prisma: {
    capabilityGate: { findMany: vi.fn(), upsert: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
  withOrgContext: (client: never) => client,
}));

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn(),
}));

import { prisma } from "@patchbay/db";
import { requireRole } from "@/lib/auth";

function requestWithCsrf(body: unknown): NextRequest {
  return new Request("http://localhost/api/capability-gates", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie: "pb_csrf=token123",
      "x-csrf-token": "token123",
    },
    body: JSON.stringify(body),
  }) as NextRequest;
}

describe("POST /api/capability-gates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireRole).mockResolvedValue({
      id: "u-admin",
      organizationId: "org-acme",
    } as never);
    vi.mocked(prisma.capabilityGate.upsert).mockResolvedValue({
      id: "gate-1",
      status: "SUSPENDED",
    } as never);
    vi.mocked(prisma.auditEvent.create).mockResolvedValue({} as never);
  });

  it("requires ADMIN", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(forbidden("requires ADMIN") as never);
    const response = await POST(
      requestWithCsrf({ vendorSlug: "stripe", level: "DRAFT_PR", action: "suspend" }),
    );
    expect(response.status).toBe(403);
  });

  it("suspends a capability level for the organization", async () => {
    const response = await POST(
      requestWithCsrf({
        vendorSlug: "stripe",
        level: "DRAFT_PR",
        action: "suspend",
        reason: "incident",
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { status: string } };
    expect(body.data.status).toBe("SUSPENDED");
    expect(prisma.capabilityGate.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId_vendorSlug_level: {
            organizationId: "org-acme",
            vendorSlug: "stripe",
            level: "DRAFT_PR",
          },
        },
        create: expect.objectContaining({ status: "SUSPENDED", reason: "incident" }),
      }),
    );
  });

  it("restores a suspended capability", async () => {
    vi.mocked(prisma.capabilityGate.upsert).mockResolvedValue({
      id: "gate-1",
      status: "ACTIVE",
    } as never);
    const response = await POST(
      requestWithCsrf({ vendorSlug: "stripe", level: "DRAFT_PR", action: "restore" }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { status: string } };
    expect(body.data.status).toBe("ACTIVE");
  });

  it("rejects an unknown vendor slug", async () => {
    const response = await POST(
      requestWithCsrf({ vendorSlug: "not-a-vendor", level: "DRAFT_PR", action: "suspend" }),
    );
    expect(response.status).toBe(422);
    expect(prisma.capabilityGate.upsert).not.toHaveBeenCalled();
  });
});

describe("GET /api/capability-gates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireRole).mockResolvedValue({
      id: "u-1",
      organizationId: "org-acme",
    } as never);
    vi.mocked(prisma.capabilityGate.findMany).mockResolvedValue([
      { id: "gate-1", vendorSlug: "stripe", level: "DRAFT_PR", status: "SUSPENDED" },
    ] as never);
  });

  it("lists the organization gates", async () => {
    const response = await GET(new Request("http://localhost/api/capability-gates") as NextRequest);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { gates: Array<{ status: string }> } };
    expect(body.data.gates).toHaveLength(1);
    expect(body.data.gates[0].status).toBe("SUSPENDED");
    expect(prisma.capabilityGate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: "org-acme" }),
      }),
    );
  });
});
