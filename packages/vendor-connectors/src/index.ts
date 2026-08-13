export { openaiConnector } from "./connectors/openai";
export { connectors, getConnector } from "./registry";
export { defineConnector, type ConnectorSpec, type ConnectorRule } from "./sdk";
export { assessImpact } from "./scoring";
export type { ImpactDraft, ImpactScoringInput, ImpactScoringUsage } from "./scoring";
export type {
  NormalizeChangeInput,
  NormalizedChangeDraft,
  PatchSuggestion,
  VendorConnector,
} from "./types";
export {
  getWatchtowerAdapters,
  getWatchtowerAdapter,
  getAdaptersBySource,
  resetWatchtowerAdapterCache,
} from "./adapters/registry";
export type {
  WatchtowerAdapter,
  WatchtowerEvidence,
  NormalizedRelease,
  DetectOptions,
  DetectionRunResult,
  AdapterCursor,
  AdapterPollResult,
} from "./watchtower";
export { diffOpenApiSpecs } from "./adapters/openapi-diff";
export type { OpenApiDiffFacts, OpenApiChangedOperation } from "./adapters/openapi-diff";
