import { describe, expect, it } from "vitest";
import { GraphNodeKind } from "@patchbay/domain";
import { type GraphExtraction } from "./graph";
import { contractConsumersFromExtraction } from "./consumers";

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
  it("maps SDK dependencies and handlers with pinned-commit evidence", () => {
    const consumers = contractConsumersFromExtraction({
      extraction: syntheticExtraction(),
      sdkKinds: new Map([["openai", "SDK"]]),
    });
    expect(consumers).toEqual([
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
    expect(consumers.map((consumer) => consumer.identifier)).toEqual(["GET /health"]);
  });
});
