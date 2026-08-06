import type { GenerationMethod } from "@patchbay/domain";
import type { NormalizedChangeDraft, PatchSuggestion } from "@patchbay/vendor-connectors";

/**
 * Pure remediation-plan drafts. The engine never touches the DB: it reads
 * repository files from a fixture/workspace path and produces the structured
 * artifacts that web/worker persist on `RemediationPlan` + `PatchArtifact`.
 */

export interface PlanUsage {
  /** Path relative to the repository root, posix separators. */
  filePath: string;
  /** 1-based source line of the usage. */
  line: number;
  /** Indexed symbol, e.g. "openai.createChatCompletion". */
  symbol: string;
  /** The source line text the usage sits on. */
  excerpt: string;
}

export interface PlanInput {
  /** Absolute path to the repository snapshot (fixture dir). */
  fixtureDir: string;
  repositoryName: string;
  /** Usages matched by the impact assessment (affected only). */
  usages: PlanUsage[];
  patchSuggestions: PatchSuggestion[];
  normalizations: NormalizedChangeDraft[];
  /** Assessment confidence, used when no rule applies (plan-only fallback). */
  assessmentConfidence: number;
}

export interface PatchDraft {
  filePath: string;
  original: string;
  patched: string;
  unifiedDiff: string;
  originalHash: string;
  patchedHash: string;
  generationMethod: GenerationMethod;
  confidence: number;
  description: string;
}

export interface PlanDraft {
  strategy: string;
  proposedChanges: Array<{ description: string; filePath: string }>;
  confidence: number;
  requiresHumanReview: boolean;
  patches: PatchDraft[];
  /** Files skipped because the patched content failed syntax re-parse. */
  skippedFiles: string[];
}
