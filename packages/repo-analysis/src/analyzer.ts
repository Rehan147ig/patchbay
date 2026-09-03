import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { analyzeSource, collectBindings, collectUntrackedImports } from "./ast";
import { collectModuleExports, makeRelativeResolver } from "./exports";
import { dispatchPhase, resolveParallelConfig, shouldParallelize, splitChunks } from "./parallel";
import type { WorkerShared } from "./analyze-worker";
import { extractJavaUsages, parseJavaManifest } from "./java";
import { resolveLockfileVersions } from "./lockfile";
import { extractPythonUsages, parsePythonManifest } from "./python";
import type {
  AnalysisProgress,
  AnalysisStage,
  AnalyzeRepositoryOptions,
  AnalysisError,
  AnalyzedUsage,
  ModuleExports,
  PackageManifest,
  PythonManifest,
  RepositoryAnalysis,
  WorkspacePackage,
} from "./types";

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

/**
 * Analyzes a repository snapshot on disk:
 * - discovers manifests + lockfile, resolves installed versions
 * - indexes usages of `trackPackages` across all TypeScript sources
 * - produces a deterministic snapshot commitSha over the scanned files
 *
 * Pure file-system analysis; no network, no external services.
 */
export async function analyzeRepository(
  options: AnalyzeRepositoryOptions,
): Promise<RepositoryAnalysis> {
  const startedAt = Date.now();
  const { rootDir, trackPackages, onProgress } = options;
  const trackSet = new Set(trackPackages);
  const envPrefixes = Object.fromEntries(trackPackages.map((pkg) => [pkg, pkg]));

  const files = await collectFiles(rootDir);
  // Progress reporter for the real-time scan counter: throttled to one
  // callback per 500ms (plus first/last) so a 7k-file repo emits dozens of
  // updates, not thousands. `scanned` counts distinct source files fully
  // extracted; binding/export passes stay silent between PARSING and INDEXING.
  const progressTotal = files.tsFiles.length + files.pyFiles.length + files.javaFiles.length;
  let progressScanned = 0;
  let progressStage: AnalysisStage = "PARSING";
  let lastProgressEmit = 0;
  const emitProgress = (force = false): void => {
    if (!onProgress) return;
    const now = Date.now();
    if (!force && progressScanned < progressTotal && now - lastProgressEmit < 500) return;
    lastProgressEmit = now;
    try {
      const progress: AnalysisProgress = {
        stage: progressStage,
        scanned: progressScanned,
        total: progressTotal,
      };
      onProgress(progress);
    } catch {
      // Progress must never fail a scan.
    }
  };
  progressStage = "PARSING";
  emitProgress(true);
  const manifests: PackageManifest[] = [];
  const errors: AnalysisError[] = [];

  for (const rel of files.jsonFiles) {
    if (!rel.endsWith("package.json")) continue;
    try {
      const raw = await fs.readFile(path.join(rootDir, rel), "utf8");
      const manifest = JSON.parse(raw) as {
        name?: string;
        version?: string;
        main?: string;
        exports?: unknown;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      manifests.push({
        path: rel,
        name: manifest.name ?? null,
        version: manifest.version ?? null,
        main: manifest.main,
        exports: manifest.exports,
        dependencies: manifest.dependencies ?? {},
        devDependencies: manifest.devDependencies ?? {},
      });
    } catch (error) {
      errors.push({ filePath: rel, message: `invalid package.json: ${String(error)}` });
    }
  }

  const sourcesByFile = new Map<string, string>();
  for (const rel of files.tsFiles) {
    try {
      sourcesByFile.set(rel, await fs.readFile(path.join(rootDir, rel), "utf8"));
    } catch (error) {
      errors.push({ filePath: rel, message: String(error) });
    }
  }

  const pythonSourcesByFile = new Map<string, string>();
  for (const rel of files.pyFiles) {
    try {
      pythonSourcesByFile.set(rel, await fs.readFile(path.join(rootDir, rel), "utf8"));
    } catch (error) {
      errors.push({ filePath: rel, message: String(error) });
    }
  }

  const pythonManifests: PythonManifest[] = [];
  for (const rel of files.pythonManifestFiles) {
    try {
      const raw = await fs.readFile(path.join(rootDir, rel), "utf8");
      pythonManifests.push({ path: rel, ...parsePythonManifest(rel, raw) });
    } catch (error) {
      errors.push({ filePath: rel, message: String(error) });
    }
  }
  pythonManifests.sort((a, b) => a.path.localeCompare(b.path));

  // Java build manifests feed the shared PackageManifest list so dependency
  // inventory, matching, and packageCount treat Maven/Gradle identically.
  for (const rel of files.javaManifestFiles) {
    try {
      const raw = await fs.readFile(path.join(rootDir, rel), "utf8");
      const parsed = parseJavaManifest(rel, raw);
      manifests.push({
        path: parsed.path,
        name: parsed.manifest.name,
        version: parsed.manifest.version,
        dependencies: parsed.manifest.dependencies,
        devDependencies: {},
      });
    } catch (error) {
      errors.push({ filePath: rel, message: String(error) });
    }
  }

  const workspaceEntryFiles = await resolveWorkspacePackages(rootDir, files.tsFiles, manifests);
  const tickIndexed = (): void => {
    progressScanned = Math.min(progressScanned + 1, progressTotal);
    emitProgress();
  };
  const usages = await analyzeUsages(sourcesByFile, trackSet, envPrefixes, workspaceEntryFiles, {
    onFileIndexed: tickIndexed,
    onIndexingStart: () => {
      progressStage = "INDEXING";
      emitProgress(true);
    },
  });
  errors.push(...usages.errors);

  const pythonUsages: AnalyzedUsage[] = [];
  for (const [rel, source] of pythonSourcesByFile) {
    try {
      pythonUsages.push(...(await extractPythonUsages(source, rel, trackSet)));
      tickIndexed();
    } catch (error) {
      errors.push({ filePath: rel, message: String(error) });
    }
  }

  // Java L1 extraction (same trackSet semantics as Python: segment match).
  const javaUsages: AnalyzedUsage[] = [];
  for (const rel of files.javaFiles) {
    try {
      const raw = await fs.readFile(path.join(rootDir, rel), "utf8");
      javaUsages.push(...(await extractJavaUsages(raw, rel, trackSet)));
      tickIndexed();
    } catch (error) {
      errors.push({ filePath: rel, message: String(error) });
    }
  }
  emitProgress(true);

  const { packageManager, versions } = await resolveLockfileVersions(rootDir);
  const packageCount = manifests.reduce(
    (sum, manifest) =>
      sum +
      Object.keys(manifest.dependencies).length +
      Object.keys(manifest.devDependencies).length,
    0,
  );

  return {
    packageManager,
    packageCount,
    filesScanned:
      files.tsFiles.length +
      files.jsonFiles.length +
      files.pyFiles.length +
      files.javaFiles.length +
      files.javaManifestFiles.length +
      files.pythonManifestFiles.length,
    typescriptFiles: files.tsFiles.length,
    pythonFiles: files.pyFiles.length,
    javaFiles: files.javaFiles.length,
    durationMs: Date.now() - startedAt,
    commitSha: computeSnapshotHash(files),
    lockfileVersions: versions,
    manifests,
    pythonManifests,
    usages: [...usages.usages, ...pythonUsages, ...javaUsages],
    errors,
    untrackedUsages: usages.untrackedUsages,
    untrackedPackages: usages.untrackedPackages,
  };
}

/**
 * Cross-file analysis with export resolution. Fixture repositories use the
 * legacy pattern of building a tracked client in `lib/` and importing it from
 * relative paths, so bindings are resolved iteratively:
 * pass 1 uses only direct package imports, deriving per-module tracked exports;
 * later passes let relative imports bind through those exports (fixed-point,
 * capped at 3 iterations; exports can only grow, so it converges deterministically).
 */
export interface AnalyzeUsagesProgress {
  /** Called once per TS file completing the final extraction loop. */
  onFileIndexed: () => void;
  /** Called once when the final extraction loop starts (stage flips). */
  onIndexingStart: () => void;
}

async function analyzeUsages(
  sourcesByFile: Map<string, string>,
  trackSet: Set<string>,
  envPrefixes: Record<string, string>,
  workspacePackages: ReadonlyMap<string, WorkspacePackage> = new Map(),
  progress?: AnalyzeUsagesProgress,
): Promise<{
  usages: AnalyzedUsage[];
  untrackedUsages: number;
  untrackedPackages: string[];
  errors: AnalysisError[];
}> {
  const files = new Set(sourcesByFile.keys());
  const parallelConfig = resolveParallelConfig();
  if (shouldParallelize(sourcesByFile.size, parallelConfig)) {
    try {
      return await analyzeUsagesParallel(
        sourcesByFile,
        trackSet,
        envPrefixes,
        workspacePackages,
        parallelConfig,
        progress
          ? {
              onFilesIndexed: (count: number) => {
                for (let i = 0; i < count; i += 1) progress.onFileIndexed();
              },
              onIndexingStart: progress.onIndexingStart,
            }
          : undefined,
      );
    } catch {
      // Worker threads unavailable (constrained hosts, vitest pools):
      // fall through to the serial path below. Never fail a scan here.
    }
  }
  // Parse once per file and reuse the tree across all binding/export passes
  // and the final analysis: 8 parses per file -> 1 (+1 inside analyzeSource
  // only when the caller does not pass the tree through).
  const parsedByFile = new Map<string, ts.SourceFile>();
  for (const [rel, source] of sourcesByFile) {
    parsedByFile.set(
      rel,
      ts.createSourceFile(rel, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS),
    );
  }
  let bindingsByFile = new Map<string, Map<string, string>>();
  let exportsByFile = new Map<string, ModuleExports>();

  for (let pass = 0; pass < 3; pass += 1) {
    const resolver = makeRelativeResolver(exportsByFile, files, workspacePackages);
    const nextBindings = new Map<string, Map<string, string>>();
    for (const [rel] of sourcesByFile) {
      const sourceFile = parsedByFile.get(rel)!;
      const bindings = collectBindings(sourceFile, rel, trackSet, resolver);
      nextBindings.set(
        rel,
        new Map([...bindings].map(([name, binding]) => [name, binding.packageName])),
      );
    }
    bindingsByFile = nextBindings;

    const nextExports = new Map<string, ModuleExports>();
    for (const [rel] of sourcesByFile) {
      const sourceFile = parsedByFile.get(rel)!;
      nextExports.set(
        rel,
        collectModuleExports(sourceFile, bindingsByFile.get(rel) ?? new Map(), resolver),
      );
    }
    exportsByFile = nextExports;
  }

  const resolver = makeRelativeResolver(exportsByFile, files, workspacePackages);
  const usages: AnalyzedUsage[] = [];
  const errors: AnalysisError[] = [];
  const untrackedPackages = new Set<string>();
  let untrackedUsages = 0;
  progress?.onIndexingStart();
  for (const [rel, source] of sourcesByFile) {
    try {
      const sourceFile = parsedByFile.get(rel)!;
      for (const pkg of collectUntrackedImports(sourceFile)) {
        if (!trackSet.has(pkg) && !workspacePackages.has(pkg)) untrackedPackages.add(pkg);
      }
      const result = analyzeSource(source, rel, trackSet, envPrefixes, resolver, sourceFile);
      usages.push(...result.usages);
      untrackedUsages += result.untrackedUsages;
    } catch (error) {
      errors.push({ filePath: rel, message: String(error) });
    } finally {
      progress?.onFileIndexed();
    }
  }

  usages.sort(
    (a, b) => a.filePath.localeCompare(b.filePath) || a.line - b.line || a.column - b.column,
  );
  return {
    usages,
    untrackedUsages,
    untrackedPackages: [...untrackedPackages].sort().slice(0, 50),
    errors,
  };
}

/**
 * Parallel twin of the serial loop in `analyzeUsages`: the 3 fixed-point
 * passes stay sequential, files within each pass fan out to worker threads.
 * Merge order is chunk order, and usages are re-sorted at the end, so output
 * is byte-identical to the serial path. Throws on any worker failure so the
 * caller falls back to serial.
 */
export interface ParallelUsagesProgress {
  /** Called with the file count of each analyze chunk as results arrive. */
  onFilesIndexed: (count: number) => void;
  /** Called once before the analyze dispatch starts (stage flips). */
  onIndexingStart: () => void;
}

async function analyzeUsagesParallel(
  sourcesByFile: Map<string, string>,
  trackSet: Set<string>,
  envPrefixes: Record<string, string>,
  workspacePackages: ReadonlyMap<string, WorkspacePackage>,
  config: ReturnType<typeof resolveParallelConfig>,
  progress?: ParallelUsagesProgress,
): Promise<{
  usages: AnalyzedUsage[];
  untrackedUsages: number;
  untrackedPackages: string[];
  errors: AnalysisError[];
}> {
  const entries = [...sourcesByFile].map(([rel, source]) => ({ rel, source }));
  const workerCount = Math.min(config.maxWorkers, entries.length);
  const chunks = splitChunks(entries, workerCount);
  const files = [...sourcesByFile.keys()];

  const serializeWorkspace = (): WorkerShared["workspacePackages"] =>
    [...workspacePackages].map(([name, pkg]) => ({
      name,
      entry: pkg.entry,
      subpaths: [...pkg.subpaths],
    }));
  const serializeExports = (
    map: ReadonlyMap<string, ModuleExports>,
  ): WorkerShared["exportsSnapshot"] =>
    [...map].map(([rel, exp]) => ({
      rel,
      named: [...exp.named],
      defaultPackage: exp.defaultPackage,
    }));
  const serializeBindings = (
    map: ReadonlyMap<string, Map<string, string>>,
  ): WorkerShared["bindingsSnapshot"] =>
    [...map].map(([rel, bindings]) => ({ rel, bindings: [...bindings] }));

  const baseShared = (): WorkerShared => ({
    trackPackages: [...trackSet],
    envPrefixes,
    files,
    workspacePackages: serializeWorkspace(),
    exportsSnapshot: [],
    bindingsSnapshot: [],
  });

  let bindingsByFile = new Map<string, Map<string, string>>();
  let exportsByFile = new Map<string, ModuleExports>();

  for (let pass = 0; pass < 3; pass += 1) {
    const bindingResults = await dispatchPhase(
      "bindings",
      chunks,
      { ...baseShared(), exportsSnapshot: serializeExports(exportsByFile) },
      config,
    );
    const nextBindings = new Map<string, Map<string, string>>();
    for (const result of bindingResults) {
      if (result.kind !== "bindings")
        throw new Error("unexpected worker payload for bindings phase");
      for (const entry of result.entries) {
        nextBindings.set(entry.rel, new Map(entry.bindings));
      }
    }
    bindingsByFile = nextBindings;

    const exportResults = await dispatchPhase(
      "exports",
      chunks,
      {
        ...baseShared(),
        exportsSnapshot: serializeExports(exportsByFile),
        bindingsSnapshot: serializeBindings(nextBindings),
      },
      config,
    );
    const nextExports = new Map<string, ModuleExports>();
    for (const result of exportResults) {
      if (result.kind !== "exports") throw new Error("unexpected worker payload for exports phase");
      for (const entry of result.entries) {
        nextExports.set(entry.rel, {
          named: new Map(entry.named),
          defaultPackage: entry.defaultPackage,
        });
      }
    }
    exportsByFile = nextExports;
  }

  progress?.onIndexingStart();
  const analyzeResults = await dispatchPhase(
    "analyze",
    chunks,
    {
      ...baseShared(),
      exportsSnapshot: serializeExports(exportsByFile),
      bindingsSnapshot: serializeBindings(bindingsByFile),
    },
    config,
    {
      onChunkDone: (taskId: number) => {
        progress?.onFilesIndexed(chunks[taskId]?.length ?? 0);
      },
    },
  );

  const usages: AnalyzedUsage[] = [];
  const errors: AnalysisError[] = [];
  const untrackedPackages = new Set<string>();
  let untrackedUsages = 0;
  for (const result of analyzeResults) {
    if (result.kind !== "analyze") throw new Error("unexpected worker payload for analyze phase");
    usages.push(...result.usages);
    untrackedUsages += result.untrackedUsages;
    for (const pkg of result.untrackedPackages) untrackedPackages.add(pkg);
    errors.push(...result.errors);
  }

  usages.sort(
    (a, b) => a.filePath.localeCompare(b.filePath) || a.line - b.line || a.column - b.column,
  );
  return {
    usages,
    untrackedUsages,
    untrackedPackages: [...untrackedPackages].sort().slice(0, 50),
    errors,
  };
}

interface CollectedFiles {
  tsFiles: string[];
  jsonFiles: string[];
  pyFiles: string[];
  javaFiles: string[];
  javaManifestFiles: string[];
  pythonManifestFiles: string[];
  /** Every file fed into the snapshot hash (all scanned sources + manifests). */
  allFiles: string[];
}

/**
 * Maps workspace package names to their entry modules so package-name imports
 * (`import { stripe } from "@acme/payments"`, `@acme/payments/src/index.ts`)
 * resolve deterministically:
 * - workspace globs come from `pnpm-workspace.yaml` `packages:` or the root
 *   package.json `workspaces` field (pnpm-workspace.yaml wins),
 * - each package.json's directory must match a glob and its `name` becomes the
 *   specifier,
 * - the entry is the `exports` field's `"."` (string, or `import`/`require`
 *   strings) plus simple `./...` subpath keys; without `exports`, `main`
 *   mapped to TS/JS variants, then `src/index.*`, then `index.*`.
 * Unresolvable packages are skipped (the resolver returns null, never crashes).
 */
async function resolveWorkspacePackages(
  rootDir: string,
  tsFiles: string[],
  manifests: PackageManifest[],
): Promise<Map<string, WorkspacePackage>> {
  const patterns = await readWorkspaceGlobs(rootDir);
  if (patterns.length === 0) return new Map();
  const fileSet = new Set(tsFiles);
  const out = new Map<string, WorkspacePackage>();
  for (const manifest of manifests) {
    if (!manifest.name) continue;
    const dir = path.posix.dirname(manifest.path);
    if (dir === ".") continue;
    if (!patterns.some((pattern) => workspaceGlobMatches(pattern, dir))) continue;
    const workspace = workspaceEntryFor(dir, manifest.main, manifest.exports, fileSet);
    if (workspace) out.set(manifest.name, workspace);
  }
  return out;
}

async function readWorkspaceGlobs(rootDir: string): Promise<string[]> {
  const fromYaml = await readWorkspaceYamlGlobs(rootDir);
  if (fromYaml.length > 0) return fromYaml;
  try {
    const raw = await fs.readFile(
      path.join(/*turbopackIgnore: true*/ rootDir, "package.json"),
      "utf8",
    );
    const pkg = JSON.parse(raw) as { workspaces?: unknown };
    const workspaces = pkg.workspaces;
    if (Array.isArray(workspaces)) {
      return workspaces.filter((entry): entry is string => typeof entry === "string");
    }
    if (workspaces && typeof workspaces === "object") {
      const list = (workspaces as { packages?: unknown }).packages;
      if (Array.isArray(list)) {
        return list.filter((entry): entry is string => typeof entry === "string");
      }
    }
  } catch {
    // no workspaces field; fall through
  }
  return [];
}

async function readWorkspaceYamlGlobs(rootDir: string): Promise<string[]> {
  let raw: string;
  try {
    raw = await fs.readFile(
      path.join(/*turbopackIgnore: true*/ rootDir, "pnpm-workspace.yaml"),
      "utf8",
    );
  } catch {
    return [];
  }
  const globs: string[] = [];
  let inPackages = false;
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!inPackages) {
      if (trimmed === "packages:") inPackages = true;
      continue;
    }
    if (trimmed.startsWith("- ")) {
      const value = trimmed
        .slice(2)
        .trim()
        .replace(/^["']|["']$/g, "");
      if (value) globs.push(value);
      continue;
    }
    if (trimmed !== "" && !trimmed.startsWith("#")) break;
  }
  return globs;
}

function workspaceGlobMatches(pattern: string, dir: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const source = escaped.replace(/\*\*/g, "\0").replace(/\*/g, "[^/]+").replace(/\0/g, ".*");
  return new RegExp(`^${source}$`).test(dir);
}

function workspaceEntryFor(
  dir: string,
  main: string | undefined,
  exportsField: unknown,
  files: Set<string>,
): WorkspacePackage | null {
  const subpaths = new Map<string, string>();
  let dotEntry: string | null = null;
  if (typeof exportsField === "string") {
    dotEntry = resolveWorkspaceFile(dir, exportsField, files);
  } else if (exportsField && typeof exportsField === "object" && !Array.isArray(exportsField)) {
    for (const [key, value] of Object.entries(exportsField)) {
      const spec = exportsValueFile(value);
      if (!spec) continue;
      if (key === ".") {
        if (!dotEntry) dotEntry = resolveWorkspaceFile(dir, spec, files);
      } else if (key.startsWith("./")) {
        const resolved = resolveWorkspaceFile(dir, spec, files);
        if (resolved) subpaths.set(key, resolved);
      }
    }
  }
  const entry =
    dotEntry ??
    (main ? resolveWorkspaceFile(dir, main, files) : null) ??
    resolveWorkspaceFile(dir, "src/index", files) ??
    resolveWorkspaceFile(dir, "index", files);
  if (!entry) return null;
  return { entry, subpaths };
}

/** `exports` value: a string, or `{ import|require|default: string }`. */
function exportsValueFile(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    for (const key of ["import", "require", "default"]) {
      if (typeof object[key] === "string") return object[key];
    }
  }
  return null;
}

/** Resolves a package-relative specifier against the scanned file set. */
function resolveWorkspaceFile(dir: string, specifier: string, files: Set<string>): string | null {
  const base = path.posix.normalize(`${dir}/${specifier.replace(/^\.\//, "")}`);
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`];
  return candidates.find((candidate) => files.has(candidate)) ?? null;
}

async function collectFiles(rootDir: string): Promise<CollectedFiles> {
  const tsFiles: string[] = [];
  const jsonFiles: string[] = [];
  const pyFiles: string[] = [];
  const javaFiles: string[] = [];
  const javaManifestFiles: string[] = [];
  const pythonManifestFiles: string[] = [];
  const allFiles: string[] = [];

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
      allFiles.push(rel);
      if (/\.(ts|tsx|mts|cts)$/.test(entry.name)) tsFiles.push(rel);
      if (/\.json$/.test(entry.name)) jsonFiles.push(rel);
      if (/\.py$/.test(entry.name)) pyFiles.push(rel);
      if (/\.java$/i.test(entry.name)) javaFiles.push(rel);
      if (/^(pom\.xml|build\.gradle|build\.gradle\.kts)$/.test(entry.name)) {
        javaManifestFiles.push(rel);
      }
      if (/^pyproject\.toml$/.test(entry.name) || /^requirements.*\.txt$/.test(entry.name)) {
        pythonManifestFiles.push(rel);
      }
    }
  }

  await walk(rootDir);
  return {
    tsFiles,
    jsonFiles,
    pyFiles,
    javaFiles,
    javaManifestFiles,
    pythonManifestFiles,
    allFiles,
  };
}

/** Deterministic hash over the scanned file set (paths only, order stable). */
function computeSnapshotHash(files: CollectedFiles): string {
  const hasher = createHash("sha256");
  for (const rel of files.allFiles) {
    hasher.update(`${rel}\0`);
  }
  return `snap-${hasher.digest("hex").slice(0, 12)}`;
}
