import { describe, expect, it, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import { POST } from "./route";
import { hashAgentKey } from "@/lib/agent-keys";

const validKey = "pb_agent_test_key";

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

function request(
  body: unknown,
  key: string | null,
  extraHeaders: Record<string, string> = {},
): NextRequest {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...extraHeaders };
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
  agentKeyHash: undefined as string | null | undefined,
  agentKeyHashPrevious: null as string | null,
};

describe("POST /api/vendors/[slug]/events", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockVendor.agentKeyHash = await hashAgentKey(validKey);
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

  it("rejects a NaN Content-Length header as a bad request", async () => {
    const response = await POST(request(openAiPayload, validKey, { "content-length": "abc" }), {
      params: Promise.resolve({ slug: "openai" }),
    });
    expect(response.status).toBe(400);
    expect(prisma.vendorChangeEvent.create).not.toHaveBeenCalled();
  });

  it("rejects a negative Content-Length header", async () => {
    const response = await POST(request(openAiPayload, validKey, { "content-length": "-7" }), {
      params: Promise.resolve({ slug: "openai" }),
    });
    expect(response.status).toBe(400);
    expect(prisma.vendorChangeEvent.create).not.toHaveBeenCalled();
  });

  it("rejects a Content-Length that is a valid integer but over the limit", async () => {
    const response = await POST(request(openAiPayload, validKey, { "content-length": "999999" }), {
      params: Promise.resolve({ slug: "openai" }),
    });
    expect(response.status).toBe(413);
    expect(prisma.vendorChangeEvent.create).not.toHaveBeenCalled();
  });

  it("caps the actual streamed body even when Content-Length lies", async () => {
    const oversized = { rawPayload: { sdk: "openai", blob: "x".repeat(300 * 1024) } };
    const response = await POST(request(oversized, validKey, { "content-length": "5" }), {
      params: Promise.resolve({ slug: "openai" }),
    });
    expect(response.status).toBe(413);
    expect(prisma.vendorChangeEvent.create).not.toHaveBeenCalled();
  });

  it("caps the streamed body when Content-Length is absent", async () => {
    const oversized = { rawPayload: { sdk: "openai", blob: "x".repeat(300 * 1024) } };
    const response = await POST(request(oversized, validKey), {
      params: Promise.resolve({ slug: "openai" }),
    });
    expect(response.status).toBe(413);
    expect(prisma.vendorChangeEvent.create).not.toHaveBeenCalled();
  });

  it("accepts the previous key during the rotation window", async () => {
    const previousKey = "pb_agent_old_key";
    mockVendor.agentKeyHash = await hashAgentKey("pb_agent_new_key");
    mockVendor.agentKeyHashPrevious = await hashAgentKey(previousKey);
    const response = await POST(request({ rawPayload: openAiPayload }, previousKey), {
      params: Promise.resolve({ slug: "openai" }),
    });
    expect(response.status).toBe(201);
    expect(prisma.vendorChangeEvent.create).toHaveBeenCalled();
  });
});
