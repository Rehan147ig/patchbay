import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeRepository } from "./analyzer";
import { findMcpSdkPackages, isMcpClientConfigPath, parseMcpClientConfig } from "./mcp";

describe("isMcpClientConfigPath", () => {
  it("recognizes cursor, claude, and generic config locations", () => {
    expect(isMcpClientConfigPath(".cursor/mcp.json")).toBe("cursor");
    expect(isMcpClientConfigPath("packages/app/.cursor/mcp.json")).toBe("cursor");
    expect(isMcpClientConfigPath("claude_desktop_config.json")).toBe("claude");
    expect(isMcpClientConfigPath("nested/dir/claude_desktop_config.json")).toBe("claude");
    expect(isMcpClientConfigPath("mcp.json")).toBe("generic");
    expect(isMcpClientConfigPath(".vscode/mcp.json")).toBe("generic");
    expect(isMcpClientConfigPath("src/mcp.json")).toBeNull();
    expect(isMcpClientConfigPath("package.json")).toBeNull();
  });
});

describe("parseMcpClientConfig", () => {
  it("extracts sorted server names from cursor configs", () => {
    const parsed = parseMcpClientConfig(
      ".cursor/mcp.json",
      JSON.stringify({ mcpServers: { postgres: { command: "x" }, github: { command: "y" } } }),
    );
    expect(parsed).toEqual({
      path: ".cursor/mcp.json",
      source: "cursor",
      servers: ["github", "postgres"],
    });
  });

  it("returns null for non-configs, bad JSON, and missing maps", () => {
    expect(parseMcpClientConfig("package.json", "{}")).toBeNull();
    expect(parseMcpClientConfig(".cursor/mcp.json", "not json")).toBeNull();
    expect(parseMcpClientConfig(".cursor/mcp.json", JSON.stringify({}))).toBeNull();
  });
});

describe("findMcpSdkPackages", () => {
  it("collects @modelcontextprotocol packages from manifests and lockfiles", () => {
    expect(
      findMcpSdkPackages([{ "@modelcontextprotocol/sdk": "^1.0.0", lodash: "^4.0.0" }], {
        "@modelcontextprotocol/client": "1.2.0",
        react: "18.0.0",
      }),
    ).toEqual(["@modelcontextprotocol/client", "@modelcontextprotocol/sdk"]);
    expect(findMcpSdkPackages([{}], {})).toEqual([]);
  });
});

describe("analyzeRepository MCP discovery", () => {
  it("invents mcpConfigs and mcpSdkPackages from a real directory", async () => {
    const dir = mkdtempSync(join(tmpdir(), "patchbay-mcp-"));
    mkdirSync(join(dir, ".cursor"), { recursive: true });
    writeFileSync(
      join(dir, ".cursor", "mcp.json"),
      JSON.stringify({ mcpServers: { postgres: { command: "mcp-server-postgres" } } }),
    );
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        name: "agent-app",
        dependencies: { "@modelcontextprotocol/sdk": "^1.0.0" },
      }),
    );

    const analysis = await analyzeRepository({ rootDir: dir, trackPackages: [] });
    expect(analysis.mcpConfigs).toEqual([
      { path: ".cursor/mcp.json", source: "cursor", servers: ["postgres"] },
    ]);
    expect(analysis.mcpSdkPackages).toEqual(["@modelcontextprotocol/sdk"]);
  });
});
