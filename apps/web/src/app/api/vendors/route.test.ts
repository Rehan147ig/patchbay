import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { unauthorized } from "@patchbay/domain";
import { GET } from "./route";

vi.mock("@patchbay/db", () => ({
  prisma: {
    vendor: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn(),
}));

import { prisma } from "@patchbay/db";
import { requireRole } from "@/lib/auth";

const adminUser = { id: "u-admin", organizationId: "org-acme" };

const mockVendors = [
  {
    id: "v-openai",
    slug: "openai",
    name: "OpenAI",
    category: "AI",
    docsUrl: null,
    enabled: true,
    agentKeyHash: "$argon2id$hash",
  },
  {
    id: "v-anthropic",
    slug: "anthropic",
    name: "Anthropic",
    category: "AI",
    docsUrl: null,
    enabled: true,
    agentKeyHash: null,
  },
  {
    id: "v-generic-openapi",
    slug: "generic-openapi",
    name: "Generic OpenAPI",
    category: "Other",
    docsUrl: null,
    enabled: true,
    agentKeyHash: null,
  },
  {
    id: "v-acme",
    slug: "acme-not-in-catalog",
    name: "Acme",
    category: "Other",
    docsUrl: null,
    enabled: true,
    agentKeyHash: null,
  },
];

function get(url: string) {
  return GET(new NextRequest(url));
}

describe("GET /api/vendors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireRole).mockResolvedValue(adminUser as never);
    vi.mocked(prisma.vendor.findMany).mockResolvedValue(mockVendors as never);
  });

  it("merges the capability contract into each catalog vendor", async () => {
    const response = await get("http://localhost/api/vendors");
    expect(response.status).toBe(200);

    const body = (await response.json()) as { data: { vendors: unknown[] } };
    const openai = (body.data.vendors as Array<Record<string, unknown>>).find(
      (vendor) => vendor.slug === "openai",
    );
    expect(openai?.agentModeEnabled).toBe(true);
    expect(openai?.capability).toMatchObject({
      level: "DRAFT_PR",
      language: "typescript/javascript",
      ecosystem: "npm",
      package: "openai",
      requiredPolicyClass: "APPROVAL_REQUIRED",
      certified: true,
      corpusStatus: "ACTIVE",
    });

    const anthropic = (body.data.vendors as Array<Record<string, unknown>>).find(
      (vendor) => vendor.slug === "anthropic",
    );
    expect(anthropic?.capability).toMatchObject({
      level: "ASSESS",
      certified: false,
      corpusStatus: null,
    });

    const acme = (body.data.vendors as Array<Record<string, unknown>>).find(
      (vendor) => vendor.slug === "acme-not-in-catalog",
    );
    expect(acme?.capability).toBeNull();

    // generic-openapi is in the catalog but only ASSESS — never certified for DRAFT_PR or PLAN.
    const genericOpenapi = (body.data.vendors as Array<Record<string, unknown>>).find(
      (vendor) => vendor.slug === "generic-openapi",
    );
    expect(genericOpenapi).toBeDefined();
    expect(genericOpenapi?.capability).toMatchObject({
      level: "ASSESS",
      certified: false,
    });
  });

  it("filters to vendors certified at or above the minLevel", async () => {
    const response = await get("http://localhost/api/vendors?minLevel=PLAN");
    expect(response.status).toBe(200);

    const body = (await response.json()) as { data: { vendors: Array<{ slug: string }> } };
    const slugs = body.data.vendors.map((vendor) => vendor.slug);
    expect(slugs).toContain("openai");
    expect(slugs).not.toContain("anthropic");
    expect(slugs).not.toContain("acme-not-in-catalog");
  });

  it("rejects an unknown minLevel", async () => {
    const response = await get("http://localhost/api/vendors?minLevel=EXPLODE");
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "BAD_REQUEST" } });
  });

  it("requires the VIEWER role", async () => {
    vi.mocked(requireRole).mockRejectedValue(unauthorized());
    const response = await get("http://localhost/api/vendors");
    expect(response.status).toBe(401);
  });
});
