import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { RulePack } from "@patchbay/domain";
import { MockAiProvider } from "@patchbay/ai-provider";
import {
  agentTools,
  buildAgentWorkflowInput,
  checkPackBudget,
  createAgentWorkflow,
  type AgentRunWithRelations,
  type FactsJson,
  type StepRecording,
} from "./agent-workflow";

vi.mock("@patchbay/db", () => ({
  prisma: {},
  packageImpact: vi.fn(),
}));

vi.mock("@patchbay/repo-analysis", () => ({
  resolveFixtureDir: (name: string) => `fixtures/${name}`,
}));

vi.mock("./audit", () => ({
  writeAuditEvent: vi.fn(),
}));

const RUN: AgentRunWithRelations = {
  id: "run-1",
  organizationId: "org-acme",
  releaseRecordId: "rel-1",
  repositoryId: "repo-1",
  releaseRepositoryMatchId: "match-1",
  remediationCaseId: null,
  status: "QUEUED",
  repository: { metadata: {} },
  match: { dependency: { commitSha: "abc123", resolvedVersion: null, declaredRange: null } },
  releaseRecord: {
    version: "4.0.0",
    product: { packageName: "openai", vendor: { slug: "openai" } },
    classifications: [],
  },
  inputJson: null,
  outputJson: null,
  budgetCents: null,
  model: null,
  provider: null,
  startedAt: null,
};

const FACTS: FactsJson = {
  fromVersion: "3.3.0",
  toVersion: "4.0.0",
  breaking: false,
  changeDrafts: [
    {
      changeType: "METHOD_RENAMED",
      oldValue: "openai.createChatCompletion",
      newValue: "openai.chat.completions.create",
      description: "renamed",
      breaking: false,
      affectedSymbols: ["openai.createChatCompletion"],
      rule: "method-rename",
    },
  ],
};

function recordingHarness() {
  const recordings: StepRecording[] = [];
  const recordStep = async (recording: StepRecording) => {
    recordings.push(recording);
  };
  return { recordings, recordStep };
}

describe("agent workflow (Phase H4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs analyst -> planner -> reviewer with separate tool allowlists and green gates", async () => {
    const { packageImpact } = await import("@patchbay/db");
    vi.mocked(packageImpact).mockResolvedValue({
      modules: [
        { filePath: "src/chat/chat-service.ts", edgeKinds: ["INVOKES_API"], evidenceCount: 1 },
      ],
      resolvedVersion: "3.3.0",
      declaredRanges: "^3.3.0",
      snapshotId: "snap-1",
    } as never);

    const { recordings, recordStep } = recordingHarness();
    const workflow = createAgentWorkflow({
      run: RUN,
      provider: new MockAiProvider(),
      budgetCents: 0,
      snapshot: null,
      recordStep,
      isCancelled: async () => false,
    });
    const input = buildAgentWorkflowInput(RUN, FACTS);

    const result = await workflow.run(input as never, {
      tools: agentTools({ run: RUN, facts: FACTS }),
    });

    expect(result.status).toBe("SUCCEEDED");
    expect(result.steps.map((step) => [step.stepId, step.status])).toEqual([
      ["release-analyst", "COMPLETED"],
      ["impact-analyst", "COMPLETED"],
      ["planner", "COMPLETED"],
      ["reviewer", "COMPLETED"],
    ]);
    expect(result.gates.map((gate) => [gate.gateId, gate.passed])).toEqual([
      ["plan-gate", true],
      ["review-gate", true],
    ]);

    const toolCalls = recordings.flatMap((recording) =>
      recording.kind === "TOOL_CALL" ? [recording.toolName] : [],
    );
    expect(toolCalls).toEqual(["getReleaseFacts", "getAffectedUsageSubgraph"]);
    expect(recordings.map((recording) => recording.role)).toEqual([
      "ANALYST",
      "ANALYST",
      "PLANNER",
      "REVIEWER",
    ]);
    expect(recordings.every((recording) => /^[0-9a-f]{64}$/.test(recording.inputDigest))).toBe(
      true,
    );
  });

  it("records failed gates when a breaking change yields no edits", async () => {
    const { packageImpact } = await import("@patchbay/db");
    vi.mocked(packageImpact).mockResolvedValue(null as never);

    const { recordStep } = recordingHarness();
    const workflow = createAgentWorkflow({
      run: RUN,
      provider: new MockAiProvider(),
      budgetCents: 0,
      snapshot: null,
      recordStep,
      isCancelled: async () => false,
    });
    const input = buildAgentWorkflowInput(RUN, { ...FACTS, breaking: true });

    const result = await workflow.run(input as never, {
      tools: agentTools({ run: RUN, facts: { ...FACTS, breaking: true } }),
    });

    expect(result.status).toBe("SUCCEEDED");
    expect(result.gates.map((gate) => [gate.gateId, gate.passed])).toEqual([
      ["plan-gate", false],
      ["review-gate", false],
    ]);
    const planGate = result.gates.find((gate) => gate.gateId === "plan-gate")!;
    expect(planGate.detail).toBe("no edits proposed for a breaking change");
    const reviewGate = result.gates.find((gate) => gate.gateId === "review-gate")!;
    expect(reviewGate.detail).toContain("Independent review failed");
  });

  it("cancellation aborts before a step runs and maps to ABORTED", async () => {
    const { recordStep } = recordingHarness();
    const workflow = createAgentWorkflow({
      run: RUN,
      provider: new MockAiProvider(),
      budgetCents: 0,
      snapshot: null,
      recordStep,
      isCancelled: async () => true,
    });
    const input = buildAgentWorkflowInput(RUN, FACTS);

    const result = await workflow.run(input as never, {
      tools: agentTools({ run: RUN, facts: FACTS }),
    });

    expect(result.status).toBe("FAILED");
    expect(result.failure?.kind).toBe("ABORTED");
    expect(result.steps.map((step) => [step.stepId, step.status])).toEqual([
      ["release-analyst", "FAILED"],
      ["impact-analyst", "FAILED"],
      ["planner", "SKIPPED"],
      ["reviewer", "SKIPPED"],
    ]);
    expect(result.steps.filter((step) => step.failure?.kind === "ABORTED")).toHaveLength(2);
  });

  it("maps planner budget overruns to BUDGET_EXCEEDED and skips the reviewer", async () => {
    const { recordStep } = recordingHarness();
    const workflow = createAgentWorkflow({
      run: RUN,
      provider: {
        generatePatchPlan: async () => {
          const error = new Error("AI run budget exceeded: estimated 200 cents > budget 0 cents");
          error.name = "BudgetExceededError";
          throw error;
        },
        reviewPatchPlan: async () => {
          const error = new Error("should never run");
          error.name = "BudgetExceededError";
          throw error;
        },
      } as never,
      budgetCents: 0,
      snapshot: null,
      recordStep,
      isCancelled: async () => false,
    });
    const input = buildAgentWorkflowInput(RUN, FACTS);

    const result = await workflow.run(input as never, {
      tools: agentTools({ run: RUN, facts: FACTS }),
    });

    expect(result.status).toBe("FAILED");
    expect(result.failure?.kind).toBe("BUDGET_EXCEEDED");
    expect(result.failure?.stepId).toBe("planner");
    expect(result.steps.map((step) => [step.stepId, step.status])).toEqual([
      ["release-analyst", "COMPLETED"],
      ["impact-analyst", "COMPLETED"],
      ["planner", "FAILED"],
      ["reviewer", "SKIPPED"],
    ]);
  });

  it("replays from the failed step with verified carried inputs", async () => {
    const { recordStep } = recordingHarness();
    const failingProvider = {
      generatePatchPlan: async () => {
        const error = new Error("AI run budget exceeded: estimated 200 cents > budget 0 cents");
        error.name = "BudgetExceededError";
        throw error;
      },
      reviewPatchPlan: async () => ({ output: {}, usage: {} }),
    } as never;

    const failingWorkflow = createAgentWorkflow({
      run: RUN,
      provider: failingProvider,
      budgetCents: 0,
      snapshot: null,
      recordStep,
      isCancelled: async () => false,
    });
    const input = buildAgentWorkflowInput(RUN, FACTS);

    const failed = await failingWorkflow.run(input as never, {
      tools: agentTools({ run: RUN, facts: FACTS }),
    });
    expect(failed.status).toBe("FAILED");
    expect(failed.failure?.stepId).toBe("planner");

    const successWorkflow = createAgentWorkflow({
      run: RUN,
      provider: new MockAiProvider(),
      budgetCents: 0,
      snapshot: null,
      recordStep,
      isCancelled: async () => false,
    });
    const succeeded = await successWorkflow.replay(failed.steps, "planner", input as never, {
      tools: agentTools({ run: RUN, facts: FACTS }),
    });

    expect(succeeded.status).toBe("SUCCEEDED");
    expect(succeeded.replayedFromStepId).toBe("planner");
    expect(succeeded.steps.map((step) => [step.stepId, step.status])).toEqual([
      ["release-analyst", "COMPLETED"],
      ["impact-analyst", "COMPLETED"],
      ["planner", "COMPLETED"],
      ["reviewer", "COMPLETED"],
    ]);
    expect(succeeded.gates.map((gate) => [gate.gateId, gate.passed])).toEqual([
      ["plan-gate", true],
      ["review-gate", true],
    ]);
  });
});

describe("pack budgets (WP6 packs, WP7 enforcement)", () => {
  const PACK: RulePack = {
    packVersion: "test/1.0.0",
    vendorSlug: "openai",
    contractKind: "SDK",
    supportedChanges: ["METHOD_RENAMED"],
    editBudget: { maxFiles: 1, maxEditsPerFile: 2, maxTotalBytes: 50_000 },
    expectedEvidence: { requiresSourceHash: true, requiresLockfileVersion: true, minUsages: 1 },
    validationProfile: "node-ts-reparse",
    riskTags: [],
    rollback: { strategy: "revert-commit", instructions: "Revert." },
  };

  it("checkPackBudget passes fitting plans and names every violated dimension", () => {
    expect(checkPackBudget([{ filePath: "a.ts" }], PACK)).toEqual([]);
    expect(checkPackBudget([], PACK)).toEqual([]);
    const over = checkPackBudget(
      [{ filePath: "a.ts" }, { filePath: "a.ts" }, { filePath: "a.ts" }, { filePath: "b.ts" }],
      PACK,
    );
    expect(over.join(" ")).toContain("2 files > pack max 1");
    expect(over.join(" ")).toContain("3 edits in one file > pack max 2");
    expect(over).toHaveLength(2);
  });

  it("buildAgentWorkflowInput carries the pack (null by default)", () => {
    expect(buildAgentWorkflowInput(RUN, FACTS).rulePack).toBeNull();
    expect(buildAgentWorkflowInput(RUN, FACTS, { ...PACK }).rulePack?.packVersion).toBe(
      "test/1.0.0",
    );
  });

  it("fails the run BUDGET_EXCEEDED when the planner exceeds the pack (reviewer skipped)", async () => {
    const { packageImpact } = await import("@patchbay/db");
    vi.mocked(packageImpact).mockResolvedValue({
      modules: [
        { filePath: "src/a.ts", edgeKinds: ["INVOKES_API"], evidenceCount: 1 },
        { filePath: "src/b.ts", edgeKinds: ["INVOKES_API"], evidenceCount: 1 },
      ],
      resolvedVersion: "4.0.0",
      declaredRanges: "^4.0.0",
      snapshotId: "snap-1",
    } as never);

    const editsIn = (file: string, n: number) =>
      Array.from({ length: n }, (_, i) => ({
        filePath: file,
        expectedSourceHash: "0".repeat(64),
        operation: "REPLACE",
        description: `edit ${i}`,
        confidence: 90,
      }));
    const provider = {
      generatePatchPlan: async () => ({
        output: {
          releaseRecordId: "<bound>",
          repositoryId: "<bound>",
          rationale: "stubbed over-budget plan",
          confidence: 85,
          requiresHumanReview: false,
          riskLevel: "LOW",
          riskTags: [],
          edits: [...editsIn("src/a.ts", 2), ...editsIn("src/b.ts", 1)],
          validationProfile: ["typecheck"],
          addressedSymbols: ["openai.createChatCompletion"],
        },
        usage: { inputTokens: 0, outputTokens: 0, model: "mock" },
        requestId: null,
        latencyMs: 0,
        provider: "mock",
      }),
      reviewPatchPlan: async () => {
        throw new Error("reviewer must never run after a pack-budget failure");
      },
    } as never;

    const { recordings, recordStep } = recordingHarness();
    // Snapshot manifest so binding keeps the stubbed edits (unbound edits are
    // invalidated before the pack gate ever sees them). Uses the same
    // snapshot contract as production — no fixture-only path.
    const fixtureDir = mkdtempSync(path.join(tmpdir(), "patchbay-pack-budget-"));
    try {
      mkdirSync(path.join(fixtureDir, "src"), { recursive: true });
      writeFileSync(path.join(fixtureDir, "src", "a.ts"), "export const a = 1;\n");
      writeFileSync(path.join(fixtureDir, "src", "b.ts"), "export const b = 2;\n");
      const { createHash } = await import("node:crypto");
      const { readFileSync } = await import("node:fs");
      const manifest = new Map<string, string>([
        [
          "src/a.ts",
          createHash("sha256")
            .update(readFileSync(path.join(fixtureDir, "src", "a.ts")))
            .digest("hex"),
        ],
        [
          "src/b.ts",
          createHash("sha256")
            .update(readFileSync(path.join(fixtureDir, "src", "b.ts")))
            .digest("hex"),
        ],
      ]);
      const workflow = createAgentWorkflow({
        run: RUN,
        provider,
        budgetCents: 0,
        snapshot: {
          snapshotId: "snap-test",
          commitSha: "abc123",
          treeHash: "tree-test",
          manifestHash: "manifest-test",
          manifest,
          excerpts: [],
        },
        recordStep,
        isCancelled: async () => false,
        rulePack: { ...PACK },
      });
      const input = buildAgentWorkflowInput(RUN, FACTS, { ...PACK });

      const result = await workflow.run(input as never, {
        tools: agentTools({ run: RUN, facts: FACTS }),
      });

      expect(result.status).toBe("FAILED");
      expect(result.failure?.kind).toBe("BUDGET_EXCEEDED");
      expect(result.failure?.stepId).toBe("planner");
      expect(result.failure?.message).toContain("test/1.0.0");
      expect(result.steps.map((step) => [step.stepId, step.status])).toEqual([
        ["release-analyst", "COMPLETED"],
        ["impact-analyst", "COMPLETED"],
        ["planner", "FAILED"],
        ["reviewer", "SKIPPED"],
      ]);
      expect(recordings.some((recording) => recording.role === "REVIEWER")).toBe(false);
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });
});
