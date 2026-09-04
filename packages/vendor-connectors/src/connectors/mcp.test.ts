import { describe, expect, it } from "vitest";
import { getCapability } from "../capabilities";
import { getConnector } from "../registry";
import { isMcpDiffPayload, mcpGenericConnector, MCP_GENERIC_SLUG } from "./mcp";

const RENAME_PAYLOAD = {
  source: "MCP_DIFF",
  server: "postgres",
  before: [
    {
      name: "query_database",
      description: "Run a read query",
      inputSchema: {
        type: "object",
        properties: { sql: { type: "string" } },
        required: ["sql"],
      },
    },
  ],
  after: [
    {
      name: "run_query",
      description: "Run a read query",
      inputSchema: {
        type: "object",
        properties: { sql: { type: "string" } },
        required: ["sql"],
      },
    },
  ],
};

describe("mcp-generic connector", () => {
  it("is registered under its own slug", () => {
    expect(MCP_GENERIC_SLUG).toBe("mcp-generic");
    expect(getConnector("mcp-generic")).toBe(mcpGenericConnector);
  });

  it("supports MCP diff payloads and rejects everything else", () => {
    expect(mcpGenericConnector.supports(RENAME_PAYLOAD)).toBe(true);
    expect(mcpGenericConnector.supports({ ...RENAME_PAYLOAD, vendor: "mcp-generic" })).toBe(true);
    expect(mcpGenericConnector.supports({ ...RENAME_PAYLOAD, server: "" })).toBe(false);
    expect(mcpGenericConnector.supports({ ...RENAME_PAYLOAD, before: "nope" })).toBe(false);
    expect(mcpGenericConnector.supports({ sdk: "stripe" })).toBe(false);
    expect(isMcpDiffPayload(RENAME_PAYLOAD)).toBe(true);
  });

  it("normalizes a tool rename into a breaking METHOD_RENAMED draft", () => {
    const drafts = mcpGenericConnector.normalizeChange({
      rawPayload: RENAME_PAYLOAD,
      sourceType: "MCP_DIFF",
    });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      changeType: "METHOD_RENAMED",
      oldValue: "postgres:query_database",
      newValue: "postgres:run_query",
      breaking: true,
      affectedSymbols: ["postgres:query_database"],
    });
    expect(drafts[0]?.evidence).toMatchObject({
      mcp: true,
      server: "postgres",
      diffType: "TOOL_RENAMED",
    });
  });

  it("normalizes removals and privileged additions as plan-only drafts", () => {
    const drafts = mcpGenericConnector.normalizeChange({
      rawPayload: {
        source: "MCP_DIFF",
        server: "github",
        before: [
          {
            name: "create_issue",
            inputSchema: {
              type: "object",
              properties: { title: { type: "string" } },
              required: ["title"],
            },
          },
        ],
        after: [
          {
            name: "delete_repo",
            description: "Delete a repository permanently",
            inputSchema: {
              type: "object",
              properties: { repo: { type: "string" } },
              required: ["repo"],
            },
          },
        ],
      },
      sourceType: "MCP_DIFF",
    });
    const types = drafts.map((d) => d.changeType).sort();
    expect(types).toEqual(["AUTH_CHANGE", "METHOD_REMOVED"]);
    expect(drafts.every((d) => d.breaking)).toBe(true);
  });

  it("emits patch suggestions only for tool renames", () => {
    const drafts = mcpGenericConnector.normalizeChange({
      rawPayload: RENAME_PAYLOAD,
      sourceType: "MCP_DIFF",
    });
    const suggestions = mcpGenericConnector.buildPatchSuggestions(drafts);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({
      symbol: "postgres:query_database",
      replacement: "postgres:run_query",
      confidence: 90,
    });

    const removalDrafts = mcpGenericConnector.normalizeChange({
      rawPayload: {
        source: "MCP_DIFF",
        server: "postgres",
        before: [{ name: "old_tool", inputSchema: { type: "object" } }],
        after: [],
      },
      sourceType: "MCP_DIFF",
    });
    expect(mcpGenericConnector.buildPatchSuggestions(removalDrafts)).toEqual([]);
  });

  it("holds PLAN capability with the MCP kit", () => {
    const entry = getCapability("mcp-generic");
    expect(entry?.level).toBe("PLAN");
    expect(entry?.rulePackVersion).not.toBeNull();
    expect(entry?.corpus?.status).toBe("ACTIVE");
  });
});
