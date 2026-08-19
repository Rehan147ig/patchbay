import { defineConnector } from "../sdk";

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
