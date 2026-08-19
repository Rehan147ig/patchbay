import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { unauthorized } from "@patchbay/domain";
import { POST } from "./route";

vi.mock("@patchbay/db", () => ({
  prisma: {
    vendor: { findUnique: vi.fn() },
    vendorChangeEvent: { upsert: vi.fn() },
  },
}));

vi.mock("@patchbay/queue", () => ({
  enqueue: vi.fn(),
  JobType: { ANALYZE_CHANGE: "analyze-change" },
}));

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn(),
}));

vi.mock("@/lib/csrf-server", () => ({
  assertCsrfToken: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...original,
    writeAuditEvent: vi.fn(),
  };
});

import { prisma } from "@patchbay/db";
import { enqueue, JobType } from "@patchbay/queue";
import { requireRole } from "@/lib/auth";
import { assertCsrfToken } from "@/lib/csrf-server";

const demoUser = { id: "u-member", organizationId: "org-acme", role: "MEMBER" };

function post(body: unknown, headers: Record<string, string> = {}) {
  return POST(
    new NextRequest("http://localhost/api/demo/run", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/demo/run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireRole).mockResolvedValue(demoUser as never);
    vi.mocked(assertCsrfToken).mockReturnValue(undefined);
  });

  it("runs the openai-migration scenario (happy path)", async () => {
    vi.mocked(prisma.vendor.findUnique).mockResolvedValue({
      id: "v-openai",
      slug: "openai",
      name: "OpenAI",
    } as never);
    vi.mocked(prisma.vendorChangeEvent.upsert).mockResolvedValue({
      id: "c-openai-sdk-v4-org-acme",
      organizationId: "org-acme",
    } as never);

    const response = await post({ scenario: "openai-migration" });
    expect(response.status).toBe(202);

    const json = (await response.json()) as { data: { changeEventId: string; status: string } };
    expect(json.data.changeEventId).toBe("c-openai-sdk-v4-org-acme");
    expect(json.data.status).toBe("QUEUED");

    expect(enqueue).toHaveBeenCalledWith(JobType.ANALYZE_CHANGE, {
      changeEventId: "c-openai-sdk-v4-org-acme",
      organizationId: "org-acme",
      correlationId: expect.any(String),
    });
  });

  it("runs the auth0-config scenario (policy-gated approval)", async () => {
    vi.mocked(prisma.vendor.findUnique).mockResolvedValue({
      id: "v-auth0",
      slug: "auth0",
      name: "Auth0",
    } as never);
    vi.mocked(prisma.vendorChangeEvent.upsert).mockResolvedValue({
      id: "c-auth0-config-org-acme",
      organizationId: "org-acme",
    } as never);

    const response = await post({ scenario: "auth0-config" });
    expect(response.status).toBe(202);

    const json = (await response.json()) as { data: { changeEventId: string; status: string } };
    expect(json.data.changeEventId).toBe("c-auth0-config-org-acme");
    expect(json.data.status).toBe("QUEUED");

    expect(enqueue).toHaveBeenCalledWith(JobType.ANALYZE_CHANGE, {
      changeEventId: "c-auth0-config-org-acme",
      organizationId: "org-acme",
      correlationId: expect.any(String),
    });
  });

  it("runs the openapi-response-field scenario (plan-only)", async () => {
    vi.mocked(prisma.vendor.findUnique).mockResolvedValue({
      id: "v-generic",
      slug: "generic-openapi",
      name: "Generic OpenAPI",
    } as never);
    vi.mocked(prisma.vendorChangeEvent.upsert).mockResolvedValue({
      id: "c-openapi-field-org-acme",
      organizationId: "org-acme",
    } as never);

    const response = await post({ scenario: "openapi-response-field" });
    expect(response.status).toBe(202);

    const json = (await response.json()) as { data: { changeEventId: string; status: string } };
    expect(json.data.changeEventId).toBe("c-openapi-field-org-acme");
    expect(json.data.status).toBe("QUEUED");

    expect(enqueue).toHaveBeenCalledWith(JobType.ANALYZE_CHANGE, {
      changeEventId: "c-openapi-field-org-acme",
      organizationId: "org-acme",
      correlationId: expect.any(String),
    });
  });

  it("runs the stripe-metadata scenario (approval-then-PR)", async () => {
    vi.mocked(prisma.vendor.findUnique).mockResolvedValue({
      id: "v-stripe",
      slug: "stripe",
      name: "Stripe",
    } as never);
    vi.mocked(prisma.vendorChangeEvent.upsert).mockResolvedValue({
      id: "c-stripe-metadata-org-acme",
      organizationId: "org-acme",
    } as never);

    const response = await post({ scenario: "stripe-metadata" });
    expect(response.status).toBe(202);

    const json = (await response.json()) as { data: { changeEventId: string; status: string } };
    expect(json.data.changeEventId).toBe("c-stripe-metadata-org-acme");
    expect(json.data.status).toBe("QUEUED");

    expect(prisma.vendorChangeEvent.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          vendorId: "v-stripe",
          sourceType: "SDK_RELEASE",
          rawPayload: expect.objectContaining({ sdk: "stripe", demo: true }),
        }),
        update: expect.objectContaining({
          rawPayload: expect.objectContaining({ sdk: "stripe", demo: true }),
        }),
      }),
    );

    expect(enqueue).toHaveBeenCalledWith(JobType.ANALYZE_CHANGE, {
      changeEventId: "c-stripe-metadata-org-acme",
      organizationId: "org-acme",
      correlationId: expect.any(String),
    });
  });

  it("runs the anthropic-completions scenario", async () => {
    vi.mocked(prisma.vendor.findUnique).mockResolvedValue({
      id: "v-anthropic",
      slug: "anthropic",
      name: "Anthropic",
    } as never);
    vi.mocked(prisma.vendorChangeEvent.upsert).mockResolvedValue({
      id: "c-anthropic-completions-org-acme",
      organizationId: "org-acme",
    } as never);

    const response = await post({ scenario: "anthropic-completions" });
    expect(response.status).toBe(202);
    const json = (await response.json()) as { data: { changeEventId: string } };
    expect(json.data.changeEventId).toBe("c-anthropic-completions-org-acme");
    expect(prisma.vendorChangeEvent.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          vendorId: "v-anthropic",
          rawPayload: expect.objectContaining({ sdk: "anthropic", demo: true }),
        }),
      }),
    );
  });

  it("rejects an invalid or unknown scenario", async () => {
    const response = await post({ scenario: "invalid-scenario" });
    expect(response.status).toBe(422);
  });

  it("enforces authentication (requires MEMBER role)", async () => {
    vi.mocked(requireRole).mockRejectedValue(unauthorized());
    const response = await post({ scenario: "openai-migration" });
    expect(response.status).toBe(401);
  });
});
