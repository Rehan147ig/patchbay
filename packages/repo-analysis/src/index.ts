export { analyzeRepository } from "./analyzer";
export type {
  AnalysisProgress,
  AnalysisStage,
  AnalyzeRepositoryOptions,
  AnalysisError,
  AnalyzedUsage,
  FacadeAttribution,
  ModuleExports,
  PackageManifest,
  PackageManager,
  PythonManifest,
  RelativeModuleResolver,
  RepositoryAnalysis,
} from "./types";
export { extractJavaUsages, javaSyntaxCheck, matchesTrackSet, parseJavaManifest } from "./java";
export {
  extractPythonUsages,
  parsePythonManifest,
  parsePyProjectToml,
  parseRequirementsTxt,
  pythonSyntaxCheck,
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
export { findHttpCallsites } from "./http-matcher";
export type { CanonicalHttpCallsite } from "./http-matcher";
export { contractConsumersFromExtraction } from "./consumers";
export type {
  ConsumerEvidence,
  ConsumerMappingInput,
  ContractConsumerDescriptor,
} from "./consumers";
