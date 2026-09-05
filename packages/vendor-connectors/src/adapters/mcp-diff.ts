/**
 * Deterministic MCP tool-contract diff. Pure functions, no network, no DB.
 *
 * Compares two `tools/list` snapshots from an MCP server and emits stable
 * facts about what changed, so agent-facing breakage (renamed tools,
 * rejected -32602 params, silently added privileged tools) is classifiable
 * without an LLM.
 */

export interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

export type McpDiffType =
  | "TOOL_REMOVED"
  | "TOOL_RENAMED"
  | "PARAM_REMOVED"
  | "PARAM_RENAMED"
  | "PARAM_REQUIRED_ADDED"
  | "PRIVILEGED_TOOL_ADDED";

export interface McpDiffFact {
  type: McpDiffType;
  toolName: string;
  /** "server:tool", e.g. "postgres:query_database". */
  targetSymbol: string;
  replacementSymbol?: string;
  description: string;
  /** True when the tool name/description matches the destructive regex. */
  isSecuritySensitive: boolean;
}

/**
 * Stems that indicate destructive or privilege-granting actions.
 * Never auto-merge tools matching these.
 *
 * Negative lookaheads prevent false positives on common non-destructive terms:
 * - `grant(?!ed|ee|_type)`: matches `grant`, `grant_role`, `granting`, but excludes
 *   read-only past-participle `granted` (e.g. `is_granted`, `get_granted_scopes`),
 *   `grantee`, and OAuth `grant_type`.
 * - `drop(?!down|box)`: matches `drop_table`, `drop_db`, but excludes UI `dropdown`
 *   and storage `dropbox`.
 * - `wipe|wiping`: matches destructive wipes, but excludes developer `wip` (work in progress).
 */
const DESTRUCTIVE_STEMS = [
  "drop(?!down|box)",
  "delet",
  "remov",
  "destroy",
  "truncat",
  "revok",
  "terminat",
  "kill",
  "shutdown",
  "wipe|wiping",
  "purg",
  "uninstall",
  "grant(?!ed|ee|_type)",
  "chmod",
  "execut",
].join("|");

const DESTRUCTIVE_PATTERN = new RegExp(`(^|[^a-z])(${DESTRUCTIVE_STEMS})[a-z]*([^a-z]|$)`, "i");

export function isPrivilegedTool(name: string, description?: string): boolean {
  return DESTRUCTIVE_PATTERN.test(name) || DESTRUCTIVE_PATTERN.test(description ?? "");
}

/** Shape fingerprint of one input-schema property (minus descriptions/examples). */
function fingerprintProperty(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(fingerprintProperty).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const parts: string[] = [];
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (key === "description" || key === "examples" || key === "default") continue;
      parts.push(`${key}:${fingerprintProperty(entry)}`);
    }
    return `{${parts.sort().join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function fingerprintSchema(inputSchema: McpToolDefinition["inputSchema"]): string {
  const properties = inputSchema.properties ?? {};
  const names = Object.keys(properties).sort();
  const shapes = names.map((name) => `${name}=${fingerprintProperty(properties[name])}`);
  const required = [...(inputSchema.required ?? [])].sort();
  return `props{${shapes.join(",")}} required[${required.join(",")}]`;
}

function propertiesOf(tool: McpToolDefinition): Record<string, unknown> {
  const properties = tool.inputSchema.properties;
  return typeof properties === "object" && properties !== null ? properties : {};
}

function requiredOf(tool: McpToolDefinition): string[] {
  return Array.isArray(tool.inputSchema.required)
    ? tool.inputSchema.required.filter((r): r is string => typeof r === "string")
    : [];
}

export interface McpDiffOptions {
  /** Similarity gate for rename pairing (reserved; renames pair on identical fingerprints). */
  renameStrict?: boolean;
}

/**
 * Diffs two tool snapshots from one MCP server. Deterministic output order:
 * removals/renames first (sorted), then per-tool param facts (sorted).
 * Non-privileged additions are intentionally silent (backwards compatible).
 */
export function diffMcpTools(
  server: string,
  before: McpToolDefinition[],
  after: McpToolDefinition[],
  _options: McpDiffOptions = {},
): McpDiffFact[] {
  const symbol = (toolName: string): string => `${server}:${toolName}`;
  const beforeByName = new Map(before.map((tool) => [tool.name, tool]));
  const afterByName = new Map(after.map((tool) => [tool.name, tool]));

  const removed = before.filter((tool) => !afterByName.has(tool.name));
  const added = after.filter((tool) => !beforeByName.has(tool.name));

  const facts: McpDiffFact[] = [];

  // Rename pairing: a removed tool whose schema fingerprint exactly matches an
  // added tool is a rename, not a remove+add. Pair deterministically.
  const addedByFingerprint = new Map<string, McpToolDefinition[]>();
  for (const tool of added) {
    const key = fingerprintSchema(tool.inputSchema);
    const list = addedByFingerprint.get(key) ?? [];
    list.push(tool);
    addedByFingerprint.set(key, list);
  }
  const consumedAdded = new Set<string>();
  const renamed: Array<{ from: McpToolDefinition; to: McpToolDefinition }> = [];
  const trulyRemoved: McpToolDefinition[] = [];
  for (const tool of [...removed].sort((a, b) => a.name.localeCompare(b.name))) {
    const candidates = (addedByFingerprint.get(fingerprintSchema(tool.inputSchema)) ?? []).filter(
      (candidate) => !consumedAdded.has(candidate.name),
    );
    if (candidates.length === 1) {
      consumedAdded.add(candidates[0]!.name);
      renamed.push({ from: tool, to: candidates[0]! });
    } else {
      trulyRemoved.push(tool);
    }
  }

  for (const { from, to } of renamed) {
    facts.push({
      type: "TOOL_RENAMED",
      toolName: from.name,
      targetSymbol: symbol(from.name),
      replacementSymbol: symbol(to.name),
      description: `MCP tool ${symbol(from.name)} renamed to ${symbol(to.name)} (identical input schema).`,
      isSecuritySensitive: isPrivilegedTool(to.name, to.description),
    });
  }
  for (const tool of trulyRemoved) {
    facts.push({
      type: "TOOL_REMOVED",
      toolName: tool.name,
      targetSymbol: symbol(tool.name),
      description: `MCP tool ${symbol(tool.name)} was removed; agent calls fail.`,
      isSecuritySensitive: isPrivilegedTool(tool.name, tool.description),
    });
  }

  for (const tool of [...added]
    .filter((candidate) => !consumedAdded.has(candidate.name))
    .sort((a, b) => a.name.localeCompare(b.name))) {
    if (!isPrivilegedTool(tool.name, tool.description)) continue;
    facts.push({
      type: "PRIVILEGED_TOOL_ADDED",
      toolName: tool.name,
      targetSymbol: symbol(tool.name),
      description: `New privileged MCP tool ${symbol(tool.name)}: review agent permissions before enabling.`,
      isSecuritySensitive: true,
    });
  }

  // Per-tool parameter facts for tools present in both snapshots.
  const common = before
    .filter((tool) => afterByName.has(tool.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const oldTool of common) {
    const newTool = afterByName.get(oldTool.name)!;
    const oldProps = propertiesOf(oldTool);
    const newProps = propertiesOf(newTool);
    const oldRequired = new Set(requiredOf(oldTool));
    const newRequired = new Set(requiredOf(newTool));

    const removedParams = Object.keys(oldProps)
      .filter((name) => !(name in newProps))
      .sort();
    const addedParams = Object.keys(newProps)
      .filter((name) => !(name in oldProps))
      .sort();

    // Param rename pairing: removed + added with identical shape fingerprints.
    const addedByShape = new Map<string, string[]>();
    for (const name of addedParams) {
      const key = fingerprintProperty(newProps[name]);
      const list = addedByShape.get(key) ?? [];
      list.push(name);
      addedByShape.set(key, list);
    }
    const consumedParams = new Set<string>();
    for (const oldName of removedParams) {
      const key = fingerprintProperty(oldProps[oldName]);
      const candidates = (addedByShape.get(key) ?? []).filter((n) => !consumedParams.has(n));
      if (candidates.length === 1) {
        consumedParams.add(candidates[0]!);
        facts.push({
          type: "PARAM_RENAMED",
          toolName: oldTool.name,
          targetSymbol: symbol(oldTool.name),
          replacementSymbol: `${symbol(oldTool.name)}:${candidates[0]}`,
          description: `Parameter ${oldName} of ${symbol(oldTool.name)} renamed to ${candidates[0]} (identical shape); -32602 on old calls.`,
          isSecuritySensitive: isPrivilegedTool(oldTool.name, oldTool.description),
        });
      } else {
        facts.push({
          type: "PARAM_REMOVED",
          toolName: oldTool.name,
          targetSymbol: symbol(oldTool.name),
          description: `Parameter ${oldName} removed from ${symbol(oldTool.name)}; callers passing it fail.`,
          isSecuritySensitive: isPrivilegedTool(oldTool.name, oldTool.description),
        });
      }
    }

    for (const name of addedParams) {
      if (consumedParams.has(name)) continue;
      if (!newRequired.has(name)) continue;
      facts.push({
        type: "PARAM_REQUIRED_ADDED",
        toolName: oldTool.name,
        targetSymbol: symbol(oldTool.name),
        description: `New required parameter ${name} on ${symbol(oldTool.name)}; existing calls reject with -32602.`,
        isSecuritySensitive: isPrivilegedTool(oldTool.name, oldTool.description),
      });
    }

    // Optional -> required flip for params that already existed.
    for (const name of [...newRequired].sort()) {
      if (oldRequired.has(name)) continue;
      if (!(name in oldProps)) continue; // brand-new param: emitted above.
      facts.push({
        type: "PARAM_REQUIRED_ADDED",
        toolName: oldTool.name,
        targetSymbol: symbol(oldTool.name),
        description: `Parameter ${name} of ${symbol(oldTool.name)} became required; existing calls reject with -32602.`,
        isSecuritySensitive: isPrivilegedTool(oldTool.name, oldTool.description),
      });
    }
  }

  return facts;
}
