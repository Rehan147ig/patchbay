import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { GraphEdgeKind, GraphNodeKind, GraphProvenance, UsageType } from "@patchbay/domain";
import { analyzeRepository } from "./analyzer";
import type { RepositoryAnalysis } from "./types";
import { collectBindings } from "./ast";
import { collectModuleExports, makeRelativeResolver, resolveRelativeTarget } from "./exports";
import type { AnalysisError, ModuleExports } from "./types";

const EXTRACTOR_NAME = "graph-extractor";
const EXTRACTOR_VERSION = "1";

const TEST_FILE_PATTERN = /\.(test|spec)\.(ts|tsx|js|jsx)$/i;
const LOCKFILES = ["pnpm-lock.yaml", "package-lock.json", "yarn.lock"];

export interface GraphEvidenceFact {
  filePath: string;
  startLine: number | null;
  endLine: number | null;
  sourceHash: string;
  extractor: string;
  extractorVersion: string;
}

export interface GraphNodeFact {
  /** Stable identity within a snapshot (also stored as GraphNode.stableKey). */
  key: string;
  kind: GraphNodeKind;
  displayName: string;
  filePath: string | null;
  startLine: number | null;
  endLine: number | null;
  properties: Record<string, string>;
  /** Content hash of the source file, or a hash over the synthesized fact. */
  contentHash: string;
  evidence: GraphEvidenceFact[];
}

export interface GraphEdgeFact {
  /** `${fromKey}|${kind}|${toKey}` — unique within a snapshot. */
  key: string;
  kind: GraphEdgeKind;
  fromKey: string;
  toKey: string;
  provenance: GraphProvenance;
  confidence: number;
  properties: Record<string, string>;
  evidence: GraphEvidenceFact[];
}

export interface GraphExtraction {
  commitSha: string;
  /** sha256 over (rel, contentHash) pairs of every scanned file, sorted. */
  rootTreeHash: string;
  nodeFacts: GraphNodeFact[];
  edgeFacts: GraphEdgeFact[];
  errors: AnalysisError[];
}

export interface ExtractGraphOptions {
  rootDir: string;
  trackPackages: string[];
  /** Map of relative file paths to their new content hashes (sha256). When provided,
   * only files in this map are re-extracted; unchanged files retain their previous
   * node/edge facts from the prior snapshot (identified by matching contentHash). */
  changedFiles?: Map<string, string>;
  /**
   * Pre-computed analysis for this rootDir + trackPackages (e.g. from a scan
   * job that already ran analyzeRepository). When provided, the duplicate
   * analysis pass is skipped and only file collection + the structural pass
   * run — roughly a 3x end-to-end win on large repos. The caller MUST use the
   * same trackPackages the analysis was built with.
   */
  analysis?: RepositoryAnalysis;
}

/**
 * Deterministic software-intelligence graph extraction of a repository
 * snapshot. Builds on `analyzeRepository` (usages, manifests, lockfile) and a
 * structural pass (imports, exports, tests, content hashes). Same snapshot in,
 * byte-identical facts out — no timestamps, no randomness.
 */
export async function extractGraph(options: ExtractGraphOptions): Promise<GraphExtraction> {
  const { rootDir, trackPackages, changedFiles } = options;
  const analysis = options.analysis ?? (await analyzeRepository({ rootDir, trackPackages }));
  const walked = await collectSources(rootDir);

  // When changedFiles is provided, only re-extract the listed files.
  // The map keys are relative paths (relative to rootDir); values are the new
  // content hashes (sha256) supplied by the caller for bookkeeping. Files not
  // in the map are skipped here — their prior node/edge facts from the
  // previous snapshot are retained by the caller (worker merges by matching
  // contentHash across snapshots).
  const relevantTsFiles = changedFiles
    ? walked.tsFiles.filter((f) => changedFiles.has(f.rel))
    : walked.tsFiles;
  const relevantPyFiles = changedFiles
    ? walked.pyFiles.filter((f) => changedFiles.has(f.rel))
    : walked.pyFiles;

  const nodes = new Map<string, GraphNodeFact>();
  const edges = new Map<string, GraphEdgeFact>();
  const errors: AnalysisError[] = [...analysis.errors];

  /** Content hash of a usage's source file (TS or Python). */
  function sourceHashOf(filePath: string): string {
    return walked.tsHashes.get(filePath) ?? walked.pyHashes.get(filePath) ?? "";
  }

  function addNode(node: GraphNodeFact): void {
    const existing = nodes.get(node.key);
    if (!existing) {
      nodes.set(node.key, node);
      return;
    }
    existing.evidence = mergeEvidence(existing.evidence, node.evidence);
  }

  function addEdge(edge: GraphEdgeFact): void {
    const existing = edges.get(edge.key);
    if (!existing) {
      edges.set(edge.key, edge);
      return;
    }
    existing.evidence = mergeEvidence(existing.evidence, edge.evidence);
  }

  function evidence(
    filePath: string,
    startLine: number | null,
    endLine: number | null,
    sourceHash: string,
  ): GraphEvidenceFact {
    return {
      filePath,
      startLine,
      endLine,
      sourceHash,
      extractor: EXTRACTOR_NAME,
      extractorVersion: EXTRACTOR_VERSION,
    };
  }

  function factHash(key: string, kind: string, properties: Record<string, string>): string {
    return createHash("sha256")
      .update(`${key}|${kind}|${JSON.stringify(properties)}`)
      .digest("hex");
  }

  // -------------------------------------------------------------------------
  // Structural pass: per-module imports, exports, tests, declarations.
  // -------------------------------------------------------------------------

  const tsPaths = new Set(walked.tsFiles.map((f) => f.rel));
  const bindingPasses = (() => {
    let bindingsByFile = new Map<string, Map<string, string>>();
    let exportsByFile = new Map<string, ModuleExports>();

    for (let pass = 0; pass < 3; pass += 1) {
      const resolver = makeRelativeResolver(exportsByFile, tsPaths);
      const nextBindings = new Map<string, Map<string, string>>();
      for (const file of walked.tsFiles) {
        const sourceFile = ts.createSourceFile(
          file.rel,
          file.content,
          ts.ScriptTarget.Latest,
          true,
          ts.ScriptKind.TS,
        );
        const bindings = collectBindings(sourceFile, file.rel, trackSet(), resolver);
        nextBindings.set(
          file.rel,
          new Map([...bindings].map(([name, b]) => [name, b.packageName])),
        );
      }
      bindingsByFile = nextBindings;

      const nextExports = new Map<string, ModuleExports>();
      for (const file of walked.tsFiles) {
        const sourceFile = ts.createSourceFile(
          file.rel,
          file.content,
          ts.ScriptTarget.Latest,
          true,
          ts.ScriptKind.TS,
        );
        nextExports.set(
          file.rel,
          collectModuleExports(sourceFile, bindingsByFile.get(file.rel) ?? new Map()),
        );
      }
      exportsByFile = nextExports;
    }

    return { exportsByFile, bindingsByFile };
  })();
  const { exportsByFile } = bindingPasses;

  function trackSet(): Set<string> {
    return new Set(trackPackages);
  }

  const repositoryName = path.basename(path.resolve(rootDir));
  const primaryManifest = [...analysis.manifests].sort((a, b) => a.path.localeCompare(b.path))[0];

  addNode({
    key: "repo:root",
    kind: GraphNodeKind.REPOSITORY,
    displayName: repositoryName,
    filePath: primaryManifest?.path ?? null,
    startLine: null,
    endLine: null,
    properties: {
      packageManager: analysis.packageManager,
      trackedPackages: trackPackages.join(","),
      typescriptFiles: String(analysis.typescriptFiles),
      manifestCount: String(analysis.manifests.length),
    },
    contentHash: factHash("repo:root", GraphNodeKind.REPOSITORY, {
      packageManager: analysis.packageManager,
      trackedPackages: trackPackages.join(","),
    }),
    evidence: primaryManifest
      ? [
          evidence(
            primaryManifest.path,
            null,
            null,
            walked.jsonHashes.get(primaryManifest.path) ?? "",
          ),
        ]
      : [],
  });

  // Dependency nodes from manifests; declaration evidence per manifest.
  const dependencyEvidence = new Map<string, GraphEvidenceFact[]>();
  const dependencyRanges = new Map<string, Set<string>>();
  const prodDependencies = new Set<string>();
  const devOnlyPaths = new Map<string, Set<string>>();
  for (const manifest of analysis.manifests) {
    const hash = walked.jsonHashes.get(manifest.path) ?? "";
    for (const [pkg, range] of Object.entries(manifest.dependencies)) {
      addToSet(dependencyRanges, pkg, `${manifest.path}@${range}`);
      prodDependencies.add(pkg);
      addToEvidence(dependencyEvidence, pkg, evidence(manifest.path, null, null, hash));
    }
    for (const [pkg, range] of Object.entries(manifest.devDependencies)) {
      addToSet(dependencyRanges, pkg, `${manifest.path}@${range}`);
      addToSet(devOnlyPaths, pkg, manifest.path);
      addToEvidence(dependencyEvidence, pkg, evidence(manifest.path, null, null, hash));
    }
  }

  function addToSet(map: Map<string, Set<string>>, key: string, value: string): void {
    const set = map.get(key);
    if (set) set.add(value);
    else map.set(key, new Set([value]));
  }

  function addToEvidence(
    map: Map<string, GraphEvidenceFact[]>,
    key: string,
    value: GraphEvidenceFact,
  ): void {
    const list = map.get(key);
    if (list) list.push(value);
    else map.set(key, [value]);
  }

  // -------------------------------------------------------------------------
  // Per-file structural extraction.
  // -------------------------------------------------------------------------

  for (const file of relevantTsFiles) {
    const sourceFile = ts.createSourceFile(
      file.rel,
      file.content,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );

    const fileNodeKey = `file:${file.rel}`;
    const moduleNodeKey = `module:${file.rel}`;
    addNode({
      key: fileNodeKey,
      kind: GraphNodeKind.FILE,
      displayName: file.rel,
      filePath: file.rel,
      startLine: 1,
      endLine: file.lineCount,
      properties: {},
      contentHash: file.sourceHash,
      evidence: [evidence(file.rel, 1, file.lineCount, file.sourceHash)],
    });
    addNode({
      key: moduleNodeKey,
      kind: GraphNodeKind.MODULE,
      displayName: file.rel,
      filePath: file.rel,
      startLine: 1,
      endLine: file.lineCount,
      properties: {},
      contentHash: file.sourceHash,
      evidence: [evidence(file.rel, 1, file.lineCount, file.sourceHash)],
    });
    addEdge({
      key: edgeKey("repo:root", GraphEdgeKind.CONTAINS, fileNodeKey),
      kind: GraphEdgeKind.CONTAINS,
      fromKey: "repo:root",
      toKey: fileNodeKey,
      provenance: GraphProvenance.EXTRACTED,
      confidence: 100,
      properties: {},
      evidence: [evidence(file.rel, 1, file.lineCount, file.sourceHash)],
    });
    addEdge({
      key: edgeKey(fileNodeKey, GraphEdgeKind.CONTAINS, moduleNodeKey),
      kind: GraphEdgeKind.CONTAINS,
      fromKey: fileNodeKey,
      toKey: moduleNodeKey,
      provenance: GraphProvenance.EXTRACTED,
      confidence: 100,
      properties: {},
      evidence: [evidence(file.rel, 1, file.lineCount, file.sourceHash)],
    });

    const isTestFile = TEST_FILE_PATTERN.test(file.rel);

    // Imports.
    const relativeImports: Array<{ specifier: string; line: number }> = [];
    const externalImports: Array<{ packageName: string; specifier: string; line: number }> = [];
    const importPositions = new Map<string, number>();

    function position(node: ts.Node): number {
      const lc = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      return lc.line + 1;
    }

    ts.forEachChild(sourceFile, (node) => {
      if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) return;
      const specifier = node.moduleSpecifier.text;
      const line = position(node);
      if (specifier.startsWith("./") || specifier.startsWith("../")) {
        relativeImports.push({ specifier, line });
        importPositions.set(`rel:${specifier}`, line);
      } else {
        const packageName = packageOfSpecifier(specifier);
        externalImports.push({ packageName, specifier, line });
      }
    });

    for (const { specifier, line } of relativeImports) {
      const target = resolveRelativeTarget(file.rel, specifier, tsPaths);
      if (!target) continue;
      const targetModuleKey = `module:${target}`;
      addEdge({
        key: edgeKey(moduleNodeKey, GraphEdgeKind.IMPORTS, targetModuleKey),
        kind: GraphEdgeKind.IMPORTS,
        fromKey: moduleNodeKey,
        toKey: targetModuleKey,
        provenance: GraphProvenance.RESOLVED,
        confidence: 95,
        properties: { specifier },
        evidence: [evidence(file.rel, line, null, file.sourceHash)],
      });
      if (isTestFile) {
        addEdge({
          key: edgeKey(moduleNodeKey, GraphEdgeKind.TESTS, targetModuleKey),
          kind: GraphEdgeKind.TESTS,
          fromKey: moduleNodeKey,
          toKey: targetModuleKey,
          provenance: GraphProvenance.INFERRED,
          confidence: 85,
          properties: {},
          evidence: [evidence(file.rel, line, null, file.sourceHash)],
        });
      }
    }

    for (const { packageName, specifier, line } of externalImports) {
      const depKey = dependencyKey(packageName);
      ensureDependencyNode(packageName, depKey, evidence(file.rel, line, null, file.sourceHash));
      addEdge({
        key: edgeKey(moduleNodeKey, GraphEdgeKind.IMPORTS, depKey),
        kind: GraphEdgeKind.IMPORTS,
        fromKey: moduleNodeKey,
        toKey: depKey,
        provenance: GraphProvenance.EXTRACTED,
        confidence: 100,
        properties: { specifier },
        evidence: [evidence(file.rel, line, null, file.sourceHash)],
      });
    }

    // Event-handler registrations (WP3): conservative Express-style route
    // detection — `app.<method>(path, …)` / `router.<method>(path, …)` /
    // `fastify.<method>(path, …)` / `server.<method>(path, …)` with a
    // string-literal path only. No template literals, no variables, no `use`
    // (middleware, not a route): a missed exotic registration loses a fact,
    // but a wrong one would poison blast-radius and policy inputs. The
    // receiver names are a documented convention, not a proof of framework.
    const expressRoutes = collectRouteRegistrations(sourceFile, position);
    const nextRoutes = collectNextJsRouteHandlers(sourceFile, file.rel, position);
    for (const route of expressRoutes) {
      const handlerKey = `event-handler:${route.method}:${route.path}`;
      addNode({
        key: handlerKey,
        kind: GraphNodeKind.EVENT_HANDLER,
        displayName: `${route.method} ${route.path}`,
        filePath: file.rel,
        startLine: route.line,
        endLine: null,
        properties: { method: route.method, path: route.path, receiver: route.receiver },
        contentHash: factHash(handlerKey, GraphNodeKind.EVENT_HANDLER, {
          method: route.method,
          path: route.path,
        }),
        evidence: [evidence(file.rel, route.line, null, file.sourceHash)],
      });
      addEdge({
        key: edgeKey(moduleNodeKey, GraphEdgeKind.CONTAINS, handlerKey),
        kind: GraphEdgeKind.CONTAINS,
        fromKey: moduleNodeKey,
        toKey: handlerKey,
        provenance: GraphProvenance.EXTRACTED,
        confidence: 90,
        properties: { method: route.method, path: route.path },
        evidence: [evidence(file.rel, route.line, null, file.sourceHash)],
      });
    }

    // Next.js App Router handlers: exported HTTP-method functions in
    // `**/route.ts` files. The path derives from the file location (not a
    // call argument), so confidence stays at the conservative 90 shared with
    // the Express loop above — same EXTRACTED provenance, no stronger claim.
    for (const route of nextRoutes) {
      const handlerKey = `event-handler:${route.method}:${route.path}`;
      addNode({
        key: handlerKey,
        kind: GraphNodeKind.EVENT_HANDLER,
        displayName: `${route.method} ${route.path}`,
        filePath: file.rel,
        startLine: route.line,
        endLine: null,
        properties: { method: route.method, path: route.path, receiver: route.receiver },
        contentHash: factHash(handlerKey, GraphNodeKind.EVENT_HANDLER, {
          method: route.method,
          path: route.path,
        }),
        evidence: [evidence(file.rel, route.line, null, file.sourceHash)],
      });
      addEdge({
        key: edgeKey(moduleNodeKey, GraphEdgeKind.CONTAINS, handlerKey),
        kind: GraphEdgeKind.CONTAINS,
        fromKey: moduleNodeKey,
        toKey: handlerKey,
        provenance: GraphProvenance.EXTRACTED,
        confidence: 90,
        properties: { method: route.method, path: route.path },
        evidence: [evidence(file.rel, route.line, null, file.sourceHash)],
      });
    }

    // Zod webhook payload validators: `z.object` schemas in webhook/event
    // files, gated on a validator-like name or a co-located route in the
    // same file. Same EXTRACTED provenance and conservative 90 confidence
    // as the route loops — a name match is evidence, not proof, of purpose.
    for (const schema of collectZodWebhookSchemas(
      sourceFile,
      file.rel,
      expressRoutes.length + nextRoutes.length > 0,
      position,
    )) {
      const schemaKey = `webhook-schema:${file.rel}:${schema.name}`;
      addNode({
        key: schemaKey,
        kind: GraphNodeKind.WEBHOOK_SCHEMA,
        displayName: schema.name,
        filePath: file.rel,
        startLine: schema.line,
        endLine: null,
        properties: { fields: schema.fields.join(",") },
        contentHash: factHash(schemaKey, GraphNodeKind.WEBHOOK_SCHEMA, {
          fields: schema.fields.join(","),
        }),
        evidence: [evidence(file.rel, schema.line, null, file.sourceHash)],
      });
      addEdge({
        key: edgeKey(moduleNodeKey, GraphEdgeKind.CONTAINS, schemaKey),
        kind: GraphEdgeKind.CONTAINS,
        fromKey: moduleNodeKey,
        toKey: schemaKey,
        provenance: GraphProvenance.EXTRACTED,
        confidence: 90,
        properties: {},
        evidence: [evidence(file.rel, schema.line, null, file.sourceHash)],
      });
    }

    // Tests.
    if (isTestFile || hasTestCall(sourceFile)) {
      const testNodeKey = `test:${file.rel}`;
      addNode({
        key: testNodeKey,
        kind: GraphNodeKind.TEST,
        displayName: file.rel,
        filePath: file.rel,
        startLine: 1,
        endLine: file.lineCount,
        properties: {},
        contentHash: file.sourceHash,
        evidence: [evidence(file.rel, 1, file.lineCount, file.sourceHash)],
      });
      addEdge({
        key: edgeKey(moduleNodeKey, GraphEdgeKind.CONTAINS, testNodeKey),
        kind: GraphEdgeKind.CONTAINS,
        fromKey: moduleNodeKey,
        toKey: testNodeKey,
        provenance: GraphProvenance.EXTRACTED,
        confidence: 100,
        properties: {},
        evidence: [evidence(file.rel, 1, file.lineCount, file.sourceHash)],
      });
    }

    // Export statements that expose tracked bindings.
    const moduleExports = exportsByFile.get(file.rel);
    if (moduleExports) {
      for (const [name, packageName] of moduleExports.named) {
        const symKey = symbolKey(file.rel, name);
        addNode({
          key: symKey,
          kind: GraphNodeKind.SYMBOL,
          displayName: name,
          filePath: file.rel,
          startLine: null,
          endLine: null,
          properties: { packageName, exported: "true" },
          contentHash: factHash(symKey, GraphNodeKind.SYMBOL, { packageName }),
          evidence: [evidence(file.rel, null, null, file.sourceHash)],
        });
        addEdge({
          key: edgeKey(moduleNodeKey, GraphEdgeKind.EXPORTS, symKey),
          kind: GraphEdgeKind.EXPORTS,
          fromKey: moduleNodeKey,
          toKey: symKey,
          provenance: GraphProvenance.EXTRACTED,
          confidence: 100,
          properties: {},
          evidence: [evidence(file.rel, null, null, file.sourceHash)],
        });
      }
    }
  }

  // Python structural pass: containment facts only. Usage-driven nodes and
  // edges for Python call sites come from `analysis.usages` below; no second
  // Python extractor is introduced here.
  for (const file of relevantPyFiles) {
    const fileNodeKey = `file:${file.rel}`;
    const moduleNodeKey = `module:${file.rel}`;
    addNode({
      key: fileNodeKey,
      kind: GraphNodeKind.FILE,
      displayName: file.rel,
      filePath: file.rel,
      startLine: 1,
      endLine: file.lineCount,
      properties: {},
      contentHash: file.sourceHash,
      evidence: [evidence(file.rel, 1, file.lineCount, file.sourceHash)],
    });
    addNode({
      key: moduleNodeKey,
      kind: GraphNodeKind.MODULE,
      displayName: file.rel,
      filePath: file.rel,
      startLine: 1,
      endLine: file.lineCount,
      properties: {},
      contentHash: file.sourceHash,
      evidence: [evidence(file.rel, 1, file.lineCount, file.sourceHash)],
    });
    addEdge({
      key: edgeKey("repo:root", GraphEdgeKind.CONTAINS, fileNodeKey),
      kind: GraphEdgeKind.CONTAINS,
      fromKey: "repo:root",
      toKey: fileNodeKey,
      provenance: GraphProvenance.EXTRACTED,
      confidence: 100,
      properties: {},
      evidence: [evidence(file.rel, 1, file.lineCount, file.sourceHash)],
    });
    addEdge({
      key: edgeKey(fileNodeKey, GraphEdgeKind.CONTAINS, moduleNodeKey),
      kind: GraphEdgeKind.CONTAINS,
      fromKey: fileNodeKey,
      toKey: moduleNodeKey,
      provenance: GraphProvenance.EXTRACTED,
      confidence: 100,
      properties: {},
      evidence: [evidence(file.rel, 1, file.lineCount, file.sourceHash)],
    });
  }

  // Dependency usage layer drawn from the tracked-usage analysis.
  for (const usage of analysis.usages) {
    if (changedFiles && !changedFiles.has(usage.filePath)) continue;
    const moduleKey = `module:${usage.filePath}`;
    const depKey = dependencyKey(usage.packageName);
    ensureDependencyNode(
      usage.packageName,
      depKey,
      evidence(usage.filePath, usage.line, null, sourceHashOf(usage.filePath)),
    );

    if (usage.usageType === UsageType.INITIALIZATION) {
      const clientNodeKey = clientKey(usage.packageName, usage.symbol);
      addNode({
        key: clientNodeKey,
        kind: GraphNodeKind.API_CLIENT,
        displayName: usage.symbol,
        filePath: usage.filePath,
        startLine: usage.line,
        endLine: null,
        properties: { packageName: usage.packageName },
        contentHash: factHash(clientNodeKey, GraphNodeKind.API_CLIENT, {
          packageName: usage.packageName,
        }),
        evidence: [evidence(usage.filePath, usage.line, null, sourceHashOf(usage.filePath))],
      });
      addEdge({
        key: edgeKey(moduleKey, GraphEdgeKind.CREATES_CLIENT, clientNodeKey),
        kind: GraphEdgeKind.CREATES_CLIENT,
        fromKey: moduleKey,
        toKey: clientNodeKey,
        provenance: GraphProvenance.EXTRACTED,
        confidence: 90,
        properties: { symbol: usage.symbol },
        evidence: [evidence(usage.filePath, usage.line, null, sourceHashOf(usage.filePath))],
      });
      addEdge({
        key: edgeKey(clientNodeKey, GraphEdgeKind.RESOLVES_TO, depKey),
        kind: GraphEdgeKind.RESOLVES_TO,
        fromKey: clientNodeKey,
        toKey: depKey,
        provenance: GraphProvenance.RESOLVED,
        confidence: 95,
        properties: {},
        evidence: [evidence(usage.filePath, usage.line, null, sourceHashOf(usage.filePath))],
      });
    }

    if (usage.usageType === UsageType.METHOD_CALL) {
      const apiOpKey = apiKey(usage.packageName, usage.symbol);
      addNode({
        key: apiOpKey,
        kind: GraphNodeKind.API_OPERATION,
        displayName: usage.symbol,
        filePath: usage.filePath,
        startLine: usage.line,
        endLine: null,
        properties: { packageName: usage.packageName },
        contentHash: factHash(apiOpKey, GraphNodeKind.API_OPERATION, {
          packageName: usage.packageName,
          symbol: usage.symbol,
        }),
        evidence: [evidence(usage.filePath, usage.line, null, sourceHashOf(usage.filePath))],
      });
      addEdge({
        key: edgeKey(moduleKey, GraphEdgeKind.INVOKES_API, apiOpKey),
        kind: GraphEdgeKind.INVOKES_API,
        fromKey: moduleKey,
        toKey: apiOpKey,
        provenance: GraphProvenance.EXTRACTED,
        confidence: 100,
        properties: { symbol: usage.symbol },
        evidence: [evidence(usage.filePath, usage.line, null, sourceHashOf(usage.filePath))],
      });
    }

    addEdge({
      key: edgeKey(moduleKey, GraphEdgeKind.USES_PACKAGE, depKey),
      kind: GraphEdgeKind.USES_PACKAGE,
      fromKey: moduleKey,
      toKey: depKey,
      provenance: GraphProvenance.EXTRACTED,
      confidence: 100,
      properties: { via: usage.usageType },
      evidence: [evidence(usage.filePath, usage.line, null, sourceHashOf(usage.filePath))],
    });
  }

  // MCP contract layer (WP3): one node per wired MCP server plus dependency
  // nodes for MCP SDK packages. Server names and config paths come from the
  // (snapshot-current) analysis; content hashes come from the walked tree, so
  // full and incremental extractions of one snapshot agree byte-for-byte and
  // the key-based merge converges on config edits. No call-site edges: which
  // module invokes which server is not statically decidable, and invented
  // edges would poison blast-radius inputs (documented future work: tool-name
  // references in code and prompts, spec §2.3).
  for (const config of analysis.mcpConfigs) {
    const configHash = walked.jsonHashes.get(config.path) ?? "";
    const configEvidence = evidence(config.path, null, null, configHash);
    for (const server of config.servers) {
      const serverKey = `mcp-server:${server}`;
      addNode({
        key: serverKey,
        kind: GraphNodeKind.MCP_SERVER,
        displayName: server,
        filePath: config.path,
        startLine: null,
        endLine: null,
        properties: { server, source: config.source, configPath: config.path },
        contentHash: factHash(serverKey, GraphNodeKind.MCP_SERVER, {
          server,
          source: config.source,
          configPath: config.path,
          configHash,
        }),
        evidence: [configEvidence],
      });
      addEdge({
        key: edgeKey("repo:root", GraphEdgeKind.CONTAINS, serverKey),
        kind: GraphEdgeKind.CONTAINS,
        fromKey: "repo:root",
        toKey: serverKey,
        provenance: GraphProvenance.EXTRACTED,
        confidence: 100,
        properties: { source: config.source, configPath: config.path },
        evidence: [configEvidence],
      });
    }
  }
  for (const packageName of analysis.mcpSdkPackages) {
    const manifestPath =
      analysis.manifests.find((manifest) => packageName in manifest.dependencies)?.path ?? null;
    const manifestEvidence =
      manifestPath !== null
        ? evidence(manifestPath, null, null, walked.jsonHashes.get(manifestPath) ?? "")
        : null;
    if (manifestEvidence) {
      ensureDependencyNode(packageName, dependencyKey(packageName), manifestEvidence);
    }
  }

  function ensureDependencyNode(packageName: string, depKey: string, ev: GraphEvidenceFact): void {
    if (nodes.has(depKey)) return;
    const ranges = [...(dependencyRanges.get(packageName) ?? [])];
    const devOnlyPathsFor = [...(devOnlyPaths.get(packageName) ?? [])];
    const resolvedVersion = analysis.lockfileVersions[packageName] ?? "";
    const declaredRanges = ranges.join("; ");
    const devOnlyValue =
      devOnlyPathsFor.length > 0 && !prodDependencies.has(packageName)
        ? devOnlyPathsFor.join(";")
        : "";
    const properties: Record<string, string> = { declaredRanges, resolvedVersion };
    if (devOnlyValue) properties.devOnly = devOnlyValue;
    const hash = factHash(depKey, GraphNodeKind.DEPENDENCY, {
      packageName,
      declaredRanges,
      resolvedVersion,
    });
    addNode({
      key: depKey,
      kind: GraphNodeKind.DEPENDENCY,
      displayName: packageName,
      filePath: null,
      startLine: null,
      endLine: null,
      properties,
      contentHash: hash,
      evidence:
        (dependencyEvidence.get(packageName) ?? []).length > 0
          ? [...dependencyEvidence.get(packageName)!]
          : [ev],
    });
    if (resolvedVersion) {
      const packageKey = `pkg:${packageName}@${resolvedVersion}`;
      addNode({
        key: packageKey,
        kind: GraphNodeKind.PACKAGE,
        displayName: `${packageName}@${resolvedVersion}`,
        filePath: null,
        startLine: null,
        endLine: null,
        properties: { packageName, version: resolvedVersion },
        contentHash: factHash(packageKey, GraphNodeKind.PACKAGE, {
          packageName,
          version: resolvedVersion,
        }),
        evidence: walked.lockfileHash
          ? [evidence(walked.lockfilePath!, null, null, walked.lockfileHash)]
          : [ev],
      });
      addEdge({
        key: edgeKey(depKey, GraphEdgeKind.RESOLVES_TO, packageKey),
        kind: GraphEdgeKind.RESOLVES_TO,
        fromKey: depKey,
        toKey: packageKey,
        provenance: GraphProvenance.RESOLVED,
        confidence: 99,
        properties: { version: resolvedVersion, resolvedFrom: walked.lockfilePath ?? "" },
        evidence: walked.lockfileHash
          ? [evidence(walked.lockfilePath!, null, null, walked.lockfileHash)]
          : [ev],
      });
    }
  }

  const sortedNodes = [...nodes.values()].sort((a, b) => a.key.localeCompare(b.key));
  const sortedEdges = [...edges.values()].sort((a, b) => a.key.localeCompare(b.key));
  for (const node of sortedNodes) node.evidence = sortEvidence(node.evidence);
  for (const edge of sortedEdges) edge.evidence = sortEvidence(edge.evidence);

  return {
    commitSha: analysis.commitSha,
    rootTreeHash: walked.treeHash,
    nodeFacts: sortedNodes,
    edgeFacts: sortedEdges,
    errors,
  };
}

function packageOfSpecifier(specifier: string): string {
  const [first = "", second = ""] = specifier.split("/");
  return specifier.startsWith("@") ? `${first}/${second}` : first;
}

function edgeKey(from: string, kind: string, to: string): string {
  return `${from}|${kind}|${to}`;
}

function dependencyKey(packageName: string): string {
  return `dep:${packageName}`;
}

function clientKey(packageName: string, symbol: string): string {
  return `client:${packageName}:${symbol}`;
}

function apiKey(packageName: string, symbol: string): string {
  return `api:${packageName}:${symbol}`;
}

function symbolKey(filePath: string, name: string): string {
  return `sym:${filePath}:${name}`;
}

function mergeEvidence(a: GraphEvidenceFact[], b: GraphEvidenceFact[]): GraphEvidenceFact[] {
  return [...a, ...b];
}

function sortEvidence(list: GraphEvidenceFact[]): GraphEvidenceFact[] {
  return [...list].sort(
    (a, b) =>
      a.filePath.localeCompare(b.filePath) ||
      (a.startLine ?? 0) - (b.startLine ?? 0) ||
      (b.endLine ?? 0) - (a.endLine ?? 0),
  );
}

interface RouteRegistration {
  method: string;
  path: string;
  receiver: string;
  line: number;
}

const ROUTE_RECEIVERS = new Set(["app", "router", "fastify", "server"]);
const ROUTE_METHODS = new Set(["get", "post", "put", "delete", "patch", "options", "head", "all"]);

/**
 * Conservative Express-style route registrations in one source file. Only
 * `app.<method>("literal-path", …)` / `router.<method>("literal-path", …)`
 * count: exact string-literal paths, exact method names, exact receiver
 * names. Everything else (template paths, variables, middleware, chained
 * builders) is skipped — a missing fact is recoverable, a wrong one is not.
 */
function collectRouteRegistrations(
  sourceFile: ts.SourceFile,
  position: (node: ts.Node) => number,
): RouteRegistration[] {
  const routes: RouteRegistration[] = [];
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        ROUTE_RECEIVERS.has(callee.expression.text) &&
        ROUTE_METHODS.has(callee.name.text)
      ) {
        const [first] = node.arguments;
        if (first && ts.isStringLiteralLike(first)) {
          routes.push({
            method: callee.name.text.toUpperCase(),
            path: first.text,
            receiver: callee.expression.text,
            line: position(node),
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return routes;
}

const NEXT_HTTP_EXPORTS = new Set(["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"]);

/**
 * Next.js App Router handlers: exported HTTP-method functions in
 * `**\/app/**\/route.ts` or `**\/api/**\/route.ts` files
 * (`export async function POST(req) { … }`). The route path derives from the
 * file location, so only the file-shape gate plus the exact export name can
 * fail — both deterministic. Non-route files return [] without reading content.
 */
function collectNextJsRouteHandlers(
  sourceFile: ts.SourceFile,
  filePath: string,
  position: (node: ts.Node) => number,
): RouteRegistration[] {
  const normalized = filePath.replaceAll("\\", "/");
  if (
    !/(?:^|\/)app\/.*\/route\.tsx?$/.test(normalized) &&
    !/(?:^|\/)api\/.*\/route\.tsx?$/.test(normalized)
  ) {
    return [];
  }
  const appIndex = normalized.lastIndexOf("/app/");
  const apiIndex = normalized.lastIndexOf("/api/");
  const routeRoot = appIndex >= 0 ? normalized.slice(appIndex + 4) : normalized.slice(apiIndex);
  const routePath = routeRoot.replace(/\/route\.tsx?$/, "") || "/";
  const routes: RouteRegistration[] = [];
  ts.forEachChild(sourceFile, (node) => {
    if (
      ts.isFunctionDeclaration(node) &&
      node.name &&
      NEXT_HTTP_EXPORTS.has(node.name.text) &&
      node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      routes.push({
        method: node.name.text,
        path: routePath,
        receiver: "nextjs-route",
        line: position(node),
      });
    }
  });
  return routes;
}

export interface ZodSchemaRegistration {
  name: string;
  fields: string[];
  line: number;
}

/**
 * Directory gate for webhook/event handler sources: only files under a
 * `webhook(s)`, `event(s)`, or `events` path segment are candidates. The
 * `^|\/` + `\/|$` anchors keep `uneventful.ts` and `my-webhooks-backup/x`
 * out — the gate is deliberately narrower than a substring match.
 */
const WEBHOOK_PATH_PATTERN = /(?:^|\/)(?:webhook|webhooks|events?)(?:\/|$)/i;

/**
 * Name heuristic for payload validators. A bare `z.object` in a webhook
 * directory is weak evidence (form schemas, configs, and fixtures live
 * there too), so collection additionally requires either this pattern or a
 * co-located route registration in the same file (see
 * `collectZodWebhookSchemas`).
 */
const VALIDATOR_NAME_PATTERN =
  /(schema|payload|validator|validation|event|webhook|body|input|message)/i;

/** Known terminal Zod chain methods: `z.object({…}).strict()` etc. still describe the object. */
const ZOD_OBJECT_CHAIN_METHODS = new Set([
  "strict",
  "strip",
  "catchall",
  "passthrough",
  "loose",
  "optional",
  "nullable",
  "nullish",
  "default",
  "describe",
  "brand",
  "refine",
  "superRefine",
  "transform",
  "readonly",
]);

/**
 * Top-level field names of a `z.object({ … })` expression. Unwraps terminal
 * chain methods (`z.object({…}).strict()`), recurses into nested
 * `z.object` values (reported dot-joined, e.g. `data.object`), and requires
 * the chain to root at the `z` identifier so `somethingElse.object({…})`
 * never counts. Non-object initializers return null (not a schema).
 */
function fieldsFromZodObject(node: ts.Expression): string[] | null {
  let current: ts.Expression = node;
  for (;;) {
    if (!ts.isCallExpression(current)) return null;
    const callee = current.expression;
    if (!ts.isPropertyAccessExpression(callee)) return null;
    if (callee.name.text !== "object") {
      // Terminal chain link (`z.object({…}).strict()`): descend into the
      // receiver when it is itself a call; anything else is a shape we
      // cannot read, so bail out rather than guess.
      if (!ZOD_OBJECT_CHAIN_METHODS.has(callee.name.text)) return null;
      if (!ts.isCallExpression(callee.expression)) return null;
      current = callee.expression;
      continue;
    }
    if (!ts.isIdentifier(callee.expression) || callee.expression.text !== "z") return null;
    const [first] = current.arguments;
    if (!first || !ts.isObjectLiteralExpression(first)) return null;
    const fields: string[] = [];
    for (const property of first.properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      const key = property.name;
      const fieldName = ts.isIdentifier(key) || ts.isStringLiteralLike(key) ? key.text : null;
      if (!fieldName) continue;
      const nested = fieldsFromZodObject(property.initializer);
      if (nested) {
        for (const sub of nested) fields.push(`${fieldName}.${sub}`);
      } else {
        fields.push(fieldName);
      }
    }
    return fields;
  }
}

/**
 * Zod payload validators in webhook/event handler files. A variable counts
 * only when all three gates hold: (1) the file lives under a webhook/events
 * directory, (2) the initializer is a `z.object({…})` chain, and (3) either
 * the variable name looks like a validator (`VALIDATOR_NAME_PATTERN`) or the
 * same file registers a route (`fileHasRoute` — co-location with a detected
 * handler is stronger evidence than a bare object in a webhook dir).
 */
function collectZodWebhookSchemas(
  sourceFile: ts.SourceFile,
  filePath: string,
  fileHasRoute: boolean,
  position: (node: ts.Node) => number,
): ZodSchemaRegistration[] {
  const normalized = filePath.replaceAll("\\", "/");
  if (!WEBHOOK_PATH_PATTERN.test(normalized)) return [];
  const schemas: ZodSchemaRegistration[] = [];
  function visit(node: ts.Node): void {
    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
        const fields = fieldsFromZodObject(declaration.initializer);
        if (!fields) continue;
        const name = declaration.name.text;
        if (!VALIDATOR_NAME_PATTERN.test(name) && !fileHasRoute) continue;
        schemas.push({ name, fields, line: position(declaration) });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return schemas;
}

function hasTestCall(sourceFile: ts.SourceFile): boolean {
  let found = false;
  function visit(node: ts.Node): void {
    if (found) return;
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (
        (ts.isIdentifier(callee) && /^(describe|it|test)$/.test(callee.text)) ||
        (ts.isPropertyAccessExpression(callee) && /^(describe|it|test)$/.test(callee.name.text))
      ) {
        found = true;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return found;
}

interface WalkedFile {
  rel: string;
  content: string;
  sourceHash: string;
  lineCount: number;
}

interface WalkResult {
  tsFiles: WalkedFile[];
  tsHashes: Map<string, string>;
  pyFiles: WalkedFile[];
  pyHashes: Map<string, string>;
  jsonHashes: Map<string, string>;
  treeHash: string;
  lockfilePath: string | null;
  lockfileHash: string | null;
}

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  ".next",
  "coverage",
  ".turbo",
  "build",
  ".cache",
]);

async function collectSources(rootDir: string): Promise<WalkResult> {
  const tsFiles: WalkedFile[] = [];
  const tsHashes = new Map<string, string>();
  const pyFiles: WalkedFile[] = [];
  const pyHashes = new Map<string, string>();
  const jsonHashes = new Map<string, string>();
  const treeParts: string[] = [];
  let lockfilePath: string | null = null;
  let lockfileHash: string | null = null;

  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        await walk(path.join(dir, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      const full = path.join(dir, entry.name);
      const rel = path.relative(rootDir, full).split(path.sep).join("/");
      const content = await fs.readFile(full, "utf8");
      const hash = createHash("sha256").update(content).digest("hex");
      treeParts.push(`${rel}\0${hash}\0`);
      if (/\.(ts|tsx|mts|cts)$/.test(entry.name)) {
        tsFiles.push({
          rel,
          content,
          sourceHash: hash,
          lineCount: content.split("\n").length,
        });
        tsHashes.set(rel, hash);
      }
      if (/\.py$/.test(entry.name)) {
        pyFiles.push({
          rel,
          content,
          sourceHash: hash,
          lineCount: content.split("\n").length,
        });
        pyHashes.set(rel, hash);
      }
      if (/\.json$/.test(entry.name)) jsonHashes.set(rel, hash);
      if (LOCKFILES.includes(entry.name) && !lockfilePath) {
        lockfilePath = rel;
        lockfileHash = hash;
      }
    }
  }

  await walk(rootDir);
  treeParts.sort();
  const treeHash = createHash("sha256").update(treeParts.join("")).digest("hex");
  return { tsFiles, tsHashes, pyFiles, pyHashes, jsonHashes, treeHash, lockfilePath, lockfileHash };
}
