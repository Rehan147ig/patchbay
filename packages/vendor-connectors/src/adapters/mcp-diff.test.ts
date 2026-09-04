import { describe, expect, it } from "vitest";
import { diffMcpTools, isPrivilegedTool, type McpToolDefinition } from "./mcp-diff";

function tool(name: string, overrides: Partial<McpToolDefinition> = {}): McpToolDefinition {
  return {
    name,
    description: `${name} tool`,
    inputSchema: { type: "object", properties: {}, required: [] },
    ...overrides,
  };
}

const QUERY = tool("query_database", {
  description: "Run a read query",
  inputSchema: {
    type: "object",
    properties: { sql: { type: "string" }, limit: { type: "number" } },
    required: ["sql"],
  },
});

describe("isPrivilegedTool", () => {
  it("flags destructive names and descriptions", () => {
    expect(isPrivilegedTool("drop_table")).toBe(true);
    expect(isPrivilegedTool("query", "Deletes rows on match")).toBe(true);
    expect(isPrivilegedTool("query_database", "Run a read query")).toBe(false);
  });
});

describe("diffMcpTools", () => {
  it("returns no facts for identical snapshots", () => {
    expect(diffMcpTools("postgres", [QUERY], [QUERY])).toEqual([]);
  });

  it("emits TOOL_REMOVED for deleted tools", () => {
    const facts = diffMcpTools("postgres", [QUERY], []);
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({
      type: "TOOL_REMOVED",
      toolName: "query_database",
      targetSymbol: "postgres:query_database",
      isSecuritySensitive: false,
    });
  });

  it("pairs identical schemas as TOOL_RENAMED, not remove+add", () => {
    const renamed = tool("run_query", {
      description: "Run a read query",
      inputSchema: QUERY.inputSchema,
    });
    const facts = diffMcpTools("postgres", [QUERY], [renamed]);
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({
      type: "TOOL_RENAMED",
      targetSymbol: "postgres:query_database",
      replacementSymbol: "postgres:run_query",
    });
  });

  it("flags newly added privileged tools", () => {
    const drop = tool("drop_table", {
      description: "Drop a table permanently",
      inputSchema: {
        type: "object",
        properties: { table: { type: "string" } },
        required: ["table"],
      },
    });
    const facts = diffMcpTools("postgres", [QUERY], [QUERY, drop]);
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({
      type: "PRIVILEGED_TOOL_ADDED",
      targetSymbol: "postgres:drop_table",
      isSecuritySensitive: true,
    });
  });

  it("stays silent on benign additions", () => {
    const stats = tool("table_stats", {
      inputSchema: {
        type: "object",
        properties: { table: { type: "string" } },
        required: [],
      },
    });
    expect(diffMcpTools("postgres", [QUERY], [QUERY, stats])).toEqual([]);
  });

  it("emits PARAM_REMOVED, PARAM_RENAMED, and PARAM_REQUIRED_ADDED", () => {
    const next = tool("query_database", {
      description: "Run a read query",
      inputSchema: {
        type: "object",
        // limit removed outright; sql renamed to statement (same shape);
        // timeout added as required.
        properties: {
          statement: { type: "string" },
          timeout: { type: "number" },
        },
        required: ["statement", "timeout"],
      },
    });
    // Make limit non-pairable: different shape from anything added.
    const prev = tool("query_database", {
      description: "Run a read query",
      inputSchema: {
        type: "object",
        properties: { sql: { type: "string" }, limit: { type: "boolean" } },
        required: ["sql"],
      },
    });
    const facts = diffMcpTools("postgres", [prev], [next]);
    const types = facts.map((f) => f.type).sort();
    expect(types).toEqual(["PARAM_REMOVED", "PARAM_RENAMED", "PARAM_REQUIRED_ADDED"]);
    const renamed = facts.find((f) => f.type === "PARAM_RENAMED")!;
    expect(renamed.replacementSymbol).toBe("postgres:query_database:statement");
  });

  it("flags optional-to-required flips", () => {
    const prev = tool("query_database", {
      inputSchema: {
        type: "object",
        properties: { sql: { type: "string" } },
        required: [],
      },
    });
    const next = tool("query_database", {
      inputSchema: {
        type: "object",
        properties: { sql: { type: "string" } },
        required: ["sql"],
      },
    });
    const facts = diffMcpTools("postgres", [prev], [next]);
    expect(facts).toHaveLength(1);
    expect(facts[0]?.type).toBe("PARAM_REQUIRED_ADDED");
  });
});
