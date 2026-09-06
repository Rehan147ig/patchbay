import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "./route";

vi.mock("@patchbay/db", () => ({
  prisma: {
    contractSource: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    vendor: { findFirst: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
  encryptSecret: vi.fn(() => "sealed"),
  isKmsConfigured: vi.fn(() => false),
}));

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn(),
}));

import { prisma, isKmsConfigured } from "@patchbay/db";
import { requireRole } from "@/lib/auth";

const adminUser = { id: "u-admin", organizationId: "org-acme" };

function getRequest(query = ""): NextRequest {
  return new NextRequest(`http://localhost/api/contracts/sources${query}`, {
    method: "GET",
  });
}

function postRequest(body: unknown): NextRequest {
  return new Request("http://localhost/api/contracts/sources", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie: "pb_csrf=token123",
      "x-csrf-token": "token123",
    },
    body: JSON.stringify(body),
  }) as NextRequest;
}

describe("GET /api/contracts/sources (WP12)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requireRole).mockResolvedValue(adminUser as never);
  });

  it("lists catalog + org sources with derived health", async () => {
    vi.mocked(prisma.contractSource.findMany).mockResolvedValueOnce([
      {
        id: "src-1",
        vendorSlug: "openai",
        kind: "SDK",
        name: "openai-node",
        organizationId: null,
        status: "ACTIVE",
        lastObservedAt: new Date(),
        _count: { snapshots: 3, changes: 1, consumers: 5 },
      },
    ] as never);
    const response = await GET(getRequest());
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { sources: Array<{ scope: string; health: string }> };
    };
    expect(body.data.sources[0]).toMatchObject({ scope: "catalog", health: "healthy" });
    expect(prisma.contractSource.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ organizationId: null }, { organizationId: "org-acme" }],
        }),
      }),
    );
  });

  it("marks stale sources for sync instead of erroring", async () => {
    vi.mocked(prisma.contractSource.findMany).mockResolvedValueOnce([
      {
        id: "src-9",
        vendorSlug: "twilio",
        kind: "SDK",
        name: "twilio-node",
        organizationId: "org-acme",
        status: "ACTIVE",
        lastObservedAt: new Date("2020-01-01T00:00:00Z"),
        _count: { snapshots: 0, changes: 0, consumers: 0 },
      },
    ] as never);
    const response = await GET(getRequest());
    const body = (await response.json()) as {
      data: { sources: Array<{ health: string }> };
    };
    expect(body.data.sources[0]?.health).toBe("stale");
  });

  it("rejects unknown kinds with a 422", async () => {
    const response = await GET(getRequest("?kind=BOGUS"));
    expect(response.status).toBe(422);
  });
});

describe("POST /api/contracts/sources (WP12)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requireRole).mockResolvedValue(adminUser as never);
    vi.mocked(prisma.auditEvent.create).mockResolvedValue({} as never);
    vi.mocked(prisma.vendor.findFirst).mockResolvedValue({ slug: "stripe" } as never);
    vi.mocked(prisma.contractSource.findFirst).mockResolvedValue(null);
  });

  it("creates an org source and audits it", async () => {
    vi.mocked(prisma.contractSource.create).mockResolvedValueOnce({ id: "src-new" } as never);
    const response = await POST(postRequest({ vendorSlug: "stripe", kind: "SDK", name: "s" }));
    expect(response.status).toBe(201);
    expect(prisma.contractSource.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ organizationId: "org-acme", status: "ACTIVE" }),
      }),
    );
    expect(prisma.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "contract_source.created" }),
      }),
    );
  });

  it("returns the existing row on duplicate registration (idempotent)", async () => {
    vi.mocked(prisma.contractSource.findFirst).mockResolvedValueOnce({ id: "src-old" } as never);
    const response = await POST(postRequest({ vendorSlug: "stripe", kind: "SDK", name: "s" }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { duplicate: boolean } };
    expect(body.data.duplicate).toBe(true);
    expect(prisma.contractSource.create).not.toHaveBeenCalled();
  });

  it("refuses provider config without KMS (no theater encryption)", async () => {
    vi.mocked(isKmsConfigured).mockReturnValue(false);
    const response = await POST(
      postRequest({ vendorSlug: "stripe", kind: "SDK", name: "s", config: { token: "x" } }),
    );
    expect(response.status).toBe(422);
    expect(prisma.contractSource.create).not.toHaveBeenCalled();
  });

  it("rejects unknown vendors and kinds", async () => {
    vi.mocked(prisma.vendor.findFirst).mockResolvedValueOnce(null);
    await expect(
      POST(postRequest({ vendorSlug: "nope", kind: "SDK", name: "s" })),
    ).resolves.toMatchObject({ status: 422 });
    await expect(
      POST(postRequest({ vendorSlug: "stripe", kind: "BOGUS", name: "s" })),
    ).resolves.toMatchObject({ status: 422 });
  });
});
