export { analyzeRepository } from "./analyzer";
export type {
  AnalyzeRepositoryOptions,
  AnalysisError,
  AnalyzedUsage,
  ModuleExports,
  PackageManifest,
  PackageManager,
  PythonManifest,
  RelativeModuleResolver,
  RepositoryAnalysis,
} from "./types";
export {
  extractPythonUsages,
  parsePythonManifest,
  parsePyProjectToml,
  parseRequirementsTxt,
} from "./python";
export { analyzeSource, collectBindings, rootIdentifier } from "./ast";
export { collectModuleExports, makeRelativeResolver, resolveRelativeTarget } from "./exports";
export { classifyRiskTags } from "./risk";
export { detectLockfile, packageManagerFor, resolveLockfileVersions } from "./lockfile";
export { resolveFixtureDir, resolvePatchbayRoot } from "./fixtures";
export { extractGraph } from "./graph";
export type {
  ExtractGraphOptions,
  GraphEdgeFact,
  GraphEvidenceFact,
  GraphExtraction,
  GraphNodeFact,
} from "./graph";
export { computeReextractionSet, inverseIndex } from "./invalidation";
export type { InvalidationInput, InvalidationResult } from "./invalidation";
export { mergeIncrementalExtraction, nodeComparisonKey, edgeComparisonKey } from "./merge";
