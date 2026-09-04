import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { GET, POST } from "./route";
import { generateScimToken, hashScimToken, scimTokenLookupPrefix } from "@/lib/scim-tokens";

vi.mock("@patchbay/db", () => ({
  prisma: {
    organization: { findFirst: vi.fn() },
    user: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
  withOrgContext: (client: unknown) => client,
}));

vi.mock("@/lib/rate-limit", () => ({
  checkGlobalRateLimit: vi.fn(),
}));

import { prisma } from "@patchbay/db";
import { checkGlobalRateLimit } from "@/lib/rate-limit";

const SCIM_TOKEN = generateScimToken();
let scimHash = "";

function scimRequest(body: unknown, token: string | null = SCIM_TOKEN): NextRequest {
  return new Request("http://localhost/api/scim/Users", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  }) as NextRequest;
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(checkGlobalRateLimit).mockResolvedValue({ allowed: true, retryAfterMs: 0 });
  scimHash = await hashScimToken(SCIM_TOKEN);
  vi.mocked(prisma.organization.findFirst).mockImplementation((async (args: unknown) => {
    const where = (args as { where: { scimTokenPrefix: string } }).where;
    if (where.scimTokenPrefix === scimTokenLookupPrefix(SCIM_TOKEN)) {
      return { id: "org-acme", scimTokenHash: scimHash, scimTokenHashPrevious: null };
    }
    return null;
  }) as never);
  vi.mocked(prisma.user.findFirst).mockResolvedValue(null as never);
  vi.mocked(prisma.user.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.user.create).mockResolvedValue({
    id: "u-1",
    email: "eng@acme.test",
  } as never);
  vi.mocked(prisma.auditEvent.create).mockResolvedValue({} as never);
  delete process.env.SCIM_TOKEN;
  delete process.env.SCIM_ORGANIZATION_ID;
});

describe("per-org SCIM bearer auth", () => {
  it("provisions a user when the token verifies against the org hash", async () => {
    const response = await POST(scimRequest({ userName: "eng@acme.test" }));
    expect(response.status).toBe(201);
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ email: "eng@acme.test", organizationId: "org-acme" }),
      }),
    );
  });

  it("rejects a token whose prefix matches no organization (401, no user write)", async () => {
    const other = generateScimToken();
    const response = await POST(scimRequest({ userName: "eng@acme.test" }, other));
    expect(response.status).toBe(401);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it("rejects a token with a valid prefix but wrong secret (401)", async () => {
    const forged = `${scimTokenLookupPrefix(SCIM_TOKEN)}${"x".repeat(32)}`;
    const response = await POST(scimRequest({ userName: "eng@acme.test" }, forged));
    expect(response.status).toBe(401);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it("keeps the legacy global-token fallback for unenrolled orgs", async () => {
    process.env.SCIM_TOKEN = "legacy-global-secret";
    process.env.SCIM_ORGANIZATION_ID = "org-legacy";
    vi.mocked(prisma.organization.findFirst).mockResolvedValue(null);
    const response = await POST(scimRequest({ userName: "eng@acme.test" }, "legacy-global-secret"));
    expect(response.status).toBe(201);
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ organizationId: "org-legacy" }),
      }),
    );
  });

  it("lists users for the resolved organization", async () => {
    const response = await GET(
      new Request("http://localhost/api/scim/Users", {
        headers: { authorization: `Bearer ${SCIM_TOKEN}` },
      }) as NextRequest,
    );
    expect(response.status).toBe(200);
  });
});
