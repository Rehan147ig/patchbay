import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GraphNodeKind } from "@patchbay/domain";
import { extractGraph, type GraphExtraction } from "./graph";
import { contractConsumersFromExtraction } from "./consumers";

function fixtureDir(name: string): string {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../fixtures/repositories",
    name,
  );
}

function syntheticExtraction(): GraphExtraction {
  const evidence = {
    filePath: "src/a.ts",
    startLine: 3,
    endLine: null as number | null,
    sourceHash: "ab".repeat(32),
    extractor: "graph-extractor",
    extractorVersion: "1",
  };
  return {
    commitSha: "sha-test",
    rootTreeHash: "rh".repeat(32),
    nodeFacts: [
      {
        key: "dep:openai",
        kind: GraphNodeKind.DEPENDENCY,
        displayName: "openai",
        filePath: null,
        startLine: null,
        endLine: null,
        properties: { resolvedVersion: "4.8.1" },
        contentHash: "cd".repeat(32),
        evidence: [{ ...evidence, filePath: "package.json", startLine: null }],
      },
      {
        key: "dep:express",
        kind: GraphNodeKind.DEPENDENCY,
        displayName: "express",
        filePath: null,
        startLine: null,
        endLine: null,
        properties: {},
        contentHash: "ef".repeat(32),
        evidence: [{ ...evidence, filePath: "package.json", startLine: null }],
      },
      {
        key: "mcp-server:postgres",
        kind: GraphNodeKind.MCP_SERVER,
        displayName: "postgres",
        filePath: ".cursor/mcp.json",
        startLine: null,
        endLine: null,
        properties: { server: "postgres" },
        contentHash: "12".repeat(32),
        evidence: [{ ...evidence, filePath: ".cursor/mcp.json", startLine: null }],
      },
      {
        key: "event-handler:GET:/health",
        kind: GraphNodeKind.EVENT_HANDLER,
        displayName: "GET /health",
        filePath: "src/server.ts",
        startLine: 9,
        endLine: null,
        properties: { method: "GET", path: "/health" },
        contentHash: "34".repeat(32),
        evidence: [{ ...evidence, filePath: "src/server.ts", startLine: 9 }],
      },
    ],
    edgeFacts: [],
    errors: [],
  };
}

describe("contractConsumersFromExtraction", () => {
  it("maps SDK deps, MCP servers, and handlers with pinned-commit evidence", () => {
    const consumers = contractConsumersFromExtraction({
      extraction: syntheticExtraction(),
      sdkKinds: new Map([["openai", "SDK"]]),
    });
    expect(consumers).toEqual([
      {
        contractKind: "MCP",
        identifier: "postgres",
        versionRange: null,
        confidence: 90,
        evidenceJson: expect.objectContaining({
          commitSha: "sha-test",
          filePath: ".cursor/mcp.json",
          extractorVersion: "1",
        }),
      },
      {
        contractKind: "SDK",
        identifier: "openai",
        versionRange: "4.8.1",
        confidence: 95,
        evidenceJson: expect.objectContaining({ commitSha: "sha-test" }),
      },
      {
        contractKind: "WEBHOOK",
        identifier: "GET /health",
        versionRange: null,
        confidence: 80,
        evidenceJson: expect.objectContaining({ filePath: "src/server.ts", startLine: 9 }),
      },
    ]);
  });

  it("ignores non-contract dependencies (frameworks are not contracts)", () => {
    const consumers = contractConsumersFromExtraction({
      extraction: syntheticExtraction(),
      sdkKinds: new Map(),
    });
    expect(consumers.map((consumer) => consumer.identifier)).toEqual(["postgres", "GET /health"]);
  });

  it("derives consumers end to end from the mcp-agent fixture extraction", async () => {
    const extraction = await extractGraph({
      rootDir: fixtureDir("mcp-agent-legacy"),
      trackPackages: ["express", "@modelcontextprotocol/sdk"],
    });
    const consumers = contractConsumersFromExtraction({
      extraction,
      sdkKinds: new Map([
        ["express", "SDK"],
        ["@modelcontextprotocol/sdk", "SDK"],
      ]),
    });
    const identifiers = consumers.map(
      (consumer) => `${consumer.contractKind}:${consumer.identifier}`,
    );
    expect(identifiers).toContain("MCP:github");
    expect(identifiers).toContain("MCP:postgres");
    expect(identifiers).toContain("WEBHOOK:GET /health");
    expect(identifiers).toContain("SDK:@modelcontextprotocol/sdk");
    for (const consumer of consumers) {
      expect(consumer.evidenceJson.commitSha).toBe(extraction.commitSha);
      expect(consumer.evidenceJson.sourceHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});
