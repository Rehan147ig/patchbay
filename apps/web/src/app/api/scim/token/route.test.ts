import { describe, expect, it, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import { forbidden } from "@patchbay/domain";
import { DELETE, POST } from "./route";
import { hashScimToken, verifyScimToken } from "@/lib/scim-tokens";

vi.mock("@patchbay/db", () => ({
  prisma: {
    organization: { findUnique: vi.fn(), update: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
}));

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn(),
}));

import { prisma } from "@patchbay/db";
import { requireRole } from "@/lib/auth";

const adminUser = { id: "u-admin", organizationId: "org-acme" };

const CSRF_TOKEN = "test-csrf-token";
const csrfHeaders = { Cookie: `pb_csrf=${CSRF_TOKEN}`, "x-csrf-token": CSRF_TOKEN };

const unenrolledOrg = {
  id: "org-acme",
  scimTokenHash: null,
  scimTokenHashPrevious: null,
};

describe("POST /api/scim/token", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireRole).mockResolvedValue(adminUser as never);
    vi.mocked(prisma.organization.findUnique).mockResolvedValue(unenrolledOrg as never);
    vi.mocked(prisma.organization.update).mockResolvedValue(unenrolledOrg as never);
  });

  it("issues a token to an ADMIN, storing only its argon2id hash plus prefix", async () => {
    const response = await POST(
      new Request("http://localhost/api/scim/token", {
        method: "POST",
        headers: csrfHeaders,
      }) as NextRequest,
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      data: { scimToken: string; tokenPrefix: string };
    };
    expect(body.data.scimToken.startsWith("pb_scim_")).toBe(true);

    const updateCall = vi.mocked(prisma.organization.update).mock.calls[0]?.[0] as {
      data: { scimTokenHash: string; scimTokenHashPrevious: null; scimTokenPrefix: string };
    };
    expect(updateCall.data.scimTokenHash.startsWith("$argon2id$")).toBe(true);
    expect(updateCall.data.scimTokenHashPrevious).toBeNull();
    expect(updateCall.data.scimTokenPrefix).toBe(body.data.scimToken.slice(0, 20));
    expect(await verifyScimToken(body.data.scimToken, updateCall.data.scimTokenHash, null)).toBe(
      "current",
    );
  });

  it("rotates: the current hash moves to previous so the old token keeps working", async () => {
    const oldHash = await hashScimToken("pb_scim_old_token_value___________");
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      ...unenrolledOrg,
      scimTokenHash: oldHash,
    } as never);

    const response = await POST(
      new Request("http://localhost/api/scim/token", {
        method: "POST",
        headers: csrfHeaders,
      }) as NextRequest,
    );
    expect(response.status).toBe(201);
    const updateCall = vi.mocked(prisma.organization.update).mock.calls[0]?.[0] as {
      data: { scimTokenHash: string; scimTokenHashPrevious: string };
    };
    expect(updateCall.data.scimTokenHashPrevious).toBe(oldHash);
    expect(updateCall.data.scimTokenHash).not.toBe(oldHash);
  });

  it("rejects non-admin callers", async () => {
    vi.mocked(requireRole).mockRejectedValue(forbidden("ADMIN only"));
    const response = await POST(
      new Request("http://localhost/api/scim/token", {
        method: "POST",
        headers: csrfHeaders,
      }) as NextRequest,
    );
    expect(response.status).toBe(403);
    expect(prisma.organization.update).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/scim/token", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireRole).mockResolvedValue(adminUser as never);
  });

  it("revokes every stored hash immediately", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      ...unenrolledOrg,
      scimTokenHash: "$argon2id$abc",
      scimTokenHashPrevious: "$argon2id$old",
    } as never);
    const response = await DELETE(
      new Request("http://localhost/api/scim/token", {
        method: "DELETE",
        headers: csrfHeaders,
      }) as NextRequest,
    );
    expect(response.status).toBe(200);
    expect(prisma.organization.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          scimTokenHash: null,
          scimTokenHashPrevious: null,
          scimTokenPrefix: null,
          scimTokenRotatedAt: null,
        },
      }),
    );
  });

  it("is idempotent when no token is enrolled", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue(unenrolledOrg as never);
    const response = await DELETE(
      new Request("http://localhost/api/scim/token", {
        method: "DELETE",
        headers: csrfHeaders,
      }) as NextRequest,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { status: string } };
    expect(body.data.status).toBe("ALREADY_DISABLED");
    expect(prisma.organization.update).not.toHaveBeenCalled();
  });
});
