export { analyzeRepository } from "./analyzer";
export type {
  AnalyzeRepositoryOptions,
  AnalysisError,
  AnalyzedUsage,
  ModuleExports,
  PackageManifest,
  PackageManager,
  RelativeModuleResolver,
  RepositoryAnalysis,
} from "./types";
export { analyzeSource, collectBindings, rootIdentifier } from "./ast";
export { collectModuleExports, makeRelativeResolver, resolveRelativeTarget } from "./exports";
export { classifyRiskTags } from "./risk";
export { detectLockfile, packageManagerFor, resolveLockfileVersions } from "./lockfile";
export { resolveFixtureDir, resolvePatchbayRoot } from "./fixtures";
