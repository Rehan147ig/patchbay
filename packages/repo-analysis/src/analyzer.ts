import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { analyzeSource, collectBindings } from "./ast";
import { collectModuleExports, makeRelativeResolver } from "./exports";
import { resolveLockfileVersions } from "./lockfile";
import type {
  AnalyzeRepositoryOptions,
  AnalysisError,
  AnalyzedUsage,
  ModuleExports,
  PackageManifest,
  RepositoryAnalysis,
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
  const { rootDir, trackPackages } = options;
  const trackSet = new Set(trackPackages);
  const envPrefixes = Object.fromEntries(trackPackages.map((pkg) => [pkg, pkg]));

  const files = await collectFiles(rootDir);
  const manifests: PackageManifest[] = [];
  const errors: AnalysisError[] = [];

  for (const rel of files.jsonFiles) {
    if (!rel.endsWith("package.json")) continue;
    try {
      const raw = await fs.readFile(path.join(rootDir, rel), "utf8");
      const manifest = JSON.parse(raw) as {
        name?: string;
        version?: string;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      manifests.push({
        path: rel,
        name: manifest.name ?? null,
        version: manifest.version ?? null,
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

  const usages = await analyzeUsages(sourcesByFile, trackSet, envPrefixes);
  errors.push(...usages.errors);

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
    filesScanned: files.tsFiles.length + files.jsonFiles.length,
    typescriptFiles: files.tsFiles.length,
    durationMs: Date.now() - startedAt,
    commitSha: computeSnapshotHash(files),
    lockfileVersions: versions,
    manifests,
    usages: usages.usages,
    errors,
    untrackedUsages: usages.untrackedUsages,
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
async function analyzeUsages(
  sourcesByFile: Map<string, string>,
  trackSet: Set<string>,
  envPrefixes: Record<string, string>,
): Promise<{ usages: AnalyzedUsage[]; untrackedUsages: number; errors: AnalysisError[] }> {
  const files = new Set(sourcesByFile.keys());
  let bindingsByFile = new Map<string, Map<string, string>>();
  let exportsByFile = new Map<string, ModuleExports>();

  for (let pass = 0; pass < 3; pass += 1) {
    const resolver = makeRelativeResolver(exportsByFile, files);
    const nextBindings = new Map<string, Map<string, string>>();
    for (const [rel, source] of sourcesByFile) {
      const sourceFile = ts.createSourceFile(
        rel,
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
      );
      const bindings = collectBindings(sourceFile, rel, trackSet, resolver);
      nextBindings.set(
        rel,
        new Map([...bindings].map(([name, binding]) => [name, binding.packageName])),
      );
    }
    bindingsByFile = nextBindings;

    const nextExports = new Map<string, ModuleExports>();
    for (const [rel, source] of sourcesByFile) {
      const sourceFile = ts.createSourceFile(
        rel,
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
      );
      nextExports.set(rel, collectModuleExports(sourceFile, bindingsByFile.get(rel) ?? new Map()));
    }
    exportsByFile = nextExports;
  }

  const resolver = makeRelativeResolver(exportsByFile, files);
  const usages: AnalyzedUsage[] = [];
  const errors: AnalysisError[] = [];
  let untrackedUsages = 0;
  for (const [rel, source] of sourcesByFile) {
    try {
      const result = analyzeSource(source, rel, trackSet, envPrefixes, resolver);
      usages.push(...result.usages);
      untrackedUsages += result.untrackedUsages;
    } catch (error) {
      errors.push({ filePath: rel, message: String(error) });
    }
  }

  usages.sort(
    (a, b) => a.filePath.localeCompare(b.filePath) || a.line - b.line || a.column - b.column,
  );
  return { usages, untrackedUsages, errors };
}

interface CollectedFiles {
  tsFiles: string[];
  jsonFiles: string[];
  /** Every file fed into the snapshot hash (ts + json). */
  allFiles: string[];
}

async function collectFiles(rootDir: string): Promise<CollectedFiles> {
  const tsFiles: string[] = [];
  const jsonFiles: string[] = [];
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
    }
  }

  await walk(rootDir);
  return { tsFiles, jsonFiles, allFiles };
}

/** Deterministic hash over the scanned file set (paths only, order stable). */
function computeSnapshotHash(files: CollectedFiles): string {
  const hasher = createHash("sha256");
  for (const rel of files.allFiles) {
    hasher.update(`${rel}\0`);
  }
  return `snap-${hasher.digest("hex").slice(0, 12)}`;
}
