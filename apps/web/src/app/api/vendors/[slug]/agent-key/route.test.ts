import { describe, expect, it, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import { forbidden } from "@patchbay/domain";
import { DELETE, POST } from "./route";
import { hashAgentKey, verifyAgentKey } from "@/lib/agent-keys";

vi.mock("@patchbay/db", () => ({
  prisma: {
    vendor: { findUnique: vi.fn(), update: vi.fn() },
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
    vi.mocked(prisma.vendor.update).mockResolvedValue(mockVendor as never);
  });

  it("issues an agent key to an ADMIN, storing only its hash", async () => {
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

    const updateCall = vi.mocked(prisma.vendor.update).mock.calls[0]?.[0] as {
      data: { agentKeyHash: string };
    };
    expect(updateCall.data.agentKeyHash.startsWith("$argon2id$")).toBe(true);
    expect(await verifyAgentKey(body.data.agentKey, updateCall.data.agentKeyHash)).toBe(true);
  });

  it("rotates: keeps the current hash as the previous hash", async () => {
    const existingHash = await hashAgentKey("pb_agent_old_key");
    vi.mocked(prisma.vendor.findUnique).mockResolvedValueOnce({
      ...mockVendor,
      organizationId: "org-acme",
      agentKeyHash: existingHash,
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
    expect(prisma.vendor.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          agentKeyHash: expect.stringContaining("$argon2id$"),
          agentKeyHashPrevious: existingHash,
        }),
      }),
    );
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
    expect(prisma.vendor.update).not.toHaveBeenCalled();
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
    expect(prisma.vendor.update).not.toHaveBeenCalled();
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
    vi.mocked(prisma.vendor.update).mockResolvedValue(mockVendor as never);
  });

  it("revokes: clears both hashes, keeps the organization claim, audits", async () => {
    const legacyHash = (await hashAgentKey("pb_agent_current")).replace("$argon2id$", "$sha256$");
    vi.mocked(prisma.vendor.findUnique).mockResolvedValueOnce({
      ...mockVendor,
      organizationId: "org-acme",
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

    expect(prisma.vendor.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "v-openai" },
        data: { agentKeyHash: null, agentKeyHashPrevious: null },
      }),
    );
    expect(prisma.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "agent.key_revoked" }),
      }),
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
    expect(prisma.vendor.update).not.toHaveBeenCalled();
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
    expect(prisma.vendor.update).not.toHaveBeenCalled();
  });

  it("rejects vendors owned by another organization", async () => {
    vi.mocked(prisma.vendor.findUnique).mockResolvedValueOnce({
      ...mockVendor,
      organizationId: "org-other",
      agentKeyHash: "$argon2id$abc",
    } as never);
    const response = await DELETE(
      new Request("http://localhost/api/vendors/openai/agent-key", {
        method: "DELETE",
        headers: csrfHeaders,
      }) as NextRequest,
      { params: Promise.resolve({ slug: "openai" }) },
    );
    expect(response.status).toBe(403);
    expect(prisma.vendor.update).not.toHaveBeenCalled();
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
    expect(prisma.vendor.update).not.toHaveBeenCalled();
  });
});
