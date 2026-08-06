import { describe, expect, it, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import { POST } from "./route";
import { hashAgentKey } from "@/lib/agent-keys";

const validKey = "pb_agent_test_key";
const storedHash = hashAgentKey(validKey);

vi.mock("@patchbay/db", () => ({
  prisma: {
    vendor: { findUnique: vi.fn() },
    vendorChangeEvent: { create: vi.fn() },
    normalizedChange: { create: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
}));

vi.mock("@patchbay/queue", () => ({
  JobType: { ANALYZE_CHANGE: "ANALYZE_CHANGE" },
  queue: { add: vi.fn() },
}));

import { prisma } from "@patchbay/db";
import { queue } from "@patchbay/queue";

const openAiPayload = {
  sdk: "openai",
  fromVersion: "3.x",
  toVersion: "4.x",
  migration: {
    methodRenames: [{ from: "openai.createChatCompletion", to: "openai.chat.completions.create" }],
  },
};

function request(body: unknown, key: string | null): NextRequest {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (key !== null) headers.Authorization = `Bearer ${key}`;
  return new Request("http://localhost/api/vendors/openai/events", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  }) as NextRequest;
}

const mockVendor = {
  id: "v-openai",
  slug: "openai",
  name: "OpenAI",
  organizationId: "org-acme",
  agentKeyHash: storedHash,
};

describe("POST /api/vendors/[slug]/events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.vendor.findUnique).mockResolvedValue(mockVendor as never);
    vi.mocked(prisma.vendorChangeEvent.create).mockResolvedValue({
      id: "c-agent-1",
      title: "OpenAI agent change: METHOD_RENAMED",
    } as never);
    vi.mocked(prisma.normalizedChange.create).mockResolvedValue({} as never);
  });

  it("ingests a signed agent event, normalizes it, and enqueues analysis", async () => {
    const response = await POST(request({ rawPayload: openAiPayload }, validKey), {
      params: Promise.resolve({ slug: "openai" }),
    });
    expect(response.status).toBe(201);

    const body = (await response.json()) as { data: { changeEventId: string } };
    expect(body.data.changeEventId).toBe("c-agent-1");
    expect(prisma.vendorChangeEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sourceType: "SDK_RELEASE",
          rawPayload: openAiPayload,
        }),
      }),
    );
    expect(prisma.normalizedChange.create).toHaveBeenCalledTimes(2);
    expect(queue.add).toHaveBeenCalledWith("ANALYZE_CHANGE", {
      changeEventId: "c-agent-1",
      organizationId: "org-acme",
      correlationId: expect.any(String),
    });
  });

  it("rejects requests without a key", async () => {
    const response = await POST(request(openAiPayload, null), {
      params: Promise.resolve({ slug: "openai" }),
    });
    expect(response.status).toBe(401);
    expect(prisma.vendorChangeEvent.create).not.toHaveBeenCalled();
  });

  it("rejects an invalid key", async () => {
    const response = await POST(request(openAiPayload, "pb_agent_wrong"), {
      params: Promise.resolve({ slug: "openai" }),
    });
    expect(response.status).toBe(401);
    expect(prisma.vendorChangeEvent.create).not.toHaveBeenCalled();
  });

  it("rejects vendors without agent mode enabled", async () => {
    vi.mocked(prisma.vendor.findUnique).mockResolvedValueOnce({
      ...mockVendor,
      agentKeyHash: null,
    } as never);
    const response = await POST(request(openAiPayload, validKey), {
      params: Promise.resolve({ slug: "openai" }),
    });
    expect(response.status).toBe(401);
  });

  it("returns 404 for unknown vendors", async () => {
    vi.mocked(prisma.vendor.findUnique).mockResolvedValueOnce(null);
    const response = await POST(request(openAiPayload, validKey), {
      params: Promise.resolve({ slug: "openai" }),
    });
    expect(response.status).toBe(404);
  });

  it("returns 422 when the connector cannot normalize the payload", async () => {
    const response = await POST(request({ rawPayload: { sdk: "stripe" } }, validKey), {
      params: Promise.resolve({ slug: "openai" }),
    });
    expect(response.status).toBe(422);
    expect(prisma.vendorChangeEvent.create).not.toHaveBeenCalled();
  });
});
