import type { RiskTag, UsageType } from "@patchbay/domain";

export interface AnalyzedUsage {
  /** npm package name the usage refers to (e.g. "stripe"). */
  packageName: string;
  /** Path relative to the repository root, posix separators. */
  filePath: string;
  line: number;
  column: number;
  symbol: string;
  usageType: UsageType;
  /** The source line the usage sits on, trimmed to a reasonable length. */
  excerpt: string;
  riskTags: RiskTag[];
}

export interface PackageManifest {
  /** Path relative to the repository root, posix separators. */
  path: string;
  name: string | null;
  version: string | null;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
}

export type PackageManager = "pnpm" | "npm" | "yarn" | "unknown";

export interface AnalysisError {
  filePath: string;
  message: string;
}

export interface RepositoryAnalysis {
  packageManager: PackageManager;
  /** Total dependency entries across all manifests (deps + devDeps). */
  packageCount: number;
  filesScanned: number;
  typescriptFiles: number;
  durationMs: number;
  /** Deterministic snapshot hash of all scanned file contents. */
  commitSha: string;
  /** Resolved installed versions for tracked packages (from the lockfile). */
  lockfileVersions: Record<string, string>;
  /** CONFIG/ENV usages dropped because no tracked package could be inferred. */
  untrackedUsages: number;
  manifests: PackageManifest[];
  usages: AnalyzedUsage[];
  errors: AnalysisError[];
}

export interface AnalyzeRepositoryOptions {
  rootDir: string;
  /** Package names whose usages should be indexed (e.g. ["stripe", "openai"]). */
  trackPackages: string[];
}

/**
 * Bindings a module makes visible to importers, resolved from a single file.
 * `named` maps exported local names to tracked package names; `defaultPackage`
 * is set when a `export default` expression is traceable to a tracked package.
 */
export interface ModuleExports {
  named: Map<string, string>;
  defaultPackage: string | null;
}

/**
 * Resolves a relative import (`./x`, `../lib/y`) to the importing module's
 * exports, or `null` when the target is unknown/untracked. Kept injectable so
 * `analyzeSource` stays single-file and deterministic.
 */
export type RelativeModuleResolver = (fromFile: string, specifier: string) => ModuleExports | null;
