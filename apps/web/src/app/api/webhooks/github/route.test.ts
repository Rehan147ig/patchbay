import { createHmac } from "node:crypto";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import { POST } from "./route";

vi.mock("@patchbay/db", () => ({
  prisma: {
    webhookDelivery: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    pullRequest: { findFirst: vi.fn(), update: vi.fn() },
    gitHubInstallation: { updateMany: vi.fn(), findUnique: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
}));

import { prisma } from "@patchbay/db";

const SECRET = "webhook-secret-for-tests";
const payload = JSON.stringify({
  action: "opened",
  repository: { id: 1 },
  pull_request: { number: 7, state: "open", draft: true },
});

function sign(body: string): string {
  return `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`;
}

function webhookRequest(
  overrides: { body?: string; deliveryId?: string; signature?: string } = {},
): NextRequest {
  const headers: Record<string, string> = {
    "x-github-delivery": overrides.deliveryId ?? "delivery-1",
    "x-github-event": "pull_request",
    "x-hub-signature-256": overrides.signature ?? sign(overrides.body ?? payload),
  };
  return new Request("http://localhost/api/webhooks/github", {
    method: "POST",
    headers,
    body: overrides.body ?? payload,
  }) as NextRequest;
}

describe("POST /api/webhooks/github", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GITHUB_APP_WEBHOOK_SECRET = SECRET;
    vi.mocked(prisma.webhookDelivery.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.webhookDelivery.create).mockResolvedValue({
      id: "w-1",
      deliveryId: "delivery-1",
      event: "pull_request",
      payloadHash: "h",
      status: "RECEIVED",
      receivedAt: new Date(),
    } as never);
    vi.mocked(prisma.webhookDelivery.update).mockResolvedValue({} as never);
  });

  it("rejects requests with an invalid signature", async () => {
    const response = await POST(webhookRequest({ signature: "sha256=deadbeef" }));
    expect(response.status).toBe(401);
    expect(prisma.webhookDelivery.create).not.toHaveBeenCalled();
  });

  it("drops a replay of the same payload inside the replay window", async () => {
    vi.mocked(prisma.webhookDelivery.findFirst).mockResolvedValueOnce({ id: "w-old" } as never);
    const response = await POST(webhookRequest({ deliveryId: "delivery-brand-new" }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { duplicate: boolean } };
    expect(body.data.duplicate).toBe(true);
    expect(prisma.webhookDelivery.create).not.toHaveBeenCalled();
  });

  it("accepts a fresh delivery", async () => {
    const response = await POST(webhookRequest());
    expect(response.status).toBe(200);
    expect(prisma.webhookDelivery.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          deliveryId: "delivery-1",
          payloadHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        }),
      }),
    );
  });

  it("answers duplicate for an exact deliveryId retry", async () => {
    vi.mocked(prisma.webhookDelivery.create).mockRejectedValueOnce(
      new Error("Unique constraint failed"),
    );
    const response = await POST(webhookRequest());
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { duplicate: boolean } };
    expect(body.data.duplicate).toBe(true);
  });
});
