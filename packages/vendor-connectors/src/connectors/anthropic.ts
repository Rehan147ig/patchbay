import { defineConnector } from "../sdk";
import type { RulePack } from "@patchbay/domain";

/**
 * Anthropic Messages API connector (certified DRAFT_PR).
 *
 * Certified pattern: `anthropic.completions.create` → `anthropic.messages.create`.
 * That is the legacy Completions API call site the engine can rename on a line.
 * Tool-use / content-block rewrites are out of scope for this kit.
 */
export const anthropicConnector = defineConnector({
  slug: "anthropic",
  identifiers: ["anthropic", "@anthropic-ai/sdk", "claude"],
  /** WP6 rule-pack declaration (see openai.ts for the contract semantics). */
  rulePack: {
    packVersion: "1.0.0",
    vendorSlug: "anthropic",
    contractKind: "SDK",
    supportedChanges: ["METHOD_RENAMED"],
    editBudget: { maxFiles: 10, maxEditsPerFile: 10, maxTotalBytes: 50_000 },
    expectedEvidence: { requiresSourceHash: true, requiresLockfileVersion: true, minUsages: 1 },
    validationProfile: "node-ts-reparse + container-sandbox",
    riskTags: [],
    rollback: {
      strategy: "revert-commit",
      instructions: "Revert the Patchbay draft PR branch before merge.",
    },
  } satisfies RulePack,
  rules: [
    {
      changeType: "METHOD_RENAMED",
      oldValue: "anthropic.completions.create",
      newValue: "anthropic.messages.create",
      description:
        "Anthropic removed the legacy Completions API; use messages.create (Messages API).",
      affectedSymbols: ["anthropic.completions.create"],
      breaking: true,
      evidence: { sdk: "anthropic", rule: "completions-to-messages" },
    },
  ],
  patchSuggestions: {
    "anthropic.completions.create": {
      replacement: "anthropic.messages.create",
      description:
        "Rename anthropic.completions.create to anthropic.messages.create (Messages API).",
      confidence: 92,
    },
  },
});
