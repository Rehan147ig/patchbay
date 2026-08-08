import { defineConnector } from "../sdk";

/**
 * Mistral connector.
 *
 * Mistral moved from the OpenAI-compatible chat completions surface to its
 * native Conversations API:
 * - `chat.completions.create` -> `chat.complete` (native SDK v1+).
 * - Response shape changed from `choices[0].message` to `choices[0].message`
 *   (still) but the stream events differ (`message_start`, `content_delta`).
 * - The `random_seed` / `temperature` parameter names changed.
 */
export const mistralConnector = defineConnector({
  slug: "mistral",
  identifiers: ["mistral", "@mistralai/mistralai"],
  rules: [
    {
      changeType: "METHOD_RENAMED",
      oldValue: "client.chat.completions.create",
      newValue: "client.chat.complete",
      description:
        "Mistral SDK v1 renamed chat.completions.create to chat.complete (native Conversations API).",
      affectedSymbols: ["client.chat.completions.create", "mistral.chat.completions"],
      breaking: true,
      evidence: { sdk: "mistral" },
    },
    {
      changeType: "PARAMETER_REQUIRED",
      oldValue: "response_format",
      description:
        "Structured outputs require response_format with a schema; the legacy json_mode flag was removed.",
      affectedSymbols: ["client.chat.complete", "client.chat.completions.create"],
      breaking: false,
      evidence: { sdk: "mistral" },
    },
    {
      changeType: "RESPONSE_FIELD_TYPE_CHANGED",
      oldValue: "choices[0].message.content",
      description:
        "Content is now a block array on tool-capable models; string content requires content[].text.",
      affectedSymbols: ["client.chat.complete"],
      breaking: true,
      evidence: { sdk: "mistral" },
    },
  ],
  patchSuggestions: {
    "client.chat.completions.create": {
      replacement: "client.chat.complete",
      description: "Replace chat.completions.create with chat.complete (Mistral SDK v1+).",
      confidence: 90,
    },
    "mistral.chat.completions": {
      replacement: "mistral.chat.complete",
      description: "Replace mistral.chat.completions with mistral.chat.complete.",
      confidence: 90,
    },
  },
});
