import { describe, expect, it, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import { forbidden } from "@patchbay/domain";
import { DELETE, POST } from "./route";
import { hashAgentKey, verifyAgentKey } from "@/lib/agent-keys";

vi.mock("@patchbay/db", () => ({
  prisma: {
    // vendor.update stays mocked only to prove the shared row is never
    // mutated anymore; all credential writes go through the enrollment.
    vendor: { findUnique: vi.fn(), update: vi.fn() },
    organizationVendorEnrollment: { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn() },
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

const mockVendor = {
  id: "v-openai",
  slug: "openai",
  name: "OpenAI",
  organizationId: null,
  agentKeyHash: null,
};

describe("POST /api/vendors/[slug]/agent-key", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireRole).mockResolvedValue(adminUser as never);
    vi.mocked(prisma.vendor.findUnique).mockResolvedValue(mockVendor as never);
    vi.mocked(prisma.organizationVendorEnrollment.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.organizationVendorEnrollment.upsert).mockResolvedValue({
      id: "enr-1",
    } as never);
  });

  it("issues an agent key to an ADMIN, storing only its hash on the enrollment", async () => {
    const response = await POST(
      new Request("http://localhost/api/vendors/openai/agent-key", {
        headers: csrfHeaders,
      }) as NextRequest,
      {
        params: Promise.resolve({ slug: "openai" }),
      },
    );
    expect(response.status).toBe(201);

    const body = (await response.json()) as { data: { agentKey: string; vendorSlug: string } };
    expect(body.data.vendorSlug).toBe("openai");
    expect(body.data.agentKey.startsWith("pb_agent_")).toBe(true);

    // The shared catalog row is never mutated or claimed...
    expect(prisma.vendor.update).not.toHaveBeenCalled();
    // ...the credential lands on this org's enrollment row instead.
    expect(prisma.organizationVendorEnrollment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId_vendorId: { organizationId: "org-acme", vendorId: "v-openai" },
        },
        create: expect.objectContaining({
          organizationId: "org-acme",
          vendorId: "v-openai",
          agentKeyHash: expect.stringContaining("$argon2id$"),
          status: "ACTIVE",
        }),
      }),
    );
    const upsertCall = vi.mocked(prisma.organizationVendorEnrollment.upsert).mock.calls[0]?.[0] as {
      create: { agentKeyHash: string };
    };
    expect(upsertCall.create.agentKeyHash.startsWith("$argon2id$")).toBe(true);
    expect(await verifyAgentKey(body.data.agentKey, upsertCall.create.agentKeyHash)).toBe(true);
  });

  it("rotates: keeps the current hash as the previous hash", async () => {
    const existingHash = await hashAgentKey("pb_agent_old_key");
    vi.mocked(prisma.organizationVendorEnrollment.findUnique).mockResolvedValueOnce({
      id: "enr-1",
      organizationId: "org-acme",
      vendorId: "v-openai",
      status: "ACTIVE",
      agentKeyHash: existingHash,
      agentKeyHashPrevious: null,
    } as never);
    const response = await POST(
      new Request("http://localhost/api/vendors/openai/agent-key", {
        headers: csrfHeaders,
      }) as NextRequest,
      {
        params: Promise.resolve({ slug: "openai" }),
      },
    );
    expect(response.status).toBe(201);
    expect(prisma.organizationVendorEnrollment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          agentKeyHash: expect.stringContaining("$argon2id$"),
          agentKeyHashPrevious: existingHash,
          status: "ACTIVE",
        }),
      }),
    );
  });

  it("lets two organizations enroll the same shared slug independently", async () => {
    // Org B's ADMIN issues for the same shared catalog row org-acme uses.
    vi.mocked(requireRole).mockResolvedValueOnce({ id: "u-b", organizationId: "org-b" } as never);
    const response = await POST(
      new Request("http://localhost/api/vendors/openai/agent-key", {
        headers: csrfHeaders,
      }) as NextRequest,
      {
        params: Promise.resolve({ slug: "openai" }),
      },
    );
    expect(response.status).toBe(201);
    // Separate compound key — org-acme's enrollment is never read or written.
    expect(prisma.organizationVendorEnrollment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId_vendorId: { organizationId: "org-b", vendorId: "v-openai" },
        },
      }),
    );
    expect(prisma.vendor.update).not.toHaveBeenCalled();
  });

  it("rejects non-admins", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(forbidden("Requires admin role"));
    const response = await POST(
      new Request("http://localhost/api/vendors/openai/agent-key", {
        headers: csrfHeaders,
      }) as NextRequest,
      {
        params: Promise.resolve({ slug: "openai" }),
      },
    );
    expect(response.status).toBe(403);
    expect(prisma.organizationVendorEnrollment.upsert).not.toHaveBeenCalled();
  });

  it("rejects vendors owned by another organization", async () => {
    vi.mocked(prisma.vendor.findUnique).mockResolvedValueOnce({
      ...mockVendor,
      organizationId: "org-other",
    } as never);
    const response = await POST(
      new Request("http://localhost/api/vendors/openai/agent-key", {
        headers: csrfHeaders,
      }) as NextRequest,
      {
        params: Promise.resolve({ slug: "openai" }),
      },
    );
    expect(response.status).toBe(403);
    expect(prisma.organizationVendorEnrollment.upsert).not.toHaveBeenCalled();
  });

  it("returns 404 for unknown vendors", async () => {
    vi.mocked(prisma.vendor.findUnique).mockResolvedValueOnce(null);
    const response = await POST(
      new Request("http://localhost/api/vendors/openai/agent-key", {
        headers: csrfHeaders,
      }) as NextRequest,
      {
        params: Promise.resolve({ slug: "openai" }),
      },
    );
    expect(response.status).toBe(404);
  });
});

describe("DELETE /api/vendors/[slug]/agent-key", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireRole).mockResolvedValue(adminUser as never);
    vi.mocked(prisma.vendor.findUnique).mockResolvedValue(mockVendor as never);
    vi.mocked(prisma.organizationVendorEnrollment.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.organizationVendorEnrollment.update).mockResolvedValue({
      id: "enr-1",
    } as never);
  });

  it("revokes: clears both hashes and flips the enrollment to REVOKED, audits", async () => {
    const legacyHash = (await hashAgentKey("pb_agent_current")).replace("$argon2id$", "$sha256$");
    vi.mocked(prisma.organizationVendorEnrollment.findUnique).mockResolvedValueOnce({
      id: "enr-1",
      organizationId: "org-acme",
      vendorId: "v-openai",
      status: "ACTIVE",
      agentKeyHash: legacyHash,
      agentKeyHashPrevious: await hashAgentKey("pb_agent_previous"),
    } as never);

    const response = await DELETE(
      new Request("http://localhost/api/vendors/openai/agent-key", {
        method: "DELETE",
        headers: csrfHeaders,
      }) as NextRequest,
      { params: Promise.resolve({ slug: "openai" }) },
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { status: string; vendorSlug: string } };
    expect(body.data).toMatchObject({ status: "REVOKED", vendorSlug: "openai" });

    expect(prisma.organizationVendorEnrollment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "enr-1" },
        data: { agentKeyHash: null, agentKeyHashPrevious: null, status: "REVOKED" },
      }),
    );
    expect(prisma.vendor.update).not.toHaveBeenCalled();
    expect(prisma.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "agent.key_revoked" }),
      }),
    );
  });

  it("revoking one org leaves another org's enrollment on the same slug untouched", async () => {
    vi.mocked(prisma.organizationVendorEnrollment.findUnique).mockResolvedValueOnce({
      id: "enr-b",
      organizationId: "org-b",
      vendorId: "v-openai",
      status: "ACTIVE",
      agentKeyHash: "$argon2id$other-org-key",
      agentKeyHashPrevious: null,
    } as never);
    vi.mocked(requireRole).mockResolvedValueOnce({ id: "u-b", organizationId: "org-b" } as never);

    const response = await DELETE(
      new Request("http://localhost/api/vendors/openai/agent-key", {
        method: "DELETE",
        headers: csrfHeaders,
      }) as NextRequest,
      { params: Promise.resolve({ slug: "openai" }) },
    );

    expect(response.status).toBe(200);
    // Resolved by the caller's own compound key — never org-acme's row.
    expect(prisma.organizationVendorEnrollment.findUnique).toHaveBeenCalledWith({
      where: { organizationId_vendorId: { organizationId: "org-b", vendorId: "v-openai" } },
    });
    expect(prisma.organizationVendorEnrollment.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "enr-b" } }),
    );
  });

  it("is idempotent when agent mode was never enabled", async () => {
    const response = await DELETE(
      new Request("http://localhost/api/vendors/openai/agent-key", {
        method: "DELETE",
        headers: csrfHeaders,
      }) as NextRequest,
      { params: Promise.resolve({ slug: "openai" }) },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { status: string } };
    expect(body.data.status).toBe("ALREADY_DISABLED");
    expect(prisma.organizationVendorEnrollment.update).not.toHaveBeenCalled();
  });

  it("is idempotent when the enrollment is already REVOKED", async () => {
    vi.mocked(prisma.organizationVendorEnrollment.findUnique).mockResolvedValueOnce({
      id: "enr-1",
      organizationId: "org-acme",
      vendorId: "v-openai",
      status: "REVOKED",
      agentKeyHash: null,
      agentKeyHashPrevious: null,
    } as never);
    const response = await DELETE(
      new Request("http://localhost/api/vendors/openai/agent-key", {
        method: "DELETE",
        headers: csrfHeaders,
      }) as NextRequest,
      { params: Promise.resolve({ slug: "openai" }) },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { status: string } };
    expect(body.data.status).toBe("ALREADY_DISABLED");
    expect(prisma.organizationVendorEnrollment.update).not.toHaveBeenCalled();
    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });

  it("rejects non-admins", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(forbidden("Requires admin role"));
    const response = await DELETE(
      new Request("http://localhost/api/vendors/openai/agent-key", {
        method: "DELETE",
        headers: csrfHeaders,
      }) as NextRequest,
      { params: Promise.resolve({ slug: "openai" }) },
    );
    expect(response.status).toBe(403);
    expect(prisma.organizationVendorEnrollment.update).not.toHaveBeenCalled();
  });

  it("rejects vendors owned by another organization", async () => {
    vi.mocked(prisma.vendor.findUnique).mockResolvedValueOnce({
      ...mockVendor,
      organizationId: "org-other",
    } as never);
    const response = await DELETE(
      new Request("http://localhost/api/vendors/openai/agent-key", {
        method: "DELETE",
        headers: csrfHeaders,
      }) as NextRequest,
      { params: Promise.resolve({ slug: "openai" }) },
    );
    expect(response.status).toBe(403);
    expect(prisma.organizationVendorEnrollment.update).not.toHaveBeenCalled();
  });

  it("returns 404 for unknown vendors", async () => {
    vi.mocked(prisma.vendor.findUnique).mockResolvedValueOnce(null);
    const response = await DELETE(
      new Request("http://localhost/api/vendors/openai/agent-key", {
        method: "DELETE",
        headers: csrfHeaders,
      }) as NextRequest,
      { params: Promise.resolve({ slug: "openai" }) },
    );
    expect(response.status).toBe(404);
  });

  it("requires the CSRF token", async () => {
    const response = await DELETE(
      new Request("http://localhost/api/vendors/openai/agent-key", {
        method: "DELETE",
      }) as NextRequest,
      { params: Promise.resolve({ slug: "openai" }) },
    );
    expect(response.status).toBe(403);
    expect(prisma.organizationVendorEnrollment.update).not.toHaveBeenCalled();
  });
});
