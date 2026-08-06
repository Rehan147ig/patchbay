import { ImpactStatus, RiskLevel, RiskTag, Severity, UsageType } from "@patchbay/domain";
import { describe, expect, it } from "vitest";
import { assessImpact } from "./scoring";
import type { ImpactScoringInput, ImpactScoringUsage } from "./scoring";

const NORMALIZATIONS = [
  {
    changeType: "METHOD_RENAMED" as const,
    oldValue: "openai.createChatCompletion",
    newValue: "openai.chat.completions.create",
    description: "Method renamed.",
    breaking: true,
    affectedSymbols: ["openai.createChatCompletion"],
  },
];

function usage(id: string, symbol: string, riskTags: RiskTag[] = []): ImpactScoringUsage {
  return { id, symbol, usageType: UsageType.METHOD_CALL, riskTags };
}

function input(usages: ImpactScoringUsage[]): ImpactScoringInput {
  return {
    vendorSlug: "openai",
    repositoryName: "ai-assistant-service",
    severity: Severity.HIGH,
    normalizations: NORMALIZATIONS,
    usages,
  };
}

describe("assessImpact", () => {
  it("reports NOT_AFFECTED when the repository has no usages for the vendor", () => {
    const draft = assessImpact(input([]));
    expect(draft.status).toBe(ImpactStatus.NOT_AFFECTED);
    expect(draft.score).toBe(0);
    expect(draft.confidence).toBe(100);
    expect(draft.riskLevel).toBe(RiskLevel.LOW);
    expect(draft.affectedUsageIds).toEqual([]);
    expect(draft.rationale).toContain("No tracked usages");
  });

  it("reports NOT_AFFECTED when usages exist but none match the change", () => {
    const draft = assessImpact(input([usage("u1", "openai.chat.completions.create")]));
    expect(draft.status).toBe(ImpactStatus.NOT_AFFECTED);
    expect(draft.score).toBe(0);
    expect(draft.rationale).toContain("none reference the changed methods");
  });

  it("marks exact matches AFFECTED with a high confidence score", () => {
    const usages = [usage("u1", "openai.createChatCompletion")];
    const draft = assessImpact(input(usages));
    expect(draft.status).toBe(ImpactStatus.AFFECTED);
    expect(draft.confidence).toBe(92);
    expect(draft.affectedUsageIds).toEqual(["u1"]);
    expect(draft.matchedSymbols).toEqual(["openai.createChatCompletion"]);
    expect(draft.rationale).toContain("1 of 1 usage(s)");
  });

  it("scales the score with more affected usages, capped", () => {
    const usages = Array.from({ length: 20 }, (_, i) =>
      usage(`u${i}`, "openai.createChatCompletion"),
    );
    const draft = assessImpact(input(usages));
    expect(draft.score).toBe(70);
  });

  it("marks prefix-only matches POSSIBLY_AFFECTED with lower confidence", () => {
    const prefixInput: ImpactScoringInput = {
      vendorSlug: "openai",
      repositoryName: "ai-assistant-service",
      severity: Severity.HIGH,
      normalizations: [
        {
          changeType: "RESPONSE_FIELD_REMOVED",
          oldValue: "completion.data",
          description: "v4 returns the body directly.",
          breaking: true,
          affectedSymbols: ["completion.data"],
        },
      ],
      usages: [usage("u1", "completion.data.choices[0].message.content")],
    };
    const draft = assessImpact(prefixInput);
    expect(draft.status).toBe(ImpactStatus.POSSIBLY_AFFECTED);
    expect(draft.confidence).toBe(78);
    expect(draft.affectedUsageIds).toEqual(["u1"]);
  });

  it("raises risk level for high-risk tagged usages", () => {
    const usages = [
      usage("u1", "openai.createChatCompletion"),
      usage("u2", "openai.createChatCompletion", [RiskTag.AUTH]),
    ];
    const draft = assessImpact(input(usages));
    expect(draft.riskLevel).toBe(RiskLevel.HIGH);
    expect(draft.rationale).toContain("risk: AUTH");
  });

  it("keeps risk MEDIUM for breaking changes without high-risk tags", () => {
    const draft = assessImpact(input([usage("u1", "openai.createChatCompletion")]));
    expect(draft.riskLevel).toBe(RiskLevel.MEDIUM);
  });

  it("is deterministic for the same inputs", () => {
    const usages = [
      usage("u1", "openai.createChatCompletion"),
      usage("u2", "openai.chat.completions.create", [RiskTag.WEBHOOK]),
    ];
    const first = assessImpact(input(usages));
    const second = assessImpact(input(usages));
    expect(first).toEqual(second);
  });
});
