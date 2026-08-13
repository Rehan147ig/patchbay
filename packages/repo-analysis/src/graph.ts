import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { GraphEdgeKind, GraphNodeKind, GraphProvenance, UsageType } from "@patchbay/domain";
import { analyzeRepository } from "./analyzer";
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
}

/**
 * Deterministic software-intelligence graph extraction of a repository
 * snapshot. Builds on `analyzeRepository` (usages, manifests, lockfile) and a
 * structural pass (imports, exports, tests, content hashes). Same snapshot in,
 * byte-identical facts out — no timestamps, no randomness.
 */
export async function extractGraph(options: ExtractGraphOptions): Promise<GraphExtraction> {
  const { rootDir, trackPackages, changedFiles } = options;
  const analysis = await analyzeRepository({ rootDir, trackPackages });
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

  const nodes = new Map<string, GraphNodeFact>();
  const edges = new Map<string, GraphEdgeFact>();
  const errors: AnalysisError[] = [...analysis.errors];

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

  // Dependency usage layer drawn from the tracked-usage analysis.
  for (const usage of analysis.usages) {
    if (changedFiles && !changedFiles.has(usage.filePath)) continue;
    const moduleKey = `module:${usage.filePath}`;
    const depKey = dependencyKey(usage.packageName);
    ensureDependencyNode(
      usage.packageName,
      depKey,
      evidence(usage.filePath, usage.line, null, walked.tsHashes.get(usage.filePath) ?? ""),
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
        evidence: [
          evidence(usage.filePath, usage.line, null, walked.tsHashes.get(usage.filePath) ?? ""),
        ],
      });
      addEdge({
        key: edgeKey(moduleKey, GraphEdgeKind.CREATES_CLIENT, clientNodeKey),
        kind: GraphEdgeKind.CREATES_CLIENT,
        fromKey: moduleKey,
        toKey: clientNodeKey,
        provenance: GraphProvenance.EXTRACTED,
        confidence: 90,
        properties: { symbol: usage.symbol },
        evidence: [
          evidence(usage.filePath, usage.line, null, walked.tsHashes.get(usage.filePath) ?? ""),
        ],
      });
      addEdge({
        key: edgeKey(clientNodeKey, GraphEdgeKind.RESOLVES_TO, depKey),
        kind: GraphEdgeKind.RESOLVES_TO,
        fromKey: clientNodeKey,
        toKey: depKey,
        provenance: GraphProvenance.RESOLVED,
        confidence: 95,
        properties: {},
        evidence: [
          evidence(usage.filePath, usage.line, null, walked.tsHashes.get(usage.filePath) ?? ""),
        ],
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
        evidence: [
          evidence(usage.filePath, usage.line, null, walked.tsHashes.get(usage.filePath) ?? ""),
        ],
      });
      addEdge({
        key: edgeKey(moduleKey, GraphEdgeKind.INVOKES_API, apiOpKey),
        kind: GraphEdgeKind.INVOKES_API,
        fromKey: moduleKey,
        toKey: apiOpKey,
        provenance: GraphProvenance.EXTRACTED,
        confidence: 100,
        properties: { symbol: usage.symbol },
        evidence: [
          evidence(usage.filePath, usage.line, null, walked.tsHashes.get(usage.filePath) ?? ""),
        ],
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
      evidence: [
        evidence(usage.filePath, usage.line, null, walked.tsHashes.get(usage.filePath) ?? ""),
      ],
    });
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
  return { tsFiles, tsHashes, jsonHashes, treeHash, lockfilePath, lockfileHash };
}
