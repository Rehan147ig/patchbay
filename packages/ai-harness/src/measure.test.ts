import { describe, expect, it } from "vitest";
import { MockAiProvider } from "@patchbay/ai-provider";
import type { AiProvider, AiProviderResult } from "@patchbay/ai-provider";
import type { PatchGenerationInput } from "@patchbay/domain";
import { measureWorkflow, percentile } from "./index";

const INPUT: PatchGenerationInput = {
  releaseRecordId: "r-4",
  repositoryId: "repo-ai",
  vendorSlug: "openai",
  packageName: "openai",
  fromVersion: "3.3.0",
  toVersion: "4.0.0",
  breaking: true,
  resolvedVersion: "3.3.0",
  declaredRange: "^3.3.0",
  drafts: [
    {
      changeType: "METHOD_RENAMED",
      oldValue: "openai.createChatCompletion",
      newValue: "openai.chat.completions.create",
      description: "Method openai.createChatCompletion was renamed.",
      breaking: true,
      affectedSymbols: ["openai.createChatCompletion"],
      rule: "method-rename",
    },
  ],
  modules: [
    {
      filePath: "src/chat/chat-service.ts",
      edgeKinds: ["INVOKES_API", "USES_PACKAGE"],
      evidenceCount: 1,
    },
  ],
};

function stubProvider(
  overrides: {
    planError?: Error;
    reviewError?: Error;
    planUsage?: AiProviderResult["usage"];
    reviewUsage?: AiProviderResult["usage"];
  } = {},
) {
  const mock = new MockAiProvider();
  const provider: AiProvider = {
    draftRemediationPlan: (input) => mock.draftRemediationPlan(input),
    generatePatchPlan: async (input, options) => {
      if (overrides.planError) {
        throw overrides.planError;
      }
      const result = await mock.generatePatchPlan(input, options);
      return overrides.planUsage ? { ...result, usage: overrides.planUsage } : result;
    },
    reviewPatchPlan: async (input, options) => {
      if (overrides.reviewError) {
        throw overrides.reviewError;
      }
      const result = await mock.reviewPatchPlan(input, options);
      return overrides.reviewUsage ? { ...result, usage: overrides.reviewUsage } : result;
    },
  };
  return provider;
}

describe("percentile", () => {
  it("computes nearest-rank percentiles", () => {
    expect(percentile([1, 2, 3, 4, 5], 50)).toBe(3);
    expect(percentile([1, 2, 3, 4, 5], 95)).toBe(5);
    expect(percentile([1, 2, 3, 4], 50)).toBe(2);
    expect(percentile([10, 10, 10], 50)).toBe(10);
  });

  it("returns 0 for an empty sample", () => {
    expect(percentile([], 95)).toBe(0);
  });
});

describe("measureWorkflow", () => {
  it("reports a PASS for the deterministic mock across rounds", async () => {
    const report = await measureWorkflow(new MockAiProvider(), INPUT, { rounds: 3 });

    expect(report.verdict).toBe("PASS");
    expect(report.rounds).toBe(3);
    expect(report.provider).toBe("MockAiProvider");
    expect(report.byStep.planner.ok).toBe(3);
    expect(report.byStep.planner.failures).toBe(0);
    expect(report.byStep.reviewer.ok).toBe(3);
    expect(report.byStep.reviewer.failures).toBe(0);
    expect(report.byStep.planner.costEstimateCents).toBe(0);
    expect(report.totals.failures).toBe(0);
    expect(report.totals.latency.count).toBe(6);
    expect(report.totals.latency.p95Ms).toBeGreaterThanOrEqual(0);
  });

  it("counts reviewer failures and fails the verdict", async () => {
    const report = await measureWorkflow(
      stubProvider({ reviewError: new Error("review backend down") }),
      INPUT,
      { rounds: 4 },
    );

    expect(report.byStep.planner.ok).toBe(4);
    expect(report.byStep.reviewer.failures).toBe(4);
    expect(report.byStep.reviewer.errorExamples).toContain("Error: review backend down");
    expect(report.totals.failures).toBe(4);
    expect(report.verdict).toBe("FAIL");
  });

  it("counts planner failures and skips the reviewer for that round", async () => {
    const report = await measureWorkflow(
      stubProvider({ planError: new Error("planner refused") }),
      INPUT,
      { rounds: 2 },
    );

    expect(report.byStep.planner.failures).toBe(2);
    expect(report.byStep.reviewer.ok).toBe(0);
    expect(report.byStep.reviewer.latency.count).toBe(0);
    expect(report.totals.failures).toBe(2);
    expect(report.verdict).toBe("FAIL");
  });

  it("caps error examples at three", async () => {
    const report = await measureWorkflow(stubProvider({ reviewError: new Error("boom") }), INPUT, {
      rounds: 8,
    });

    expect(report.byStep.reviewer.errorExamples).toHaveLength(3);
  });

  it("aggregates token usage and cost from provider results", async () => {
    const report = await measureWorkflow(
      stubProvider({
        planUsage: { inputTokens: 10_000, outputTokens: 2_000, model: "gpt-4o-mini" },
        reviewUsage: { inputTokens: 5_000, outputTokens: 1_000, model: "gpt-4o-mini" },
      }),
      INPUT,
      { rounds: 2 },
    );

    expect(report.byStep.planner.inputTokens).toBe(20_000);
    expect(report.byStep.planner.outputTokens).toBe(4_000);
    expect(report.byStep.reviewer.inputTokens).toBe(10_000);
    expect(report.byStep.reviewer.outputTokens).toBe(2_000);
    expect(report.totals.costEstimateCents).toBeGreaterThan(0);
    expect(report.verdict).toBe("PASS");
  });

  it("fails the verdict when the cost threshold is exceeded", async () => {
    const report = await measureWorkflow(
      stubProvider({
        planUsage: { inputTokens: 100_000_000, outputTokens: 0, model: "gpt-4o-mini" },
        reviewUsage: { inputTokens: 0, outputTokens: 0, model: "gpt-4o-mini" },
      }),
      INPUT,
      { rounds: 1, budgetCents: 10_000, thresholds: { maxTotalCostCents: 1_000 } },
    );

    expect(report.totals.costEstimateCents).toBeGreaterThan(1_000);
    expect(report.verdict).toBe("FAIL");
  });

  it("fails the verdict when the latency threshold is exceeded", async () => {
    const report = await measureWorkflow(new MockAiProvider(), INPUT, {
      rounds: 2,
      thresholds: { maxP95LatencyMs: -1 },
    });

    expect(report.verdict).toBe("FAIL");
  });

  it("applies the per-round budget through the existing harness", async () => {
    const report = await measureWorkflow(
      stubProvider({
        planUsage: { inputTokens: 100_000_000, outputTokens: 0, model: "gpt-4o-mini" },
      }),
      INPUT,
      { rounds: 2, budgetCents: 0 },
    );

    expect(report.byStep.planner.failures).toBe(2);
    expect(report.byStep.planner.errorExamples[0]).toMatch(/budget/i);
    expect(report.verdict).toBe("FAIL");
  });
});
