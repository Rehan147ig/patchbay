import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GraphEdgeKind, GraphNodeKind, GraphProvenance } from "@patchbay/domain";
import { extractGraph } from "./graph";
import type { GraphEdgeFact, GraphNodeFact } from "./graph";

const TRACKED = ["stripe", "openai", "twilio", "auth0"];

function fixtureDir(name: string): string {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../fixtures/repositories",
    name,
  );
}

function nodeByKey(nodes: GraphNodeFact[], key: string): GraphNodeFact | undefined {
  return nodes.find((n) => n.key === key);
}

function edgesOf(edges: GraphEdgeFact[], from: string, kind: string, to: string): GraphEdgeFact[] {
  return edges.filter((e) => e.fromKey === from && e.kind === kind && e.toKey === to);
}

describe("extractGraph - openai fixture", () => {
  it("extracts repository, file, module and dependency facts", async () => {
    const graph = await extractGraph({
      rootDir: fixtureDir("openai-node-legacy"),
      trackPackages: TRACKED,
    });

    const repo = nodeByKey(graph.nodeFacts, "repo:root");
    expect(repo?.kind).toBe(GraphNodeKind.REPOSITORY);
    expect(repo?.properties.packageManager).toBe("pnpm");

    const module = nodeByKey(graph.nodeFacts, "module:src/lib/openai-client.ts");
    expect(module?.kind).toBe(GraphNodeKind.MODULE);
    expect(module?.contentHash).toMatch(/^[0-9a-f]{64}$/);

    const dep = nodeByKey(graph.nodeFacts, "dep:openai");
    expect(dep?.kind).toBe(GraphNodeKind.DEPENDENCY);
    expect(dep?.properties.resolvedVersion).toBe("3.3.0");
    expect(dep?.properties.declaredRanges).toContain("package.json@^3.3.0");
  });

  it("extracts client + method-call + usage edges", async () => {
    const graph = await extractGraph({
      rootDir: fixtureDir("openai-node-legacy"),
      trackPackages: TRACKED,
    });

    const client = nodeByKey(graph.nodeFacts, "client:openai:OpenAI");
    expect(client?.kind).toBe(GraphNodeKind.API_CLIENT);
    expect(client?.filePath).toBe("src/lib/openai-client.ts");

    expect(
      edgesOf(
        graph.edgeFacts,
        "module:src/lib/openai-client.ts",
        GraphEdgeKind.CREATES_CLIENT,
        "client:openai:OpenAI",
      ),
    ).toHaveLength(1);

    const api = nodeByKey(graph.nodeFacts, "api:openai:openai.createChatCompletion");
    expect(api?.kind).toBe(GraphNodeKind.API_OPERATION);
    expect(api?.filePath).toBe("src/chat/chat-service.ts");
    expect(
      edgesOf(
        graph.edgeFacts,
        "module:src/chat/chat-service.ts",
        GraphEdgeKind.INVOKES_API,
        "api:openai:openai.createChatCompletion",
      ),
    ).toHaveLength(1);

    expect(
      edgesOf(
        graph.edgeFacts,
        "module:src/chat/chat-service.ts",
        GraphEdgeKind.USES_PACKAGE,
        "dep:openai",
      ).length,
    ).toBeGreaterThan(0);
  });

  it("resolves relative imports between modules", async () => {
    const graph = await extractGraph({
      rootDir: fixtureDir("openai-node-legacy"),
      trackPackages: TRACKED,
    });

    const imports = edgesOf(
      graph.edgeFacts,
      "module:src/chat/chat-service.ts",
      GraphEdgeKind.IMPORTS,
      "module:src/lib/openai-client.ts",
    );
    expect(imports).toHaveLength(1);
    expect(imports[0]?.provenance).toBe(GraphProvenance.RESOLVED);
    expect(imports[0]?.confidence).toBe(95);
    expect(imports[0]?.properties.specifier).toBe("../lib/openai-client");
  });

  it("resolves dependencies to concrete packages from the lockfile", async () => {
    const graph = await extractGraph({
      rootDir: fixtureDir("openai-node-legacy"),
      trackPackages: TRACKED,
    });

    const pkg = nodeByKey(graph.nodeFacts, "pkg:openai@3.3.0");
    expect(pkg?.kind).toBe(GraphNodeKind.PACKAGE);

    const resolves = edgesOf(
      graph.edgeFacts,
      "dep:openai",
      GraphEdgeKind.RESOLVES_TO,
      "pkg:openai@3.3.0",
    );
    expect(resolves).toHaveLength(1);
    expect(resolves[0]?.provenance).toBe(GraphProvenance.RESOLVED);
    expect(resolves[0]?.confidence).toBe(99);
  });

  it("is deterministic across runs", async () => {
    const rootDir = fixtureDir("openai-node-legacy");
    const [a, b] = await Promise.all([
      extractGraph({ rootDir, trackPackages: TRACKED }),
      extractGraph({ rootDir, trackPackages: TRACKED }),
    ]);
    expect(a).toEqual(b);
    expect(a.commitSha).toBeDefined();
    expect(a.rootTreeHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("extractGraph - openai-python-legacy fixture", () => {
  it("emits usage-driven nodes and edges for python call sites", async () => {
    const graph = await extractGraph({
      rootDir: fixtureDir("openai-python-legacy"),
      trackPackages: TRACKED,
    });

    const client = nodeByKey(graph.nodeFacts, "client:openai:OpenAI");
    expect(client?.kind).toBe(GraphNodeKind.API_CLIENT);
    expect(client?.filePath).toBe("src/chat.py");
    expect(
      edgesOf(
        graph.edgeFacts,
        "module:src/chat.py",
        GraphEdgeKind.CREATES_CLIENT,
        "client:openai:OpenAI",
      ),
    ).toHaveLength(1);

    const api = nodeByKey(graph.nodeFacts, "api:openai:client.chat.completions.create");
    expect(api?.kind).toBe(GraphNodeKind.API_OPERATION);
    expect(api?.filePath).toBe("src/chat.py");

    const invokes = edgesOf(
      graph.edgeFacts,
      "module:src/chat.py",
      GraphEdgeKind.INVOKES_API,
      "api:openai:client.chat.completions.create",
    );
    expect(invokes).toHaveLength(1);
    expect(invokes[0]?.provenance).toBe(GraphProvenance.EXTRACTED);
    expect(invokes[0]?.confidence).toBe(100);
    expect(invokes[0]?.evidence[0]?.sourceHash).toMatch(/^[0-9a-f]{64}$/);

    const uses = edgesOf(
      graph.edgeFacts,
      "module:src/chat.py",
      GraphEdgeKind.USES_PACKAGE,
      "dep:openai",
    );
    expect(uses.length).toBeGreaterThan(0);
    expect(uses.every((e) => e.provenance === GraphProvenance.EXTRACTED)).toBe(true);
    expect(uses[0]?.evidence[0]?.sourceHash).toMatch(/^[0-9a-f]{64}$/);

    expect(nodeByKey(graph.nodeFacts, "module:src/chat.py")?.kind).toBe(GraphNodeKind.MODULE);
  });

  it("keeps python containment structural but extracts no python imports", async () => {
    const graph = await extractGraph({
      rootDir: fixtureDir("openai-python-legacy"),
      trackPackages: TRACKED,
    });

    const file = nodeByKey(graph.nodeFacts, "file:src/chat.py");
    expect(file?.kind).toBe(GraphNodeKind.FILE);
    expect(
      edgesOf(graph.edgeFacts, "repo:root", GraphEdgeKind.CONTAINS, "file:src/chat.py"),
    ).toHaveLength(1);

    const moduleImports = graph.edgeFacts.filter(
      (e) => e.fromKey === "module:src/chat.py" && e.kind === GraphEdgeKind.IMPORTS,
    );
    expect(moduleImports).toHaveLength(0);
  });
});

describe("extractGraph - synthetic repo", () => {
  async function writeRepo(files: Record<string, string>): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "patchbay-graph-"));
    for (const [rel, content] of Object.entries(files)) {
      const full = path.join(dir, rel);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, content, "utf8");
    }
    return dir;
  }

  it("detects test modules and test edges", async () => {
    const dir = await writeRepo({
      "package.json": JSON.stringify({ name: "sample", dependencies: { openai: "^3.3.0" } }),
      "src/lib.ts": `import OpenAI from "openai";
export const openai = new OpenAI({ apiKey: "sk-test" });
`,
      "src/lib.test.ts": `import { openai } from "./lib";
it("has a client", () => {
  expect(openai).toBeDefined();
});
`,
      "pnpm-lock.yaml":
        'lockfileVersion: "9.0"\n\nimporters:\n  .:\n    dependencies:\n      openai:\n        specifier: ^3.3.0\n        version: 3.3.0\n',
    });
    try {
      const graph = await extractGraph({ rootDir: dir, trackPackages: TRACKED });

      const test = nodeByKey(graph.nodeFacts, "test:src/lib.test.ts");
      expect(test?.kind).toBe(GraphNodeKind.TEST);

      const tests = edgesOf(
        graph.edgeFacts,
        "module:src/lib.test.ts",
        GraphEdgeKind.TESTS,
        "module:src/lib.ts",
      );
      expect(tests).toHaveLength(1);
      expect(tests[0]?.provenance).toBe(GraphProvenance.INFERRED);
      expect(tests[0]?.confidence).toBe(85);

      expect(
        edgesOf(
          graph.edgeFacts,
          "module:src/lib.ts",
          GraphEdgeKind.EXPORTS,
          "sym:src/lib.ts:openai",
        ),
      ).toHaveLength(1);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("creates dependency nodes for undeclared imports", async () => {
    const dir = await writeRepo({
      "package.json": JSON.stringify({ name: "bare-import" }),
      "src/index.ts": `import stripe from "stripe";
export const client = stripe("sk-test");
`,
    });
    try {
      const graph = await extractGraph({ rootDir: dir, trackPackages: TRACKED });

      const dep = nodeByKey(graph.nodeFacts, "dep:stripe");
      expect(dep?.kind).toBe(GraphNodeKind.DEPENDENCY);
      expect(dep?.properties.declaredRanges).toBe("");
      expect(
        edgesOf(graph.edgeFacts, "module:src/index.ts", GraphEdgeKind.IMPORTS, "dep:stripe"),
      ).toHaveLength(1);
      expect(graph.errors).toEqual([]);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("extractGraph - incremental mode", () => {
  it("re-extracts only the files listed in changedFiles", async () => {
    const rootDir = fixtureDir("openai-node-legacy");
    const graph = await extractGraph({
      rootDir,
      trackPackages: TRACKED,
      changedFiles: new Map([["src/lib/openai-client.ts", ""]]),
    });

    expect(nodeByKey(graph.nodeFacts, "module:src/lib/openai-client.ts")).toBeDefined();
    expect(nodeByKey(graph.nodeFacts, "module:src/chat/chat-service.ts")).toBeUndefined();
    expect(nodeByKey(graph.nodeFacts, "api:openai:openai.createChatCompletion")).toBeUndefined();
    expect(nodeByKey(graph.nodeFacts, "repo:root")).toBeDefined();
  });

  it("matches baseline facts when every file is listed", async () => {
    const rootDir = fixtureDir("openai-node-legacy");
    const baseline = await extractGraph({ rootDir, trackPackages: TRACKED });
    const changedFiles = new Map(
      baseline.nodeFacts
        .filter((n) => n.kind === GraphNodeKind.FILE)
        .map((n) => [n.filePath ?? "", ""] as const),
    );

    const incremental = await extractGraph({ rootDir, trackPackages: TRACKED, changedFiles });

    expect(incremental.nodeFacts.map((n) => n.key).sort()).toEqual(
      baseline.nodeFacts.map((n) => n.key).sort(),
    );
    expect(incremental.edgeFacts.map((e) => e.key).sort()).toEqual(
      baseline.edgeFacts.map((e) => e.key).sort(),
    );
  });
});
