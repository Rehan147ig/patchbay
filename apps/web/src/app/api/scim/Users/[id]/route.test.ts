import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { DELETE, PATCH } from "./route";
import { generateScimToken, hashScimToken, scimTokenLookupPrefix } from "@/lib/scim-tokens";

vi.mock("@patchbay/db", () => ({
  prisma: {
    organization: { findFirst: vi.fn() },
    user: { findFirst: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
  withOrgContext: (client: unknown) => client,
}));

vi.mock("@/lib/rate-limit", () => ({
  checkGlobalRateLimit: vi.fn(),
}));

vi.mock("@/lib/session-rotation", () => ({
  rotateSessions: vi.fn(),
}));

import { prisma } from "@patchbay/db";
import { checkGlobalRateLimit } from "@/lib/rate-limit";
import { rotateSessions } from "@/lib/session-rotation";

const SCIM_TOKEN = generateScimToken();
let scimHash = "";

function patchUser(
  id: string,
  body: unknown,
  token: string | null = SCIM_TOKEN,
): Promise<Response> {
  return PATCH(
    new Request(`http://localhost/api/scim/Users/${id}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    }) as NextRequest,
    { params: Promise.resolve({ id }) },
  );
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
  vi.mocked(prisma.user.findFirst).mockResolvedValue({
    id: "u-1",
    email: "eng@acme.test",
  } as never);
  vi.mocked(prisma.auditEvent.create).mockResolvedValue({} as never);
  delete process.env.SCIM_TOKEN;
  delete process.env.SCIM_ORGANIZATION_ID;
});

describe("PATCH /api/scim/Users/:id (deprovisioning)", () => {
  it("revokes every session and records SCIM_USER_DEPROVISIONED", async () => {
    const response = await patchUser("u-1", { active: false });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { id: string; active: boolean } };
    expect(body.data).toMatchObject({ id: "u-1", active: false });
    expect(rotateSessions).toHaveBeenCalledWith("u-1");
    expect(prisma.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: "org-acme",
          action: "scim.user_deprovisioned",
          entityId: "u-1",
        }),
      }),
    );
  });

  it("rejects anything but deactivation with 422", async () => {
    const response = await patchUser("u-1", { active: true });
    expect(response.status).toBe(422);
    expect(rotateSessions).not.toHaveBeenCalled();
  });

  it("returns 404 for users outside the token's organization", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null as never);
    const response = await patchUser("u-other", { active: false });
    expect(response.status).toBe(404);
    expect(rotateSessions).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated deprovisioning with 401", async () => {
    const response = await patchUser("u-1", { active: false }, null);
    expect(response.status).toBe(401);
    expect(rotateSessions).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/scim/Users/:id (deprovisioning alias)", () => {
  it("deprovisions exactly like PATCH active:false", async () => {
    const response = await DELETE(
      new Request("http://localhost/api/scim/Users/u-1", {
        method: "DELETE",
        headers: { authorization: `Bearer ${SCIM_TOKEN}` },
      }) as NextRequest,
      { params: Promise.resolve({ id: "u-1" }) },
    );
    expect(response.status).toBe(200);
    expect(rotateSessions).toHaveBeenCalledWith("u-1");
    expect(prisma.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "scim.user_deprovisioned" }),
      }),
    );
  });
});
