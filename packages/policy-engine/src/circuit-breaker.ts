import { z } from "zod";
import { PolicyDecision, type RulePack } from "@patchbay/domain";

/**
 * Circuit breaker safety limits (P0).
 *
 * Configurable bounds that prevent runaway amplification (e.g. 1 bad recipe
 * triggering 500 repository PRs with 10,000 edits in minutes).
 *
 * Invariant: Tripping a circuit breaker NEVER throws or crashes a job.
 * It safely degrades to PLAN_ONLY / REQUIRE_APPROVAL and emits an audit event.
 */
export const CircuitBreakerLimitsSchema = z.object({
  /** Maximum repositories affected by a single change event before automated fan-out is throttled. */
  maxRepositoriesPerChangeEvent: z.number().int().positive().default(25),
  /** Maximum files in a single remediation plan before degrading to plan-only preview. */
  maxFilesPerRemediationPlan: z.number().int().positive().default(40),
  /** Maximum AST edits / transforms allowed in a single file. */
  maxEditsPerFile: z.number().int().positive().default(20),
  /** Maximum patch byte size per file (100KB default). */
  maxPatchBytesPerFile: z.number().int().positive().default(100_000),
  /** Maximum concurrent active (unmerged) draft PRs per organization. */
  maxConcurrentDraftPrsPerOrg: z.number().int().positive().default(5),
  /** Maximum graph traversal depth during invalidation queries. */
  maxGraphTraversalDepth: z.number().int().positive().default(10),
  /** Maximum graph nodes visited during query traversal. */
  maxGraphNodesVisited: z.number().int().positive().default(500),
});

export type CircuitBreakerLimits = z.infer<typeof CircuitBreakerLimitsSchema>;

/**
 * Safe starting defaults (starting points — configurable via env / org policy).
 */
export const DEFAULT_CIRCUIT_BREAKER_LIMITS: CircuitBreakerLimits = {
  maxRepositoriesPerChangeEvent: 25,
  maxFilesPerRemediationPlan: 40,
  maxEditsPerFile: 20,
  maxPatchBytesPerFile: 100_000,
  maxConcurrentDraftPrsPerOrg: 5,
  maxGraphTraversalDepth: 10,
  maxGraphNodesVisited: 500,
};

/**
 * Resolves effective plan limits for one remediation run (WP6): the pack
 * budget tightened against the global breaker caps via per-field minimum, so
 * a pack can only ever tighten safety, never loosen it. Absent pack =
 * globals unchanged (existing callers behave identically).
 *
 * Mapping note: the pack declares a plan-total byte budget while the breaker
 * checks per-file bytes; the per-file cap is bounded by the pack total, which
 * is conservative in exactly the safe direction.
 */
export function resolvePlanLimits(rulePack?: RulePack): Partial<CircuitBreakerLimits> {
  if (!rulePack) return {};
  const global = loadCircuitBreakerLimits();
  return {
    maxFilesPerRemediationPlan: Math.min(
      global.maxFilesPerRemediationPlan,
      rulePack.editBudget.maxFiles,
    ),
    maxEditsPerFile: Math.min(global.maxEditsPerFile, rulePack.editBudget.maxEditsPerFile),
    maxPatchBytesPerFile: Math.min(global.maxPatchBytesPerFile, rulePack.editBudget.maxTotalBytes),
  };
}

/**
 * Loads circuit breaker limits with optional environment variable overrides.
 */
export function loadCircuitBreakerLimits(
  overrides?: Partial<CircuitBreakerLimits>,
): CircuitBreakerLimits {
  const env: Record<string, string | undefined> =
    typeof process !== "undefined" && process.env
      ? (process.env as Record<string, string | undefined>)
      : {};

  const fromEnv: Partial<CircuitBreakerLimits> = {
    maxRepositoriesPerChangeEvent: parseEnvInt(
      env?.PATCHBAY_MAX_REPOS_PER_CHANGE,
      DEFAULT_CIRCUIT_BREAKER_LIMITS.maxRepositoriesPerChangeEvent,
    ),
    maxFilesPerRemediationPlan: parseEnvInt(
      env?.PATCHBAY_MAX_FILES_PER_PLAN,
      DEFAULT_CIRCUIT_BREAKER_LIMITS.maxFilesPerRemediationPlan,
    ),
    maxEditsPerFile: parseEnvInt(
      env?.PATCHBAY_MAX_EDITS_PER_FILE,
      DEFAULT_CIRCUIT_BREAKER_LIMITS.maxEditsPerFile,
    ),
    maxPatchBytesPerFile: parseEnvInt(
      env?.PATCHBAY_MAX_PATCH_BYTES,
      DEFAULT_CIRCUIT_BREAKER_LIMITS.maxPatchBytesPerFile,
    ),
    maxConcurrentDraftPrsPerOrg: parseEnvInt(
      env?.PATCHBAY_MAX_CONCURRENT_PRS,
      DEFAULT_CIRCUIT_BREAKER_LIMITS.maxConcurrentDraftPrsPerOrg,
    ),
    maxGraphTraversalDepth: parseEnvInt(
      env?.PATCHBAY_MAX_TRAVERSAL_DEPTH,
      DEFAULT_CIRCUIT_BREAKER_LIMITS.maxGraphTraversalDepth,
    ),
    maxGraphNodesVisited: parseEnvInt(
      env?.PATCHBAY_MAX_NODES_VISITED,
      DEFAULT_CIRCUIT_BREAKER_LIMITS.maxGraphNodesVisited,
    ),
  };

  return CircuitBreakerLimitsSchema.parse({
    ...fromEnv,
    ...overrides,
  });
}

function parseEnvInt(val: string | undefined, defaultVal: number): number {
  if (!val) return defaultVal;
  const parsed = parseInt(val, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : defaultVal;
}

export interface TrippedLimit {
  limitName: keyof CircuitBreakerLimits;
  observed: number;
  threshold: number;
  message: string;
}

export interface CircuitBreakerResult {
  ok: boolean;
  decision: PolicyDecision;
  trippedLimits: TrippedLimit[];
  reasons: string[];
}

export interface PlanLimitsInput {
  fileCount: number;
  maxEditsInAnyFile: number;
  maxPatchBytesInAnyFile: number;
}

/**
 * Evaluates plan-level circuit breakers (file count, edits per file, patch size).
 * When tripped, degrades to REQUIRE_APPROVAL or PLAN_ONLY without crashing.
 */
export function evaluatePlanCircuitBreaker(
  input: PlanLimitsInput,
  customLimits?: Partial<CircuitBreakerLimits>,
): CircuitBreakerResult {
  const limits = loadCircuitBreakerLimits(customLimits);
  const trippedLimits: TrippedLimit[] = [];
  const reasons: string[] = [];

  if (input.fileCount > limits.maxFilesPerRemediationPlan) {
    trippedLimits.push({
      limitName: "maxFilesPerRemediationPlan",
      observed: input.fileCount,
      threshold: limits.maxFilesPerRemediationPlan,
      message: `Plan modifies ${input.fileCount} files, exceeding safe automated limit of ${limits.maxFilesPerRemediationPlan}`,
    });
    reasons.push(
      `Circuit breaker: ${input.fileCount} files exceeds limit (${limits.maxFilesPerRemediationPlan})`,
    );
  }

  if (input.maxEditsInAnyFile > limits.maxEditsPerFile) {
    trippedLimits.push({
      limitName: "maxEditsPerFile",
      observed: input.maxEditsInAnyFile,
      threshold: limits.maxEditsPerFile,
      message: `File has ${input.maxEditsInAnyFile} edits, exceeding safe limit of ${limits.maxEditsPerFile}`,
    });
    reasons.push(
      `Circuit breaker: ${input.maxEditsInAnyFile} edits in a single file exceeds limit (${limits.maxEditsPerFile})`,
    );
  }

  if (input.maxPatchBytesInAnyFile > limits.maxPatchBytesPerFile) {
    trippedLimits.push({
      limitName: "maxPatchBytesPerFile",
      observed: input.maxPatchBytesInAnyFile,
      threshold: limits.maxPatchBytesPerFile,
      message: `Patch size is ${input.maxPatchBytesInAnyFile} bytes, exceeding limit of ${limits.maxPatchBytesPerFile} bytes`,
    });
    reasons.push(
      `Circuit breaker: patch size (${input.maxPatchBytesInAnyFile} bytes) exceeds limit (${limits.maxPatchBytesPerFile} bytes)`,
    );
  }

  if (trippedLimits.length > 0) {
    return {
      ok: false,
      decision: PolicyDecision.REQUIRE_APPROVAL,
      trippedLimits,
      reasons,
    };
  }

  return {
    ok: true,
    decision: PolicyDecision.ALLOW_DRAFT_PR,
    trippedLimits: [],
    reasons: [],
  };
}

export interface FanoutLimitsInput {
  repositoryCount: number;
  currentActiveDraftPrs: number;
}

/**
 * Evaluates repository fan-out and concurrent PR circuit breakers.
 */
export function evaluateFanoutCircuitBreaker(
  input: FanoutLimitsInput,
  customLimits?: Partial<CircuitBreakerLimits>,
): CircuitBreakerResult {
  const limits = loadCircuitBreakerLimits(customLimits);
  const trippedLimits: TrippedLimit[] = [];
  const reasons: string[] = [];

  if (input.repositoryCount > limits.maxRepositoriesPerChangeEvent) {
    trippedLimits.push({
      limitName: "maxRepositoriesPerChangeEvent",
      observed: input.repositoryCount,
      threshold: limits.maxRepositoriesPerChangeEvent,
      message: `Change event affects ${input.repositoryCount} repositories, exceeding automated limit of ${limits.maxRepositoriesPerChangeEvent}`,
    });
    reasons.push(
      `Circuit breaker: ${input.repositoryCount} repositories exceeds automated fan-out limit (${limits.maxRepositoriesPerChangeEvent})`,
    );
  }

  if (input.currentActiveDraftPrs >= limits.maxConcurrentDraftPrsPerOrg) {
    trippedLimits.push({
      limitName: "maxConcurrentDraftPrsPerOrg",
      observed: input.currentActiveDraftPrs,
      threshold: limits.maxConcurrentDraftPrsPerOrg,
      message: `Organization has ${input.currentActiveDraftPrs} active draft PRs, reaching limit of ${limits.maxConcurrentDraftPrsPerOrg}`,
    });
    reasons.push(
      `Circuit breaker: ${input.currentActiveDraftPrs} active draft PRs reaches organization quota (${limits.maxConcurrentDraftPrsPerOrg})`,
    );
  }

  if (trippedLimits.length > 0) {
    return {
      ok: false,
      decision: PolicyDecision.REQUIRE_APPROVAL,
      trippedLimits,
      reasons,
    };
  }

  return {
    ok: true,
    decision: PolicyDecision.ALLOW_DRAFT_PR,
    trippedLimits: [],
    reasons: [],
  };
}
