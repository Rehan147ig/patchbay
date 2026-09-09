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

describe("diffWebhookPayloads", () => {
  it("detects nested additions and breaking removals", () => {
    const before = {
      webhooks: {
        invoice: {
          post: {
            requestBody: {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: { type: "object", properties: { customer_id: { type: "string" } } },
                      id: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };
    const after = structuredClone(before) as unknown as Record<string, unknown>;
    const webhooks = after.webhooks as Record<string, unknown>;
    const invoice = webhooks.invoice as Record<string, unknown>;
    const post = invoice.post as Record<string, unknown>;
    const body = post.requestBody as Record<string, unknown>;
    const content = body.content as Record<string, unknown>;
    const mediaType = content["application/json"] as Record<string, unknown>;
    const schema = mediaType.schema as Record<string, unknown>;
    const properties = schema.properties as Record<string, Record<string, unknown>>;
    const dataProp = properties.data as Record<string, unknown>;
    const dataProperties = dataProp.properties as Record<string, unknown>;
    delete dataProperties.customer_id;
    dataProperties.customer = { type: "string" };
    properties.amount = { type: "number" };
    expect(diffWebhookPayloads(before, after)).toEqual([
      {
        eventType: "invoice",
        addedFields: ["amount", "data.customer"],
        removedFields: ["data.customer_id"],
        renamedFields: [],
        breaking: true,
      },
    ]);
  });
});
