import type { NormalizedChangeDraft, PatchSuggestion, VendorConnector } from "../types";
import type { RulePack } from "@patchbay/domain";
import { diffMcpTools, type McpDiffFact, type McpToolDefinition } from "../adapters/mcp-diff";

/**
 * Generic MCP server connector (PLAN track).
 *
 * Consumes deterministic `tools/list` diffs for any MCP server
 * (`@modelcontextprotocol/server-*`) and normalizes them into breaking
 * change drafts. Symbol-level renames yield patch suggestions; removals,
 * param breaks, and privileged additions stay plan-only for human review.
 *
 * Expected raw payload (MCP diff ingestion):
 * ```json
 * {
 *   "source": "MCP_DIFF",
 *   "server": "postgres",
 *   "before": [{ "name": "query", "inputSchema": { "type": "object" } }],
 *   "after": [{ "name": "query_v2", "inputSchema": { "type": "object" } }]
 * }
 * ```
 */

export const MCP_GENERIC_SLUG = "mcp-generic";

interface McpDiffPayload {
  source?: string;
  vendor?: string;
  server?: string;
  before?: McpToolDefinition[];
  after?: McpToolDefinition[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asToolList(value: unknown): McpToolDefinition[] | null {
  if (!Array.isArray(value)) return null;
  const tools: McpToolDefinition[] = [];
  for (const entry of value) {
    if (!isObject(entry)) return null;
    if (typeof entry.name !== "string") return null;
    const schema = entry.inputSchema;
    if (!isObject(schema)) return null;
    tools.push({
      name: entry.name,
      description: typeof entry.description === "string" ? entry.description : undefined,
      inputSchema: {
        type: "object",
        properties:
          isObject(schema.properties) && !Array.isArray(schema.properties)
            ? (schema.properties as Record<string, unknown>)
            : undefined,
        required: Array.isArray(schema.required)
          ? schema.required.filter((r): r is string => typeof r === "string")
          : undefined,
      },
    });
  }
  return tools;
}

export function isMcpDiffPayload(payload: unknown): payload is Required<McpDiffPayload> & {
  before: McpToolDefinition[];
  after: McpToolDefinition[];
} {
  if (!isObject(payload)) return false;
  if (payload.source !== "MCP_DIFF" && payload.vendor !== "mcp-generic") return false;
  if (typeof payload.server !== "string" || payload.server.trim() === "") return false;
  return asToolList(payload.before) !== null && asToolList(payload.after) !== null;
}

function changeTypeFor(fact: McpDiffFact): NormalizedChangeDraft["changeType"] {
  switch (fact.type) {
    case "TOOL_REMOVED":
      return "METHOD_REMOVED";
    case "TOOL_RENAMED":
      return "METHOD_RENAMED";
    case "PARAM_REMOVED":
      return "PARAMETER_REMOVED";
    case "PARAM_RENAMED":
      return "PARAMETER_RENAMED";
    case "PARAM_REQUIRED_ADDED":
      return "PARAMETER_REQUIRED";
    case "PRIVILEGED_TOOL_ADDED":
      return "AUTH_CHANGE";
  }
}

export const mcpGenericConnector: VendorConnector = {
  slug: MCP_GENERIC_SLUG,

  /** WP6 rule-pack declaration (see openai.ts for the contract semantics). */
  rulePack: {
    packVersion: "mcp-diff/1.0.0",
    vendorSlug: MCP_GENERIC_SLUG,
    contractKind: "MCP",
    supportedChanges: [
      "METHOD_REMOVED",
      "METHOD_RENAMED",
      "PARAMETER_REMOVED",
      "PARAMETER_RENAMED",
      "PARAMETER_REQUIRED",
      "AUTH_CHANGE",
    ],
    editBudget: { maxFiles: 10, maxEditsPerFile: 10, maxTotalBytes: 30_000 },
    expectedEvidence: { requiresSourceHash: true, requiresLockfileVersion: false, minUsages: 1 },
    validationProfile: "node-ts-reparse",
    riskTags: [],
    rollback: {
      strategy: "revert-commit",
      instructions: "Revert the Patchbay draft PR branch before merge.",
    },
  } satisfies RulePack,

  supports(rawPayload: unknown): boolean {
    return isMcpDiffPayload(rawPayload);
  },

  normalizeChange(input): NormalizedChangeDraft[] {
    const payload = input.rawPayload;
    if (!isMcpDiffPayload(payload)) return [];
    const before = asToolList(payload.before) ?? [];
    const after = asToolList(payload.after) ?? [];
    const facts = diffMcpTools(payload.server, before, after);
    return facts.map((fact) => ({
      changeType: changeTypeFor(fact),
      oldValue: fact.targetSymbol,
      newValue: fact.replacementSymbol,
      description: fact.description,
      breaking: true,
      affectedSymbols: [fact.targetSymbol],
      evidence: {
        mcp: true,
        server: payload.server,
        diffType: fact.type,
        securitySensitive: fact.isSecuritySensitive,
      },
    }));
  },

  buildPatchSuggestions(normalizations): PatchSuggestion[] {
    const suggestions: PatchSuggestion[] = [];
    for (const normalization of normalizations) {
      if (normalization.changeType !== "METHOD_RENAMED") continue;
      if (!normalization.oldValue || !normalization.newValue) continue;
      if (!normalization.affectedSymbols.includes(normalization.oldValue)) continue;
      suggestions.push({
        symbol: normalization.oldValue,
        replacement: normalization.newValue,
        description: `Rename MCP tool ${normalization.oldValue} to ${normalization.newValue}; verify agent call sites.`,
        confidence: 90,
      });
    }
    return suggestions;
  },
};
