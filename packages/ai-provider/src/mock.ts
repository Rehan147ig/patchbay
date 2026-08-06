import { RiskLevel, RiskTag, type AiPlanDraft } from "@patchbay/domain";
import type { AiPlanDraftInput, AiProvider } from "./openai-compatible";

const HIGH_RISK_TAGS: ReadonlySet<RiskTag> = new Set([
  RiskTag.PAYMENT,
  RiskTag.AUTH,
  RiskTag.PII,
  RiskTag.WEBHOOK,
  RiskTag.INFRASTRUCTURE,
]);

/**
 * Deterministic default provider: no network, no randomness. Derives the draft
 * entirely from the input so every environment and CI run agrees on the result.
 */
export class MockAiProvider implements AiProvider {
  async draftRemediationPlan(input: AiPlanDraftInput): Promise<AiPlanDraft> {
    const breakingKeywords = ["removed", "required", "breaking", "deprecated"];
    const breaking = breakingKeywords.some(
      (keyword) =>
        input.description?.toLowerCase().includes(keyword) ??
        input.changeType.toLowerCase().includes(keyword) ??
        false,
    );

    const riskTags = deriveRiskTags(input);
    const highRisk = riskTags.some((tag) => HIGH_RISK_TAGS.has(tag));

    const confidence = breaking ? 62 : 82;
    const symbolCount = input.affectedSymbols.length;
    const usageCount = input.usages.length;

    const steps: AiPlanDraft["steps"] = [];
    if (symbolCount > 0) {
      steps.push({
        description: `Update ${symbolCount} affected symbol(s): ${input.affectedSymbols.join(", ")}`,
      });
    }
    if (usageCount > 0) {
      steps.push({
        description: `Review ${usageCount} usage site(s) in ${input.usages
          .map((usage) => usage.filePath)
          .join(", ")}`,
      });
    }
    steps.push({
      description: input.newValue
        ? `Adopt the new API shape: ${input.newValue}`
        : "Follow the vendor migration guide for this change",
    });

    return {
      rationale: `Deterministic mock draft for a ${input.changeType} change on vendor ${input.vendorSlug}: ${input.description ?? "no description provided"}. Advisory only; not automatically applicable.`,
      steps,
      confidence,
      requiresHumanReview: true,
      riskLevel: highRisk ? RiskLevel.HIGH : breaking ? RiskLevel.MEDIUM : RiskLevel.LOW,
      riskTags,
      suggestedEdits: [],
      applicableChangeTypes: [input.changeType],
    };
  }
}

function deriveRiskTags(input: AiPlanDraftInput): RiskTag[] {
  const tags: RiskTag[] = [];
  if (input.vendorSlug === "stripe") tags.push(RiskTag.PAYMENT);
  if (input.vendorSlug === "auth0") tags.push(RiskTag.AUTH);
  if (input.vendorSlug === "twilio") tags.push(RiskTag.WEBHOOK);
  return tags;
}
