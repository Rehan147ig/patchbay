import { createHmac } from "node:crypto";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import { POST, repositoryExternalIds } from "./route";

vi.mock("@patchbay/db", () => ({
  prisma: {
    webhookDelivery: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    pullRequest: { findFirst: vi.fn(), update: vi.fn() },
    repository: { findMany: vi.fn() },
    graphIndexJob: { create: vi.fn() },
    gitHubInstallation: { updateMany: vi.fn(), findUnique: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
}));

vi.mock("@patchbay/queue", () => ({
  JobType: { GRAPH_INDEX: "GRAPH_INDEX" },
  enqueue: vi.fn(),
}));

import { prisma } from "@patchbay/db";
import { enqueue } from "@patchbay/queue";

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
  overrides: { body?: string; deliveryId?: string; signature?: string; event?: string } = {},
): NextRequest {
  const headers: Record<string, string> = {
    "x-github-delivery": overrides.deliveryId ?? "delivery-1",
    "x-github-event": overrides.event ?? "pull_request",
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

  it("drops a replay of the same payload even under a brand-new delivery id", async () => {
    // Atomic dedupe: the unique payloadHash constraint rejects the insert —
    // no racy find-then-create window exists anymore.
    vi.mocked(prisma.webhookDelivery.create).mockRejectedValueOnce(
      new Error("Unique constraint failed on the fields: `payloadHash`"),
    );
    const response = await POST(webhookRequest({ deliveryId: "delivery-brand-new" }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { duplicate: boolean } };
    expect(body.data.duplicate).toBe(true);
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

describe("repositoryExternalIds", () => {
  it("matches the canonical bare id and the legacy prefixed form", () => {
    expect(repositoryExternalIds(12345)).toEqual(["12345", "github:12345"]);
  });
});

describe("push webhooks", () => {
  const pushBody = JSON.stringify({
    repository: { id: 12345 },
    ref: "refs/heads/main",
    after: "sha-abc",
    commits: [{ modified: ["src/a.ts"], added: ["src/b.ts"], removed: [] }],
  });

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GITHUB_APP_WEBHOOK_SECRET = SECRET;
    vi.mocked(prisma.webhookDelivery.create).mockResolvedValue({
      id: "w-1",
      deliveryId: "delivery-push",
      event: "push",
      payloadHash: "h",
      status: "RECEIVED",
      receivedAt: new Date(),
    } as never);
    vi.mocked(prisma.webhookDelivery.update).mockResolvedValue({} as never);
  });

  function pushRequest(deliveryId = "delivery-push-1"): NextRequest {
    return webhookRequest({ body: pushBody, deliveryId, event: "push", signature: sign(pushBody) });
  }

  it("enqueues incremental graph indexing matching both externalId formats", async () => {
    vi.mocked(prisma.repository.findMany).mockResolvedValue([
      { id: "repo-1", organizationId: "org-acme", name: "billing-service" },
    ] as never);
    vi.mocked(prisma.graphIndexJob.create).mockResolvedValue({ id: "job-1" } as never);

    const response = await POST(pushRequest());
    expect(response.status).toBe(200);
    expect(prisma.repository.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { externalId: { in: ["12345", "github:12345"] } },
      }),
    );
    expect(prisma.graphIndexJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ repositoryId: "repo-1", mode: "INCREMENTAL" }),
      }),
    );
    expect(enqueue).toHaveBeenCalledWith(
      "GRAPH_INDEX",
      expect.objectContaining({ repositoryId: "repo-1", mode: "INCREMENTAL" }),
    );
  });

  it("ignores pushes for unconnected repositories without enqueueing", async () => {
    vi.mocked(prisma.repository.findMany).mockResolvedValue([]);
    const response = await POST(pushRequest("delivery-push-2"));
    expect(response.status).toBe(200);
    expect(prisma.graphIndexJob.create).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });
});
