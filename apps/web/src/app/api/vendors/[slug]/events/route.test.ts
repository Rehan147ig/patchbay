import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@patchbay/db", () => ({
  prisma: {
    vendor: { findUnique: vi.fn() },
    vendorChangeEvent: { findFirst: vi.fn(), create: vi.fn() },
    normalizedChange: { create: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
}));

vi.mock("@patchbay/vendor-connectors", () => ({
  getConnector: vi.fn(),
}));

vi.mock("@patchbay/queue", () => ({
  JobType: { ANALYZE_CHANGE: "ANALYZE_CHANGE" },
  enqueue: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkGlobalRateLimit: vi.fn(),
  checkRateLimit: vi.fn(),
}));

import { prisma } from "@patchbay/db";
import { enqueue } from "@patchbay/queue";
import { getConnector } from "@patchbay/vendor-connectors";
import { checkGlobalRateLimit, checkRateLimit } from "@/lib/rate-limit";
import { hashAgentKey } from "@/lib/agent-keys";
import { POST } from "./route";

const AGENT_KEY = "pb_agent_test_private_ingest";
const AGENT_HASH = await hashAgentKey(AGENT_KEY);

function post(slug: string, body: unknown, key: string | null = AGENT_KEY): Promise<Response> {
  return POST(
    new Request(`http://localhost/api/vendors/${slug}/events`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(key ? { authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify(body),
    }) as NextRequest,
    { params: Promise.resolve({ slug }) },
  );
}

const privateVendor = {
  id: "v-priv",
  slug: "jpmc-auth-sdk",
  name: "JPMC Auth SDK",
  enabled: true,
  organizationId: "org-acme",
  agentKeyHash: AGENT_HASH,
  agentKeyHashPrevious: null,
};

const ingestPayload = {
  sourceType: "SDK_RELEASE",
  severity: "HIGH",
  externalReference: "ref-priv-1",
  rawPayload: { description: "v2.0 removes legacy authenticate() entry point" },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(checkGlobalRateLimit).mockResolvedValue({ allowed: true, retryAfterMs: 0 });
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, retryAfterMs: 0 });
  vi.mocked(prisma.vendorChangeEvent.create).mockResolvedValue({
    id: "evt-1",
    title: "t",
  } as never);
  vi.mocked(prisma.normalizedChange.create).mockResolvedValue({ id: "nc-1" } as never);
});

describe("POST /api/vendors/[slug]/events — private vendor generic ASSESS ingest", () => {
  beforeEach(() => {
    vi.mocked(prisma.vendor.findUnique).mockResolvedValue(privateVendor as never);
    vi.mocked(getConnector).mockReturnValue(null);
  });

  it("accepts an agent event for an org-bound slug with no catalog connector and queues ASSESS analysis", async () => {
    const response = await post("jpmc-auth-sdk", ingestPayload);

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      data: { changeEventId: string; status: string; normalizations: number };
    };
    expect(body.data).toMatchObject({
      changeEventId: "evt-1",
      status: "QUEUED",
      normalizations: 1,
    });
  });

  it("stores the generic ASSESS change scoped to the owning organization", async () => {
    await post("jpmc-auth-sdk", ingestPayload);

    expect(prisma.vendorChangeEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          vendorId: "v-priv",
          organizationId: "org-acme",
          sourceType: "SDK_RELEASE",
          severity: "HIGH",
          title: "JPMC Auth SDK private change: SDK_RELEASE",
          status: "DETECTED",
        }),
      }),
    );
    // HIGH severity → breaking=true, description lifted from rawPayload.
    expect(prisma.normalizedChange.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          changeEventId: "evt-1",
          breaking: true,
          description: "v2.0 removes legacy authenticate() entry point",
        }),
      }),
    );
  });

  it("enqueues ANALYZE_CHANGE for the owning organization", async () => {
    await post("jpmc-auth-sdk", ingestPayload);

    expect(enqueue).toHaveBeenCalledWith(
      "ANALYZE_CHANGE",
      expect.objectContaining({ changeEventId: "evt-1", organizationId: "org-acme" }),
    );
  });
});

describe("POST /api/vendors/[slug]/events — shared catalog slugs cannot use the generic path", () => {
  it("rejects a shared catalog vendor with no organization binding before any write", async () => {
    vi.mocked(prisma.vendor.findUnique).mockResolvedValue({
      id: "v-shared",
      slug: "brand-new-vendor",
      name: "Brand New Vendor",
      enabled: true,
      organizationId: null,
      agentKeyHash: null,
      agentKeyHashPrevious: null,
    } as never);
    vi.mocked(getConnector).mockReturnValue(null);

    const response = await post("brand-new-vendor", ingestPayload);

    // Agent mode was never enabled (no claim, no key): auth fails before the
    // connector lookup, so the request can never reach the generic path.
    expect(response.status).toBe(401);
    expect(prisma.vendorChangeEvent.create).not.toHaveBeenCalled();
    expect(prisma.normalizedChange.create).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("still normalizes through the connector for a claimed slug that has one", async () => {
    vi.mocked(prisma.vendor.findUnique).mockResolvedValue({
      ...privateVendor,
      slug: "openai",
      name: "OpenAI",
    } as never);
    vi.mocked(getConnector).mockReturnValue({
      normalizeChange: vi.fn().mockReturnValue([
        {
          changeType: "SDK_VERSION_UPGRADE",
          oldValue: "3.x",
          newValue: "4.x",
          breaking: true,
          affectedSymbols: ["openai.createChatCompletion"],
        },
      ]),
    } as never);

    const response = await post("openai", ingestPayload);

    expect(response.status).toBe(201);
    expect(prisma.vendorChangeEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: "org-acme",
          title: "OpenAI agent change: SDK_VERSION_UPGRADE",
        }),
      }),
    );
    expect(prisma.normalizedChange.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          oldValue: "3.x",
          newValue: "4.x",
        }),
      }),
    );
  });
});
