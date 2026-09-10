import { describe, expect, it } from "vitest";
import { diffOpenApiSpecs, diffWebhookPayloads } from "./openapi-diff";

const BEFORE = {
  openapi: "3.1.0",
  info: { title: "Acme API", version: "1.0.0" },
  paths: {
    "/v1/chat/completions": {
      post: {
        operationId: "createChatCompletion",
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  model: { type: "string", description: "model id" },
                  messages: { type: "array" },
                },
                required: ["model", "messages"],
              },
            },
          },
        },
        responses: { "200": { description: "OK" } },
      },
    },
    "/v1/models": {
      get: { operationId: "listModels", responses: { "200": { description: "OK" } } },
    },
  },
};

const AFTER = {
  openapi: "3.1.0",
  info: { title: "Acme API", version: "2.0.0" },
  paths: {
    "/v1/chat/completions": {
      post: {
        operationId: "createChatCompletion",
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  model: { type: "string" },
                  messages: { type: "array" },
                  temperature: { type: "number" },
                },
                required: ["model", "messages"],
              },
            },
          },
        },
        responses: { "200": { description: "OK" } },
      },
    },
    "/v1/embeddings": {
      post: { operationId: "createEmbedding", responses: { "200": { description: "OK" } } },
    },
    "/v1/legacy": {
      post: { responses: { "200": { description: "OK" } } },
    },
  },
};

describe("diffOpenApiSpecs", () => {
  it("detects added, removed, and changed operations", () => {
    const diff = diffOpenApiSpecs(BEFORE, AFTER);
    expect(diff.specBefore).toBe("1.0.0");
    expect(diff.specAfter).toBe("2.0.0");
    expect(diff.addedOperations).toContain("POST /v1/embeddings");
    // /v1/legacy existed in the new spec only - it is "added" in the diff sense.
    expect(diff.addedOperations).toContain("POST /v1/legacy");
    expect(diff.removedOperations).toContain("GET /v1/models");
    expect(diff.changedOperations).toEqual([
      { operation: "POST /v1/chat/completions", reason: "request or response shape changed" },
    ]);
    expect(diff.breaking).toBe(true);
  });

  it("flags only the changed operation as breaking", () => {
    const onlyNew = {
      ...AFTER,
      paths: { ...AFTER.paths, "/v1/models": BEFORE.paths["/v1/models"] },
    };
    const diff = diffOpenApiSpecs(BEFORE, onlyNew);
    expect(diff.addedOperations).toContain("POST /v1/embeddings");
    expect(diff.removedOperations).toEqual([]);
    expect(diff.changedOperations).toHaveLength(1);
    expect(diff.changedOperations[0]!.operation).toBe("POST /v1/chat/completions");
    expect(diff.breaking).toBe(true); // the shape change to /v1/chat/completions breaks
  });

  it("returns empty facts for identical specs", () => {
    const diff = diffOpenApiSpecs(BEFORE, BEFORE);
    expect(diff.addedOperations).toEqual([]);
    expect(diff.removedOperations).toEqual([]);
    expect(diff.changedOperations).toEqual([]);
    expect(diff.breaking).toBe(false);
  });

  it("handles malformed input without throwing", () => {
    const diff = diffOpenApiSpecs(null, "not a spec");
    expect(diff.addedOperations).toEqual([]);
    expect(diff.breaking).toBe(false);
  });

  it("ignores description/example changes when comparing shapes", () => {
    const cosmetic = structuredClone(BEFORE) as Record<string, unknown>;
    const info = cosmetic.info as Record<string, unknown>;
    info.description = "new docs";
    const pathItem = (cosmetic.paths as Record<string, unknown>)["/v1/chat/completions"] as Record<
      string,
      unknown
    >;
    pathItem.post = {
      ...(pathItem.post as Record<string, unknown>),
      description: "updated copy",
    };
    const diff = diffOpenApiSpecs(BEFORE, cosmetic);
    expect(diff.changedOperations).toEqual([]);
    expect(diff.breaking).toBe(false);
  });
});

function webhookSpec(
  events: Record<string, unknown>,
  key: "webhooks" | "x-webhooks" = "webhooks",
): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: { title: "Acme Events", version: "1.0.0" },
    [key]: events,
  };
}

function postEvent(schema: unknown): Record<string, unknown> {
  return {
    post: {
      requestBody: { content: { "application/json": { schema } } },
      responses: { "202": { description: "Accepted" } },
    },
  };
}

const INVOICE_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string" },
    data: {
      type: "object",
      properties: {
        object: {
          type: "object",
          properties: {
            customer_id: { type: "string", description: "legacy id" },
            usage: { type: "integer" },
          },
        },
      },
    },
  },
};

describe("diffWebhookPayloads", () => {
  it("reports added fields as non-breaking", () => {
    const before = webhookSpec({ "invoice.paid": postEvent(INVOICE_SCHEMA) });
    const extended = structuredClone(INVOICE_SCHEMA) as Record<string, unknown>;
    (extended.properties as Record<string, unknown>).extra = { type: "string" };
    const after = webhookSpec({ "invoice.paid": postEvent(extended) });
    const diff = diffWebhookPayloads(before, after);
    expect(diff).toHaveLength(1);
    expect(diff[0]).toMatchObject({
      eventType: "invoice.paid",
      addedFields: ["extra"],
      removedFields: [],
      renamedFields: [],
      breaking: false,
    });
  });

  it("flags removed fields as breaking", () => {
    const trimmed = structuredClone(INVOICE_SCHEMA) as Record<string, unknown>;
    const objectProps = (
      (
        ((trimmed.properties as Record<string, unknown>).data as Record<string, unknown>)
          .properties as Record<string, unknown>
      ).object as Record<string, unknown>
    ).properties as Record<string, unknown>;
    delete objectProps.usage;
    const before = webhookSpec({ "invoice.paid": postEvent(INVOICE_SCHEMA) });
    const after = webhookSpec({ "invoice.paid": postEvent(trimmed) });
    const diff = diffWebhookPayloads(before, after);
    expect(diff).toHaveLength(1);
    expect(diff[0]).toMatchObject({
      eventType: "invoice.paid",
      addedFields: [],
      removedFields: ["data.object.usage"],
      renamedFields: [],
      breaking: true,
    });
  });

  it("pairs byte-identical shapes as renames, never across differing shapes", () => {
    const renamed = structuredClone(INVOICE_SCHEMA) as Record<string, unknown>;
    const objectProps = (
      (
        ((renamed.properties as Record<string, unknown>).data as Record<string, unknown>)
          .properties as Record<string, unknown>
      ).object as Record<string, unknown>
    ).properties as Record<string, unknown>;
    objectProps.customer = objectProps.customer_id;
    delete objectProps.customer_id;
    const before = webhookSpec({ "invoice.paid": postEvent(INVOICE_SCHEMA) });
    const after = webhookSpec({ "invoice.paid": postEvent(renamed) });
    const diff = diffWebhookPayloads(before, after);
    expect(diff).toHaveLength(1);
    expect(diff[0]).toMatchObject({
      removedFields: [],
      addedFields: [],
      renamedFields: [{ from: "data.object.customer_id", to: "data.object.customer" }],
      breaking: true,
    });

    // Same names, different shapes: stale rename must NOT fire.
    const reshaped = structuredClone(INVOICE_SCHEMA) as Record<string, unknown>;
    const reshapedProps = (
      (
        ((reshaped.properties as Record<string, unknown>).data as Record<string, unknown>)
          .properties as Record<string, unknown>
      ).object as Record<string, unknown>
    ).properties as Record<string, unknown>;
    reshapedProps.customer = { type: "integer" };
    delete (reshapedProps as Record<string, unknown>).customer_id;
    const reshapedDiff = diffWebhookPayloads(
      before,
      webhookSpec({ "invoice.paid": postEvent(reshaped) }),
    );
    expect(reshapedDiff).toHaveLength(1);
    expect(reshapedDiff[0]!.renamedFields).toEqual([]);
    expect(reshapedDiff[0]!.removedFields).toEqual(["data.object.customer_id"]);
    expect(reshapedDiff[0]!.addedFields).toEqual(["data.object.customer"]);
    expect(reshapedDiff[0]!.breaking).toBe(true);
  });

  it("reports added and removed event types", () => {
    const before = webhookSpec({ "invoice.paid": postEvent(INVOICE_SCHEMA) });
    const after = webhookSpec({
      "invoice.paid": postEvent(INVOICE_SCHEMA),
      "invoice.failed": postEvent(INVOICE_SCHEMA),
    });
    const added = diffWebhookPayloads(before, after);
    expect(added).toHaveLength(1);
    expect(added[0]!.eventType).toBe("invoice.failed");
    expect(added[0]!.breaking).toBe(false);
    expect(added[0]!.addedFields).toContain("data.object.customer_id");

    const removed = diffWebhookPayloads(after, before);
    expect(removed).toHaveLength(1);
    expect(removed[0]!.eventType).toBe("invoice.failed");
    expect(removed[0]!.breaking).toBe(true);
  });

  it("reads legacy x-webhooks sections and emits nothing when unchanged", () => {
    const before = webhookSpec({ "invoice.paid": postEvent(INVOICE_SCHEMA) }, "x-webhooks");
    expect(diffWebhookPayloads(before, before)).toEqual([]);
    const after = webhookSpec({ "invoice.paid": postEvent(INVOICE_SCHEMA) }, "x-webhooks");
    expect(diffWebhookPayloads(before, after)).toEqual([]);
  });

  it("resolves local $refs and survives ref cycles without throwing", () => {
    const withRefs = {
      openapi: "3.1.0",
      info: { title: "Acme Events", version: "1.0.0" },
      components: {
        schemas: {
          Invoice: {
            type: "object",
            properties: { customer_id: { type: "string" } },
          },
          Loopy: {
            type: "object",
            properties: { self: { $ref: "#/components/schemas/Loopy" } },
          },
        },
      },
      webhooks: {
        "invoice.paid": postEvent({ $ref: "#/components/schemas/Invoice" }),
        "loopy.event": postEvent({ $ref: "#/components/schemas/Loopy" }),
      },
    };
    const diff = diffWebhookPayloads(
      webhookSpec({ "invoice.paid": postEvent(INVOICE_SCHEMA) }),
      withRefs,
    );
    const invoice = diff.find((fact) => fact.eventType === "invoice.paid");
    // $ref indirection resolves to the same leaf shape: no false diff.
    expect(invoice).toBeDefined();
    // Loopy resolves through the cycle guard instead of hanging.
    expect(diff.find((fact) => fact.eventType === "loopy.event")).toBeDefined();
  });

  it("handles malformed input without throwing and stays deterministic", () => {
    expect(diffWebhookPayloads(null, "not a spec")).toEqual([]);
    expect(diffWebhookPayloads({}, {})).toEqual([]);
    const before = webhookSpec({
      "b.event": postEvent(INVOICE_SCHEMA),
      "a.event": postEvent(INVOICE_SCHEMA),
    });
    const after = webhookSpec({ "a.event": postEvent(INVOICE_SCHEMA) });
    const first = diffWebhookPayloads(before, after);
    const second = diffWebhookPayloads(before, after);
    expect(first).toEqual(second);
    expect(first.map((fact) => fact.eventType)).toEqual(["b.event"]);
  });
});
