import { defineConnector } from "../sdk";

/**
 * Groq connector.
 *
 * Groq is OpenAI-compatible but has drifted on the edges:
 * - Reasoning models (llama-3.3-70b-versatile etc.) added
 *   `reasoning` params and `reasoning_content` on responses.
 * - Model catalog churn: deprecated model ids return errors; code must
 *   update model names or pin them.
 * - Some params OpenAI accepts (logprobs on all models, response_format
 *   strict) are not supported on every Groq model.
 */
export const groqConnector = defineConnector({
  slug: "groq",
  identifiers: ["groq", "groq-sdk"],
  rules: [
    {
      changeType: "OTHER",
      oldValue: "reasoning_content",
      description:
        "Groq reasoning models return reasoning_content; code reading only choices[0].message.content misses it.",
      affectedSymbols: ["groq.chat.completions", "chat.completions.create"],
      breaking: false,
      evidence: { sdk: "groq" },
    },
    {
      changeType: "SDK_VERSION_UPGRADE",
      oldValue: "deprecated model id",
      description:
        "Groq deprecates model ids; deprecated ids return model_not_found errors. Pin current ids.",
      affectedSymbols: ["groq.chat.completions"],
      breaking: true,
      evidence: { sdk: "groq" },
    },
  ],
  patchSuggestions: {
    "groq.chat.completions": {
      replacement: "groq.chat.completions",
      description:
        "Pin model ids to current Groq catalog entries and handle reasoning_content on responses.",
      confidence: 75,
    },
  },
});
