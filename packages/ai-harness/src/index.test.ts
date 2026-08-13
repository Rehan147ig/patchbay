import { describe, expect, it } from "vitest";
import { MockAiProvider } from "@patchbay/ai-provider";
import { patchPlanSchema, reviewVerdictSchema, type PatchGenerationInput } from "@patchbay/domain";
import { bindSourceHashes, BudgetExceededError, hashInput, runPlanner, runReviewer } from "./index";

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

describe("agent harness planner", () => {
  it("produces a schema-valid PatchPlan from the deterministic mock", async () => {
    const provider = new MockAiProvider();
    const { plan, costEstimateCents } = await runPlanner(provider, INPUT);

    expect(costEstimateCents).toBe(0);
    const parsed = patchPlanSchema.safeParse(plan);
    expect(parsed.success).toBe(true);
    expect(plan.releaseRecordId).toBe("r-4");
    expect(plan.repositoryId).toBe("repo-ai");
    expect(plan.edits).toHaveLength(1);
    expect(plan.edits[0]?.filePath).toBe("src/chat/chat-service.ts");
    expect(plan.edits[0]?.searchText).toBe("openai.createChatCompletion");
    expect(plan.edits[0]?.replacement).toBe("openai.chat.completions.create");
    expect(plan.requiresHumanReview).toBe(true);
  });

  it("is deterministic: same input yields the same plan and digest", async () => {
    const provider = new MockAiProvider();
    const first = await runPlanner(provider, INPUT);
    const second = await runPlanner(provider, INPUT);

    expect(second.plan).toEqual(first.plan);
    expect(hashInput(INPUT)).toBe(hashInput(INPUT));
    expect(hashInput(INPUT)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("plans one edit per affected module with evidence-derived preconditions", async () => {
    const provider = new MockAiProvider();
    const multiModule = {
      ...INPUT,
      modules: [
        { filePath: "src/chat/chat-service.ts", edgeKinds: ["INVOKES_API"], evidenceCount: 2 },
        { filePath: "src/chat/legacy-bridge.ts", edgeKinds: ["USES_PACKAGE"], evidenceCount: 1 },
      ],
    } as const;

    const { plan } = await runPlanner(provider, multiModule as unknown as PatchGenerationInput);

    expect(plan.edits).toHaveLength(2);
    const chatEdit = plan.edits.find((edit) => edit.filePath === "src/chat/chat-service.ts");
    const bridgeEdit = plan.edits.find((edit) => edit.filePath === "src/chat/legacy-bridge.ts");
    expect(chatEdit?.precondition).toBe(
      "caller expression is a member call on the client instance",
    );
    expect(bridgeEdit?.precondition).toBe("identifier usage inside the module");
    expect(plan.addressedSymbols).toEqual(["openai.createChatCompletion"]);
  });

  it("enforces the per-run budget before persisting anything", async () => {
    const provider = {
      generatePatchPlan: async () => ({
        output: {},
        usage: { inputTokens: 100_000_000, outputTokens: 100_000_000, model: "gpt-4o-mini" },
      }),
      reviewPatchPlan: async () => ({ output: {} }),
      draftRemediationPlan: async () => {
        throw new Error("unused");
      },
    } as unknown as MockAiProvider;

    await expect(runPlanner(provider, INPUT, { budgetCents: 10 })).rejects.toThrow(
      BudgetExceededError,
    );
  });

  it("binds real source hashes and invalidates unknown files", async () => {
    const provider = new MockAiProvider();
    const { plan } = await runPlanner(provider, INPUT);

    const { plan: bound, invalidated } = bindSourceHashes(
      plan,
      new Map([["src/chat/chat-service.ts", "a".repeat(64)]]),
    );

    expect(invalidated).toEqual([]);
    expect(bound.edits[0]?.expectedSourceHash).toBe("a".repeat(64));

    const { plan: boundPartial, invalidated: dropped } = bindSourceHashes(plan, new Map());
    expect(dropped).toHaveLength(1);
    expect(boundPartial.edits).toEqual([]);
  });
});

describe("agent harness reviewer", () => {
  it("approves a plan that addresses the affected modules", async () => {
    const provider = new MockAiProvider();
    const { plan } = await runPlanner(provider, INPUT);
    const { verdict } = await runReviewer(
      provider,
      plan,
      { modules: INPUT.modules },
      { packageName: "openai", fromVersion: "3.3.0", toVersion: "4.0.0", breaking: true },
    );

    expect(reviewVerdictSchema.safeParse(verdict).success).toBe(true);
    expect(verdict.independent).toBe(true);
    expect(verdict.approved).toBe(true);
  });

  it("vetoes a breaking plan with no edits", async () => {
    const provider = new MockAiProvider();
    const { plan } = await runPlanner(provider, INPUT);
    const emptyPlan = { ...plan, edits: [], confidence: 40 };

    const { verdict } = await runReviewer(
      provider,
      emptyPlan,
      { modules: INPUT.modules },
      { packageName: "openai", fromVersion: "3.3.0", toVersion: "4.0.0", breaking: true },
    );

    expect(verdict.approved).toBe(false);
    expect(verdict.issues.some((issue) => issue.severity === "error")).toBe(true);
  });
});
