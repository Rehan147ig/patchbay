import { performance } from "node:perf_hooks";
import type { PatchGenerationInput } from "@patchbay/domain";
import type { AiProvider } from "@patchbay/ai-provider";
import { runPlanner, runReviewer } from "./index";

/**
 * WP8: planner/reviewer performance measurement, provider-neutral.
 *
 * Runs the bounded planner -> independent-reviewer sequence repeatedly and
 * aggregates wall-clock latency (harness call, including transport + schema
 * validation), provider-reported latency, token usage, and cost estimate.
 * Budget enforcement and schema validation run for every round, so failures
 * are the same classified failures production sees (BudgetExceededError,
 * PlanSchemaError, provider errors). Never a truth claim: deterministic mock
 * mode measures harness overhead; live mode (`AI_PROVIDER=ai-sdk` + key)
 * measures real provider latency.
 */

export type BenchStep = "planner" | "reviewer";

export interface StepLatencyStats {
  count: number;
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
}

export interface StepSummary {
  ok: number;
  failures: number;
  errorExamples: string[];
  latency: StepLatencyStats;
  providerLatency: StepLatencyStats;
  inputTokens: number;
  outputTokens: number;
  costEstimateCents: number;
}

export interface BenchmarkThresholds {
  maxP95LatencyMs: number;
  maxFailureRate: number;
  maxTotalCostCents: number;
}

export interface BenchmarkReport {
  templateVersion: string;
  provider: string;
  rounds: number;
  startedAt: string;
  durationMs: number;
  thresholds: BenchmarkThresholds;
  byStep: Record<BenchStep, StepSummary>;
  totals: {
    latency: StepLatencyStats;
    failures: number;
    inputTokens: number;
    outputTokens: number;
    costEstimateCents: number;
  };
  verdict: "PASS" | "FAIL";
}

export interface MeasureWorkflowOptions {
  rounds?: number;
  budgetCents?: number;
  signal?: AbortSignal;
  thresholds?: Partial<BenchmarkThresholds>;
}

const DEFAULT_THRESHOLDS: BenchmarkThresholds = {
  maxP95LatencyMs: 15_000,
  maxFailureRate: 0.2,
  maxTotalCostCents: 100,
};

export const DEFAULT_ROUNDS = 5;

/** Nearest-rank percentile over sorted values; 0 for an empty sample. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1] ?? 0;
}

interface StepSample {
  ok: boolean;
  wallMs: number;
  providerMs: number | null;
  inputTokens: number;
  outputTokens: number;
  costEstimateCents: number;
  error: string | null;
}

export async function measureWorkflow(
  provider: AiProvider,
  input: PatchGenerationInput,
  options: MeasureWorkflowOptions = {},
): Promise<BenchmarkReport> {
  const rounds = Math.max(1, Math.floor(options.rounds ?? DEFAULT_ROUNDS));
  const thresholds: BenchmarkThresholds = {
    ...DEFAULT_THRESHOLDS,
    ...options.thresholds,
  };
  const startedAt = Date.now();
  const planner: StepSample[] = [];
  const reviewer: StepSample[] = [];

  for (let round = 0; round < rounds; round++) {
    const planStart = performance.now();
    try {
      const { plan, costEstimateCents, result } = await runPlanner(provider, input, {
        budgetCents: options.budgetCents,
        signal: options.signal,
      });
      planner.push(sample(true, planStart, result.latencyMs ?? null, result, costEstimateCents));

      const reviewStart = performance.now();
      try {
        const { costEstimateCents: reviewCents, result: reviewResult } = await runReviewer(
          provider,
          plan,
          { modules: input.modules.map((m) => ({ filePath: m.filePath, edgeKinds: m.edgeKinds })) },
          {
            packageName: input.packageName,
            fromVersion: input.fromVersion,
            toVersion: input.toVersion,
            breaking: input.breaking,
          },
          { budgetCents: options.budgetCents, signal: options.signal },
        );
        reviewer.push(
          sample(true, reviewStart, reviewResult.latencyMs ?? null, reviewResult, reviewCents),
        );
      } catch (error) {
        reviewer.push(failedSample(reviewStart, error));
      }
    } catch (error) {
      planner.push(failedSample(planStart, error));
    }
  }

  const byStep = {
    planner: summarize(planner),
    reviewer: summarize(reviewer),
  };
  const failures = byStep.planner.failures + byStep.reviewer.failures;
  const failureRate = failures / (rounds * 2);
  const totalLatency = mergeLatency([...planner, ...reviewer]);
  const totals = {
    latency: totalLatency,
    failures,
    inputTokens: byStep.planner.inputTokens + byStep.reviewer.inputTokens,
    outputTokens: byStep.planner.outputTokens + byStep.reviewer.outputTokens,
    costEstimateCents: byStep.planner.costEstimateCents + byStep.reviewer.costEstimateCents,
  };
  const verdict =
    totalLatency.p95Ms <= thresholds.maxP95LatencyMs &&
    failureRate <= thresholds.maxFailureRate &&
    totals.costEstimateCents <= thresholds.maxTotalCostCents
      ? "PASS"
      : "FAIL";

  return {
    templateVersion: "wp8-bench-v1",
    provider: provider.constructor.name,
    rounds,
    startedAt: new Date(startedAt).toISOString(),
    durationMs: Date.now() - startedAt,
    thresholds,
    byStep,
    totals,
    verdict,
  };
}

function sample(
  ok: boolean,
  start: number,
  providerMs: number | null,
  result: { usage?: { inputTokens?: number; outputTokens?: number } | null },
  costEstimateCents: number,
): StepSample {
  return {
    ok,
    wallMs: Math.round((performance.now() - start) * 100) / 100,
    providerMs,
    inputTokens: result.usage?.inputTokens ?? 0,
    outputTokens: result.usage?.outputTokens ?? 0,
    costEstimateCents,
    error: null,
  };
}

function failedSample(start: number, error: unknown): StepSample {
  return {
    ok: false,
    wallMs: Math.round((performance.now() - start) * 100) / 100,
    providerMs: null,
    inputTokens: 0,
    outputTokens: 0,
    costEstimateCents: 0,
    error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
  };
}

function summarize(samples: StepSample[]): StepSummary {
  const ok = samples.filter((sample) => sample.ok);
  const failed = samples.filter((sample) => !sample.ok);
  return {
    ok: ok.length,
    failures: failed.length,
    errorExamples: failed
      .map((sample) => sample.error)
      .filter((error): error is string => error !== null)
      .slice(0, 3),
    latency: latencyStats(samples.map((sample) => sample.wallMs)),
    providerLatency: latencyStats(
      samples.map((sample) => sample.providerMs).filter((ms): ms is number => ms !== null),
    ),
    inputTokens: samples.reduce((sum, sample) => sum + sample.inputTokens, 0),
    outputTokens: samples.reduce((sum, sample) => sum + sample.outputTokens, 0),
    costEstimateCents: samples.reduce((sum, sample) => sum + sample.costEstimateCents, 0),
  };
}

function latencyStats(values: number[]): StepLatencyStats {
  return {
    count: values.length,
    meanMs: values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : 0,
    p50Ms: percentile(values, 50),
    p95Ms: percentile(values, 95),
    maxMs: values.length > 0 ? Math.max(...values) : 0,
  };
}

function mergeLatency(samples: StepSample[]): StepLatencyStats {
  return latencyStats(samples.map((sample) => sample.wallMs));
}
