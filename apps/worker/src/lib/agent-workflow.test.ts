import { beforeEach, describe, expect, it, vi } from "vitest";
import { MockAiProvider } from "@patchbay/ai-provider";
import {
  agentTools,
  buildAgentWorkflowInput,
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
      fixturesDir: null,
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
      fixturesDir: null,
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
      fixturesDir: null,
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
      fixturesDir: null,
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
      fixturesDir: null,
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
      fixturesDir: null,
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
