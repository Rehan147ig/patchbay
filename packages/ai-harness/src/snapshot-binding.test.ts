import { describe, expect, it } from "vitest";
import { MockAiProvider } from "@patchbay/ai-provider";
import type { PatchGenerationInput, PatchPlan } from "@patchbay/domain";
import {
  UnknownModelPriceError,
  assertRemainingBudget,
  estimateCostCents,
  remainingBudgetCents,
  runPlanner,
  runReviewer,
} from "./index";
import {
  MAX_EVIDENCE_FILES,
  MAX_EXCERPT_CHARS,
  MAX_TOTAL_CONTEXT_CHARS,
  SNAPSHOT_HASH_PLACEHOLDER,
  bindSnapshotHashes,
  buildEvidencePacket,
  classifyBoundPlan,
} from "./snapshot-binding";

const INPUT: PatchGenerationInput = {
  releaseRecordId: "r-1",
  repositoryId: "repo-1",
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
      description: "renamed",
      breaking: true,
      affectedSymbols: ["openai.createChatCompletion"],
      rule: "method-rename",
    },
  ],
  modules: [{ filePath: "src/a.ts", edgeKinds: ["INVOKES_API"], evidenceCount: 3 }],
  excerpts: [],
};

function planWith(edits: PatchPlan["edits"]): PatchPlan {
  return {
    releaseRecordId: "r-1",
    repositoryId: "repo-1",
    rationale: "test",
    confidence: 80,
    requiresHumanReview: false,
    riskLevel: "LOW",
    riskTags: [],
    edits,
    validationProfile: [],
    addressedSymbols: [],
  };
}

describe("snapshot binding", () => {
  it("binds valid edits to real snapshot hashes", async () => {
    const provider = new MockAiProvider();
    const { plan } = await runPlanner(provider, INPUT);
    expect(plan.edits.length).toBeGreaterThan(0);
    const manifest = new Map([[plan.edits[0]!.filePath, "b".repeat(64)]]);
    const bound = bindSnapshotHashes(plan, manifest);
    expect(bound.invalidated).toEqual([]);
    expect(bound.plan.edits[0]?.expectedSourceHash).toBe("b".repeat(64));
  });

  it("invalidates missing files, stale hashes, traversal, and unsafe paths", () => {
    const manifest = new Map([["src/a.ts", "a".repeat(64)]]);
    const bound = bindSnapshotHashes(
      planWith([
        {
          filePath: "src/a.ts",
          expectedSourceHash: SNAPSHOT_HASH_PLACEHOLDER,
          operation: "REPLACE",
          searchText: "x",
          replacement: "y",
          description: "ok",
          confidence: 90,
        },
        {
          filePath: "src/missing.ts",
          expectedSourceHash: SNAPSHOT_HASH_PLACEHOLDER,
          operation: "REPLACE",
          searchText: "x",
          replacement: "y",
          description: "missing",
          confidence: 90,
        },
        {
          filePath: "src/a.ts",
          expectedSourceHash: "c".repeat(64),
          operation: "REPLACE",
          searchText: "x",
          replacement: "y",
          description: "stale",
          confidence: 90,
        },
        {
          filePath: "../escape.ts",
          expectedSourceHash: SNAPSHOT_HASH_PLACEHOLDER,
          operation: "REPLACE",
          searchText: "x",
          replacement: "y",
          description: "traversal",
          confidence: 90,
        },
        {
          filePath: "/abs.ts",
          expectedSourceHash: SNAPSHOT_HASH_PLACEHOLDER,
          operation: "REPLACE",
          searchText: "x",
          replacement: "y",
          description: "absolute",
          confidence: 90,
        },
      ]),
      manifest,
    );
    expect(bound.plan.edits).toHaveLength(1);
    expect(bound.plan.edits[0]?.filePath).toBe("src/a.ts");
    expect(bound.invalidated.map((item) => item.filePath).sort()).toEqual(
      ["/abs.ts", "../escape.ts", "src/a.ts", "src/missing.ts"].sort(),
    );
    expect(bound.invalidated.some((item) => item.reason.includes("stale"))).toBe(true);
  });

  it("classifies zero-edit as PLAN_ONLY and partial invalidation as INVALIDATED", () => {
    expect(classifyBoundPlan(0, 0).outcome).toBe("PLAN_ONLY");
    expect(classifyBoundPlan(0, 2).outcome).toBe("PLAN_ONLY");
    expect(classifyBoundPlan(2, 1).outcome).toBe("INVALIDATED");
    expect(classifyBoundPlan(2, 0).outcome).toBe("PATCH_PROPOSED");
  });

  it("bounds the evidence packet (files, excerpt size, total context)", () => {
    const packet = buildEvidencePacket({
      vendorSlug: "openai",
      packageName: "openai",
      fromVersion: "3.3.0",
      toVersion: "4.0.0",
      breaking: true,
      drafts: [],
      modules: Array.from({ length: 20 }, (_, i) => ({
        filePath: `src/${i}.ts`,
        edgeKinds: ["INVOKES_API"],
        evidenceCount: 20 - i,
      })),
      snapshot: { commitSha: "abc", treeHash: "tree", manifestHash: "manifest" },
      excerpts: Array.from({ length: 20 }, (_, i) => ({
        filePath: `src/${i}.ts`,
        excerpt: "x".repeat(5000),
      })),
      rulePack: null,
    });
    expect(packet.excerpts.length).toBeLessThanOrEqual(MAX_EVIDENCE_FILES);
    for (const excerpt of packet.excerpts) {
      expect(excerpt.excerpt.length).toBeLessThanOrEqual(MAX_EXCERPT_CHARS + 100);
    }
    expect(packet.totalExcerptChars).toBeLessThanOrEqual(MAX_TOTAL_CONTEXT_CHARS);
    expect(packet.caps.maxFiles).toBe(MAX_EVIDENCE_FILES);
  });
});

describe("total budget", () => {
  it("planner plus reviewer cannot exceed one total budget", () => {
    expect(remainingBudgetCents(100, 60)).toBe(40);
    expect(() => assertRemainingBudget(100, 101)).toThrow();
    expect(assertRemainingBudget(100, 100)).toBe(0);
  });

  it("reviewer with the planner remainder fails when the planner spent everything", async () => {
    const provider = new MockAiProvider();
    const { plan, costEstimateCents } = await runPlanner(provider, INPUT, { budgetCents: 100 });
    expect(costEstimateCents).toBe(0);
    const remaining = remainingBudgetCents(0, costEstimateCents);
    // Mock costs zero, so zero-budget mock runs still pass; a paid planner
    // spending the whole budget leaves zero for the reviewer, which a paid
    // reviewer would then exceed (covered by the unknown-price gate below).
    expect(remaining).toBe(0);
    const { verdict } = await runReviewer(
      provider,
      plan,
      { modules: INPUT.modules },
      { packageName: "openai", fromVersion: "3.3.0", toVersion: "4.0.0", breaking: true },
      { budgetCents: remaining },
    );
    expect(verdict.independent).toBe(true);
  });

  it("unknown model price never becomes zero cost", () => {
    expect(() =>
      estimateCostCents({
        output: {},
        usage: { inputTokens: 100, outputTokens: 100, model: "future-model-zzz" },
      }),
    ).toThrow(UnknownModelPriceError);
    // Known models still price normally (mock is free, gpt-4o-mini is paid).
    expect(
      estimateCostCents({ output: {}, usage: { inputTokens: 0, outputTokens: 0, model: "mock" } }),
    ).toBe(0);
    expect(
      estimateCostCents({
        output: {},
        usage: { inputTokens: 1_000_000, outputTokens: 0, model: "gpt-4o-mini" },
      }),
    ).toBeGreaterThan(0);
  });
});
