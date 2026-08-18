import { RiskLevel, RiskTag, type AiPlanDraft } from "@patchbay/domain";
import type {
  AiPlanDraftInput,
  AiProvider,
  AiProviderResult,
  PatchPlanPromptRequest,
  PlanReviewPromptRequest,
  ProviderCallOptions,
} from "./openai-compatible";

const HIGH_RISK_TAGS: ReadonlySet<RiskTag> = new Set([
  RiskTag.PAYMENT,
  RiskTag.AUTH,
  RiskTag.PII,
  RiskTag.WEBHOOK,
  RiskTag.INFRASTRUCTURE,
]);

const HASH_PLACEHOLDER = "0000000000000000000000000000000000000000000000000000000000000000";

/**
 * Deterministic default provider: no network, no randomness. Derives the draft
 * entirely from the input so every environment and CI run agrees on the result.
 */
export class MockAiProvider implements AiProvider {
  async draftRemediationPlan(
    input: AiPlanDraftInput,
    _options?: ProviderCallOptions,
  ): Promise<AiPlanDraft> {
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

  /**
   * Deterministic planner: derives PatchPlan JSON from the trusted drafts and
   * graph evidence. One REPLACE edit per (rename draft × using module): the
   * edit anchors on the draft's oldValue and replaces it with the newValue in
   * every module the graph evidence lists as affected. The patch engine binds
   * expectedSourceHash to the real file content later; the placeholder stands
   * in until then.
   */
  async generatePatchPlan(
    input: PatchPlanPromptRequest,
    _options?: ProviderCallOptions,
  ): Promise<AiProviderResult> {
    const renameDrafts = input.drafts.filter(
      (draft) => draft.changeType.includes("RENAME") && draft.oldValue && draft.newValue,
    );

    const moduleByPath = new Map(input.modules.map((module) => [module.filePath, module]));
    const edits = [];
    const addressedSymbols = new Set<string>();
    for (const draft of renameDrafts) {
      for (const symbol of draft.affectedSymbols) {
        for (const module of input.modules) {
          const moduleEvidence = moduleByPath.get(module.filePath);
          if (!moduleEvidence) continue;
          addressedSymbols.add(symbol);
          edits.push({
            filePath: module.filePath,
            expectedSourceHash: HASH_PLACEHOLDER,
            operation: "REPLACE",
            searchText: draft.oldValue,
            replacement: draft.newValue,
            precondition:
              moduleEvidence.edgeKinds.includes("INVOKES_API") ||
              moduleEvidence.edgeKinds.includes("CREATES_CLIENT")
                ? "caller expression is a member call on the client instance"
                : "identifier usage inside the module",
            description:
              draft.description ??
              `Rename ${symbol} per release ${input.packageName} ${input.toVersion}`,
            confidence: draft.rule === "method-rename" ? 85 : 70,
          });
        }
      }
    }

    const breaking = input.breaking;
    const riskTags = deriveRiskTagsFromSlug(input.vendorSlug);
    const highRisk = riskTags.some((tag) => HIGH_RISK_TAGS.has(tag));

    return {
      output: {
        releaseRecordId: "<bound>",
        repositoryId: "<bound>",
        rationale: `Deterministic mock plan for ${input.packageName} ${input.fromVersion ?? "?"} -> ${input.toVersion} (breaking=${breaking}). Derived ${edits.length} edit(s) from ${renameDrafts.length} rename draft(s) across ${input.modules.length} affected module(s). Plan only: the patch engine binds source hashes and validates every precondition.`,
        confidence: edits.length > 0 ? (breaking ? 62 : 85) : 40,
        requiresHumanReview: breaking || edits.length === 0,
        riskLevel: highRisk ? RiskLevel.HIGH : breaking ? RiskLevel.MEDIUM : RiskLevel.LOW,
        riskTags,
        edits,
        validationProfile: ["typecheck"],
        addressedSymbols: [...addressedSymbols],
      },
      usage: { inputTokens: 0, outputTokens: 0, model: "mock" },
      requestId: null,
      latencyMs: 0,
      provider: "mock",
    };
  }

  /** Deterministic independent reviewer: approves only when the plan edits affected modules. */
  async reviewPatchPlan(
    input: PlanReviewPromptRequest,
    _options?: ProviderCallOptions,
  ): Promise<AiProviderResult> {
    const issues: Array<{ severity: string; target: string; message: string }> = [];

    const missing = input.evidence.modules.filter(
      (module) => !input.plan.edits.some((edit) => edit.filePath === module.filePath),
    );
    if (input.breaking && missing.length > 0) {
      issues.push({
        severity: "warning",
        target: "plan",
        message: `Plan does not edit every affected module: ${missing.map((m) => m.filePath).join(", ")}`,
      });
    }
    if (input.plan.edits.length === 0 && input.breaking) {
      issues.push({
        severity: "error",
        target: "plan",
        message: "No edits proposed for a breaking change",
      });
    }
    if (input.evidence.modules.length === 0) {
      issues.push({
        severity: "warning",
        target: "evidence",
        message: "No graph evidence for affected modules",
      });
    }

    const approved =
      !input.breaking ||
      (input.plan.edits.length > 0 && issues.every((issue) => issue.severity !== "error"));

    return {
      output: {
        approved,
        independent: true,
        confidence: approved ? 78 : 45,
        summary: approved
          ? `Independent review passed: plan addresses ${input.plan.addressedSymbols.length} symbol(s) across ${input.plan.edits.length} edit(s) for the ${input.packageName} ${input.toVersion} release.`
          : `Independent review failed: plan is not complete or safe enough for the breaking ${input.packageName} ${input.toVersion} release (${issues.length} issue(s)).`,
        issues,
      },
      usage: { inputTokens: 0, outputTokens: 0, model: "mock" },
      requestId: null,
      latencyMs: 0,
      provider: "mock",
    };
  }
}

function deriveRiskTagsFromSlug(vendorSlug: string): RiskTag[] {
  const tags: RiskTag[] = [];
  if (vendorSlug === "stripe") tags.push(RiskTag.PAYMENT);
  if (vendorSlug === "auth0") tags.push(RiskTag.AUTH);
  if (vendorSlug === "twilio") tags.push(RiskTag.WEBHOOK);
  return tags;
}

function deriveRiskTags(input: AiPlanDraftInput): RiskTag[] {
  const tags: RiskTag[] = [];
  if (input.vendorSlug === "stripe") tags.push(RiskTag.PAYMENT);
  if (input.vendorSlug === "auth0") tags.push(RiskTag.AUTH);
  if (input.vendorSlug === "twilio") tags.push(RiskTag.WEBHOOK);
  return tags;
}
