import { createHash } from "node:crypto";
import {
  patchGenerationInputSchema,
  patchPlanSchema,
  reviewVerdictSchema,
  type PatchGenerationInput,
  type PatchPlan,
  type ReviewVerdict,
} from "@patchbay/domain";
import type {
  AiProvider,
  AiProviderResult,
  PatchPlanPromptRequest,
  PlanReviewPromptRequest,
} from "@patchbay/ai-provider";

/**
 * Patchbay Agent Harness (roadmap Phase H3).
 *
 * Owns everything that must hold for ANY model/provider behind the AiProvider
 * interface: typed input, schema-conformant output, bounded context, budget
 * accounting, redacted-input digests (replay identity), and source-hash
 * binding. No database, no network, no secrets: workers/route handlers persist
 * the artifacts this package produces.
 *
 * Replay rule: the same PatchGenerationInput digest + the same template
 * version must produce the same output for the deterministic mock; real
 * providers are recorded, never replayed as truth.
 */

export const PROMPT_TEMPLATE_VERSION = "h3-plan-v1";

/** Per-call cost table (USD per 1M tokens), 0 for deterministic providers. */
const MODEL_PRICE_CENTS_PER_MILLION: Record<string, { input: number; output: number }> = {
  mock: { input: 0, output: 0 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
};

export class PlanSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanSchemaError";
  }
}

export class BudgetExceededError extends Error {
  constructor(
    public readonly budgetCents: number,
    public readonly estimatedCents: number,
  ) {
    super(
      `AI run budget exceeded: estimated ${estimatedCents} cents > budget ${budgetCents} cents`,
    );
    this.name = "BudgetExceededError";
  }
}

/** sha256 of the canonical JSON of the bounded input: replay identity, never secrets. */
export function hashInput(input: PatchGenerationInput): string {
  const parsed = patchGenerationInputSchema.parse(input);
  return createHash("sha256").update(JSON.stringify(parsed)).digest("hex");
}

/** Bounded, provider-facing context. Sizes are schema-bounded upstream. */
export function buildPlannerRequest(input: PatchGenerationInput): PatchPlanPromptRequest {
  const parsed = patchGenerationInputSchema.parse(input);
  return {
    templateVersion: PROMPT_TEMPLATE_VERSION,
    vendorSlug: parsed.vendorSlug,
    packageName: parsed.packageName,
    fromVersion: parsed.fromVersion,
    toVersion: parsed.toVersion,
    breaking: parsed.breaking,
    resolvedVersion: parsed.resolvedVersion,
    declaredRange: parsed.declaredRange,
    drafts: parsed.drafts.map((draft) => ({
      changeType: draft.changeType,
      oldValue: draft.oldValue,
      newValue: draft.newValue,
      description: draft.description,
      breaking: draft.breaking,
      affectedSymbols: draft.affectedSymbols,
      rule: draft.rule,
    })),
    modules: parsed.modules.map((module) => ({
      filePath: module.filePath,
      edgeKinds: module.edgeKinds,
      evidenceCount: module.evidenceCount,
    })),
  };
}

export interface PlannerRollup {
  plan: PatchPlan;
  result: AiProviderResult;
  costEstimateCents: number;
}

/**
 * One planner model call: validated transport output -> typed PatchPlan.
 * Release/repository ids and source hashes are NOT model knowledge: the
 * harness binds ids here and the patch engine binds source hashes against the
 * real repository at apply time (bindSourceHashes).
 */
export async function runPlanner(
  provider: AiProvider,
  input: PatchGenerationInput,
  options: { budgetCents?: number } = {},
): Promise<PlannerRollup> {
  const budgetCents = options.budgetCents ?? 100;
  const request = buildPlannerRequest(input);
  const result = await provider.generatePatchPlan(request);
  const costEstimateCents = estimateCostCents(result);
  if (costEstimateCents > budgetCents) {
    throw new BudgetExceededError(budgetCents, costEstimateCents);
  }

  const parsed = patchPlanSchema.safeParse(result.output);
  if (!parsed.success) {
    throw new PlanSchemaError(
      `planner output failed patchPlanSchema: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  return {
    plan: {
      ...parsed.data,
      releaseRecordId: input.releaseRecordId,
      repositoryId: input.repositoryId,
    },
    result,
    costEstimateCents,
  };
}

export interface ReviewRollup {
  verdict: ReviewVerdict;
  result: AiProviderResult;
  costEstimateCents: number;
}

/** Independent reviewer model call. Deliberately receives the same evidence plus the plan. */
export async function runReviewer(
  provider: AiProvider,
  plan: PatchPlan,
  evidence: { modules: Array<{ filePath: string; edgeKinds: string[] }> },
  release: {
    packageName: string;
    fromVersion: string | null;
    toVersion: string;
    breaking: boolean;
  },
  options: { budgetCents?: number } = {},
): Promise<ReviewRollup> {
  const budgetCents = options.budgetCents ?? 100;
  const request: PlanReviewPromptRequest = {
    templateVersion: PROMPT_TEMPLATE_VERSION,
    packageName: release.packageName,
    fromVersion: release.fromVersion,
    toVersion: release.toVersion,
    breaking: release.breaking,
    plan: {
      rationale: plan.rationale,
      confidence: plan.confidence,
      edits: plan.edits.map((edit) => ({
        filePath: edit.filePath,
        operation: edit.operation,
        description: edit.description,
      })),
      addressedSymbols: plan.addressedSymbols,
    },
    evidence,
  };
  const result = await provider.reviewPatchPlan(request);
  const costEstimateCents = estimateCostCents(result);
  if (costEstimateCents > budgetCents) {
    throw new BudgetExceededError(budgetCents, costEstimateCents);
  }

  const parsed = reviewVerdictSchema.safeParse(result.output);
  if (!parsed.success) {
    throw new PlanSchemaError(
      `reviewer output failed reviewVerdictSchema: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  return { verdict: parsed.data, result, costEstimateCents };
}

/**
 * Deterministic binding step: replace placeholder source hashes with the real
 * sha256 of each target file, and drop edits whose file is not in the fixture
 * (invalidated). The persisted plan is always fully hash-bound.
 */
export function bindSourceHashes(
  plan: PatchPlan,
  fileHashes: Map<string, string>,
): { plan: PatchPlan; invalidated: Array<{ filePath: string; reason: string }> } {
  const invalidated: Array<{ filePath: string; reason: string }> = [];
  const edits = [];
  for (const edit of plan.edits) {
    const fileHash = fileHashes.get(edit.filePath);
    if (fileHash === undefined) {
      invalidated.push({
        filePath: edit.filePath,
        reason: "file not found in repository snapshot",
      });
      continue;
    }
    edits.push({ ...edit, expectedSourceHash: fileHash });
  }
  return {
    plan: { ...plan, edits },
    invalidated,
  };
}

export function estimateCostCents(result: AiProviderResult): number {
  const model = result.usage?.model ?? "mock";
  const price = MODEL_PRICE_CENTS_PER_MILLION[model] ?? MODEL_PRICE_CENTS_PER_MILLION.mock!;
  const inputTokens = result.usage?.inputTokens ?? 0;
  const outputTokens = result.usage?.outputTokens ?? 0;
  const cents = (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
  return Math.ceil(cents * 100);
}

export {
  defineWorkflow,
  digestJson,
  planReplay,
  defaultFailureClassifier,
  WorkflowAbortedError,
  WorkflowDefinitionError,
  WorkflowToolError,
} from "./workflow";
export type {
  GateCheckInput,
  GateResult,
  JsonObject,
  JsonValue,
  ReplayPlan,
  StepContext,
  StepRecord,
  ToolCallRecord,
  WorkflowDefinition,
  WorkflowFailure,
  WorkflowFailureKind,
  WorkflowGate,
  WorkflowHandle,
  WorkflowRunOptions,
  WorkflowRunResult,
  WorkflowStep,
  WorkflowStepStatus,
} from "./workflow";
