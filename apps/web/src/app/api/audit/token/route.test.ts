import { describe, expect, it, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import { forbidden } from "@patchbay/domain";
import { DELETE, POST } from "./route";
import { hashAuditExportToken, verifyAuditExportToken } from "@/lib/audit-export-tokens";

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
  auditExportTokenHash: null,
  auditExportTokenHashPrevious: null,
};

describe("POST /api/audit/token", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireRole).mockResolvedValue(adminUser as never);
    vi.mocked(prisma.organization.findUnique).mockResolvedValue(unenrolledOrg as never);
    vi.mocked(prisma.organization.update).mockResolvedValue(unenrolledOrg as never);
  });

  it("issues a token to an ADMIN, storing only its argon2id hash plus prefix", async () => {
    const response = await POST(
      new Request("http://localhost/api/audit/token", {
        method: "POST",
        headers: csrfHeaders,
      }) as NextRequest,
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      data: { auditExportToken: string; tokenPrefix: string };
    };
    expect(body.data.auditExportToken.startsWith("pb_audit_")).toBe(true);

    const updateCall = vi.mocked(prisma.organization.update).mock.calls[0]?.[0] as {
      data: {
        auditExportTokenHash: string;
        auditExportTokenHashPrevious: null;
        auditExportTokenPrefix: string;
      };
    };
    expect(updateCall.data.auditExportTokenHash.startsWith("$argon2id$")).toBe(true);
    expect(updateCall.data.auditExportTokenHashPrevious).toBeNull();
    expect(updateCall.data.auditExportTokenPrefix).toBe(body.data.auditExportToken.slice(0, 21));
    expect(
      await verifyAuditExportToken(
        body.data.auditExportToken,
        updateCall.data.auditExportTokenHash,
        null,
      ),
    ).toBe("current");
  });

  it("rotates: the current hash moves to previous so SOC automation keeps working", async () => {
    const oldHash = await hashAuditExportToken("pb_audit_old_token_value________");
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      ...unenrolledOrg,
      auditExportTokenHash: oldHash,
    } as never);

    const response = await POST(
      new Request("http://localhost/api/audit/token", {
        method: "POST",
        headers: csrfHeaders,
      }) as NextRequest,
    );
    expect(response.status).toBe(201);
    const updateCall = vi.mocked(prisma.organization.update).mock.calls[0]?.[0] as {
      data: { auditExportTokenHash: string; auditExportTokenHashPrevious: string };
    };
    expect(updateCall.data.auditExportTokenHashPrevious).toBe(oldHash);
    expect(updateCall.data.auditExportTokenHash).not.toBe(oldHash);
  });

  it("rejects non-admin callers", async () => {
    vi.mocked(requireRole).mockRejectedValue(forbidden("ADMIN only"));
    const response = await POST(
      new Request("http://localhost/api/audit/token", {
        method: "POST",
        headers: csrfHeaders,
      }) as NextRequest,
    );
    expect(response.status).toBe(403);
    expect(prisma.organization.update).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/audit/token", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireRole).mockResolvedValue(adminUser as never);
  });

  it("revokes every stored hash immediately", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      ...unenrolledOrg,
      auditExportTokenHash: "$argon2id$abc",
      auditExportTokenHashPrevious: "$argon2id$old",
    } as never);
    const response = await DELETE(
      new Request("http://localhost/api/audit/token", {
        method: "DELETE",
        headers: csrfHeaders,
      }) as NextRequest,
    );
    expect(response.status).toBe(200);
    expect(prisma.organization.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          auditExportTokenHash: null,
          auditExportTokenHashPrevious: null,
          auditExportTokenPrefix: null,
          auditExportTokenRotatedAt: null,
        },
      }),
    );
  });

  it("is idempotent when no token is enrolled", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue(unenrolledOrg as never);
    const response = await DELETE(
      new Request("http://localhost/api/audit/token", {
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
