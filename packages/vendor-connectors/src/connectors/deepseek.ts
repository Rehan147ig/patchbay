import { defineConnector } from "../sdk";

/**
 * DeepSeek connector.
 *
 * DeepSeek's API is OpenAI-compatible but added reasoning-specific
 * parameters that drift across versions:
 * - `reasoning_content` on assistant messages (reasoning models return it
 *   separately from `content`).
 * - The `enable_thinking` / thinking fields on chat params for R1-class
 *   models; older params like `prompt_cache` were removed.
 */
export const deepseekConnector = defineConnector({
  slug: "deepseek",
  identifiers: ["deepseek", "@deepseek/sdk"],
  rules: [
    {
      changeType: "OTHER",
      oldValue: "message.reasoning_content",
      description:
        "Reasoning models return reasoning_content alongside content; code reading only message.content misses the chain-of-thought.",
      affectedSymbols: ["deepseek.chat.completions", "chat.completions.create"],
      breaking: false,
      evidence: { sdk: "deepseek" },
    },
    {
      changeType: "PARAMETER_REMOVED",
      oldValue: "prompt_cache",
      description:
        "The legacy prompt_cache parameter was removed; caching is automatic and not configurable.",
      affectedSymbols: ["deepseek.chat.completions"],
      breaking: true,
      evidence: { sdk: "deepseek" },
    },
  ],
  patchSuggestions: {
    "deepseek.chat.completions": {
      replacement: "deepseek.chat.completions",
      description:
        "Remove prompt_cache params; handle reasoning_content on assistant messages (concatenate or surface separately).",
      confidence: 80,
    },
  },
});
