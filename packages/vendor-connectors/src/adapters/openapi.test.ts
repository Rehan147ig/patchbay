import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpenAPIAdapter, createOpenAPIAdapters } from "./openapi";

const SPEC_V1 = {
  openapi: "3.1.0",
  info: { title: "Stripe API", version: "1.0.0" },
  paths: {
    "/v1/charges": { get: { operationId: "listCharges", responses: { "200": {} } } },
  },
};

const SPEC_V2 = {
  openapi: "3.1.0",
  info: { title: "Stripe API", version: "2.0.0" },
  paths: {
    "/v1/charges": {
      get: {
        operationId: "listCharges",
        responses: { "200": {} },
        parameters: [{ name: "limit", in: "query" }],
      },
    },
    "/v1/payment_intents": {
      post: { operationId: "createPaymentIntent", responses: { "200": {} } },
    },
  },
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", etag: '"spec-1"' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createOpenAPIAdapter", () => {
  it("normalizes a spec into a release", () => {
    const adapter = createOpenAPIAdapter(
      "stripe",
      "https://raw.githubusercontent.com/stripe/openapi/master/openapi/spec3.json",
    );
    const normalized = adapter.normalize({
      vendorSlug: "stripe",
      spec: SPEC_V1,
      contentHash: "hash",
    });
    expect(normalized.version).toBe("1.0.0");
    expect(normalized.source).toBe("OPENAPI");
    expect(normalized.metadata).toMatchObject({ specTitle: "Stripe API", specVersion: "3.1.0" });
  });

  it("rejects unsupported input", () => {
    const adapter = createOpenAPIAdapter("stripe", "https://example.com/spec.json");
    expect(() => adapter.normalize({ vendorSlug: "stripe" })).toThrow(/not supported/);
  });

  it("emits evidence with apiDiff facts on first change", async () => {
    const adapter = createOpenAPIAdapter(
      "stripe",
      "https://raw.githubusercontent.com/stripe/openapi/master/openapi/spec3.json",
    );
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(SPEC_V1));
    vi.stubGlobal("fetch", fetchMock);

    const first = await adapter.fetch();
    expect(first.evidence).toHaveLength(1);
    expect(first.evidence[0]!.metadata).not.toHaveProperty("apiDiff"); // no basis to diff yet
    expect(first.cursor).toMatchObject({ etag: '"spec-1"', lastContentHash: expect.any(String) });

    fetchMock.mockResolvedValueOnce(jsonResponse(SPEC_V2));
    const second = await adapter.fetch(first.cursor);
    expect(second.evidence).toHaveLength(1);
    const diff = (second.evidence[0]!.metadata as Record<string, unknown>).apiDiff as {
      specBefore: string;
      specAfter: string;
      addedOperations: string[];
      breaking: boolean;
    };
    expect(diff.specBefore).toBe("1.0.0");
    expect(diff.specAfter).toBe("2.0.0");
    expect(diff.addedOperations).toContain("POST /v1/payment_intents");
    expect(diff.breaking).toBe(true);
  });

  it("returns empty when the spec content hash is unchanged", async () => {
    const adapter = createOpenAPIAdapter(
      "stripe",
      "https://raw.githubusercontent.com/stripe/openapi/master/openapi/spec3.json",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(SPEC_V1))),
    );

    const first = await adapter.fetch();
    const second = await adapter.fetch(first.cursor);
    expect(second.evidence).toEqual([]);
  });

  it("short-circuits on 304 via If-None-Match", async () => {
    const adapter = createOpenAPIAdapter(
      "stripe",
      "https://raw.githubusercontent.com/stripe/openapi/master/openapi/spec3.json",
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 304, headers: { etag: '"spec-1"' } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await adapter.fetch({ etag: '"spec-1"' });
    expect(result.evidence).toEqual([]);
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://raw.githubusercontent.com/stripe/openapi/master/openapi/spec3.json"),
      expect.objectContaining({
        headers: expect.objectContaining({ "If-None-Match": '"spec-1"' }),
      }),
    );
  });

  it("parses YAML specs for .yaml URLs", async () => {
    const adapter = createOpenAPIAdapter(
      "openai",
      "https://raw.githubusercontent.com/openai/openai-openapi/HEAD/openapi.yaml",
    );
    const yamlBody = [
      "openapi: 3.1.0",
      "info:",
      "  title: OpenAI API",
      "  version: 2.0.0",
      "paths: {}",
      "",
    ].join("\n");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(yamlBody, {
          status: 200,
          headers: { "content-type": "application/yaml", etag: '"yaml-1"' },
        }),
      ),
    );
    const result = await adapter.fetch();
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]!.version).toBe("2.0.0");
    expect(result.evidence[0]!.metadata).toMatchObject({ specTitle: "OpenAI API" });
  });

  it("rejects unparsable spec bodies loudly instead of emitting empty evidence", async () => {
    const adapter = createOpenAPIAdapter(
      "openai",
      "https://raw.githubusercontent.com/openai/openai-openapi/HEAD/openapi.yaml",
    );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not: [valid", { status: 200 })));
    await expect(adapter.fetch()).rejects.toThrow(/not parseable as YAML/);
  });

  it("attaches webhookDiff facts when event payloads change", async () => {
    const adapter = createOpenAPIAdapter(
      "stripe",
      "https://raw.githubusercontent.com/stripe/openapi/master/openapi/spec3.json",
    );
    const payloadOf = (usage: unknown) => ({
      openapi: "3.1.0",
      info: { title: "Stripe API", version: "1.0.0" },
      paths: {},
      webhooks: {
        "invoice.paid": {
          post: {
            requestBody: { content: { "application/json": { schema: usage } } },
            responses: { "202": {} },
          },
        },
      },
    });
    const v1 = payloadOf({ type: "object", properties: { id: { type: "string" } } });
    const v2 = payloadOf({
      type: "object",
      properties: { id: { type: "string" }, extra: { type: "string" } },
    });
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(v1));
    vi.stubGlobal("fetch", fetchMock);
    const first = await adapter.fetch();
    expect(first.evidence[0]!.metadata).not.toHaveProperty("webhookDiff");

    fetchMock.mockResolvedValueOnce(jsonResponse(v2));
    const second = await adapter.fetch(first.cursor);
    const webhookDiff = (second.evidence[0]!.metadata as Record<string, unknown>)
      .webhookDiff as Array<{ eventType: string; addedFields: string[]; breaking: boolean }>;
    expect(webhookDiff).toHaveLength(1);
    expect(webhookDiff[0]).toMatchObject({
      eventType: "invoice.paid",
      addedFields: ["extra"],
      breaking: false,
    });
  });

  it("fails closed for spec URLs outside the trust-profile path pins", async () => {
    const adapter = createOpenAPIAdapter(
      "evil",
      "https://raw.githubusercontent.com/evil-org/evil-repo/HEAD/spec.json",
    );
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const error = await adapter.fetch().then(
      () => null,
      (caught: unknown) => caught,
    );
    expect((error as { reason?: string }).reason).toBe("domain_not_allowed");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("registers exactly the stripe, github, and openai webhook-capable sources", () => {
    const slugs = createOpenAPIAdapters()
      .map((adapter) => adapter.slug)
      .sort();
    expect(slugs).toEqual(["openapi:github", "openapi:openai", "openapi:stripe"]);
  });

  it("tolerates a legacy cursor written before lastSpec existed", async () => {
    // Regression: persisted cursors from older adapter versions must never
    // crash a poll; unknown fields normalize to safe empties.
    const adapter = createOpenAPIAdapter(
      "stripe",
      "https://raw.githubusercontent.com/stripe/openapi/master/openapi/spec3.json",
    );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(SPEC_V2)));

    const result = await adapter.fetch({ etag: '"legacy"' } as never);
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]!.metadata).not.toHaveProperty("apiDiff");
  });
});
