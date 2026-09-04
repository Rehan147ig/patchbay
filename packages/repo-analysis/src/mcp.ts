/**
 * MCP client-configuration discovery (repo inventory plane).
 *
 * Finds agent client configs that pin MCP servers (`.cursor/mcp.json`,
 * `claude_desktop_config.json`, root/`.vscode` `mcp.json`) and records which
 * servers each repository wires up, plus any `@modelcontextprotocol/*`
 * packages in manifests/lockfiles. Pure functions; the analyzer wires them
 * into RepositoryAnalysis so Watchtower can later diff those servers'
 * `tools/list` snapshots and the blast radar can attribute agent breakage.
 */

export type McpConfigSource = "cursor" | "claude" | "generic";

export interface McpClientConfig {
  /** Repo-relative path, posix separators. */
  path: string;
  source: McpConfigSource;
  /** Server names from the config's `mcpServers` map (sorted). */
  servers: string[];
}

/** MCP SDK package scope: imports and lockfile entries under it mark agent repos. */
export const MCP_SDK_SCOPE = "@modelcontextprotocol/";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * True when a repo-relative path is an MCP client config. Cursor configs live
 * under `.cursor/`; Claude Desktop uses `claude_desktop_config.json`
 * anywhere; bare `mcp.json` counts at the root or under `.vscode/`.
 */
export function isMcpClientConfigPath(relPath: string): McpConfigSource | null {
  const normalized = relPath.replace(/\\/g, "/");
  if (/(^|\/)\.cursor\/mcp\.json$/.test(normalized)) return "cursor";
  const base = normalized.split("/").pop() ?? "";
  if (base === "claude_desktop_config.json") return "claude";
  if (base === "mcp.json") {
    const dir = normalized.slice(0, -"/mcp.json".length);
    if (dir === "" || dir === ".vscode" || dir.endsWith("/.vscode")) return "generic";
  }
  return null;
}

/**
 * Parses one client config's raw JSON. Returns null when the file is not
 * valid JSON or carries no `mcpServers` map (caller records an analysis
 * error instead of crashing the scan).
 */
export function parseMcpClientConfig(relPath: string, raw: string): McpClientConfig | null {
  const source = isMcpClientConfigPath(relPath);
  if (!source) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const servers = parsed.mcpServers;
  if (!isRecord(servers)) return null;
  return {
    path: relPath,
    source,
    servers: Object.keys(servers).sort(),
  };
}

/**
 * `@modelcontextprotocol/*` packages across manifests and lockfile versions
 * (sorted, deduplicated). Marks repositories whose agents import the MCP SDK.
 */
export function findMcpSdkPackages(
  manifestDeps: Array<Record<string, string>>,
  lockfileVersions: Record<string, string>,
): string[] {
  const found = new Set<string>();
  for (const deps of manifestDeps) {
    for (const name of Object.keys(deps ?? {})) {
      if (name === "@modelcontextprotocol/sdk" || name.startsWith(MCP_SDK_SCOPE)) {
        found.add(name);
      }
    }
  }
  for (const name of Object.keys(lockfileVersions ?? {})) {
    if (name === "@modelcontextprotocol/sdk" || name.startsWith(MCP_SDK_SCOPE)) {
      found.add(name);
    }
  }
  return [...found].sort();
}
