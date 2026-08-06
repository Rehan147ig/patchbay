import { describe, expect, it, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import { forbidden } from "@patchbay/domain";
import { POST } from "./route";
import { hashAgentKey } from "@/lib/agent-keys";

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
      new Request("http://localhost/api/vendors/openai/agent-key") as NextRequest,
      {
        params: Promise.resolve({ slug: "openai" }),
      },
    );
    expect(response.status).toBe(201);

    const body = (await response.json()) as { data: { agentKey: string; vendorSlug: string } };
    expect(body.data.vendorSlug).toBe("openai");
    expect(body.data.agentKey.startsWith("pb_agent_")).toBe(true);

    expect(prisma.vendor.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: "org-acme",
          agentKeyHash: hashAgentKey(body.data.agentKey),
        }),
      }),
    );
    expect(hashAgentKey(body.data.agentKey)).not.toBe(body.data.agentKey);
  });

  it("rejects non-admins", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(forbidden("Requires admin role"));
    const response = await POST(
      new Request("http://localhost/api/vendors/openai/agent-key") as NextRequest,
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
      new Request("http://localhost/api/vendors/openai/agent-key") as NextRequest,
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
      new Request("http://localhost/api/vendors/openai/agent-key") as NextRequest,
      {
        params: Promise.resolve({ slug: "openai" }),
      },
    );
    expect(response.status).toBe(404);
  });
});
