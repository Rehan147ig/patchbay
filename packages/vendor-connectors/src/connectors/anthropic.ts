import { defineConnector } from "../sdk";

/**
 * Anthropic connector.
 *
 * Covers the breaking changes across the Messages API and SDK:
 * - The legacy `text/completions` endpoint was removed; `messages.create`
 *   is the only path.
 * - Tool-use format changes: `tool_use` blocks, `tool_choice` shapes, and
 *   the `max_tokens` requirement (required on every request, no default).
 * - Streaming events changed names (`content_block_delta`, `message_delta`).
 */
export const anthropicConnector = defineConnector({
  slug: "anthropic",
  identifiers: ["anthropic", "@anthropic-ai/sdk", "claude"],
  rules: [
    {
      changeType: "ENDPOINT_REMOVED",
      oldValue: "text/completions",
      newValue: "messages.create",
      description:
        "Anthropic removed the legacy text/completions endpoint; use the Messages API (messages.create).",
      affectedSymbols: ["anthropic.completions", "anthropic.complete"],
      breaking: true,
      evidence: { sdk: "anthropic" },
    },
    {
      changeType: "PARAMETER_REQUIRED",
      oldValue: "max_tokens",
      description:
        "max_tokens is required on every Messages API request; omitting it now returns an error.",
      affectedSymbols: ["anthropic.messages.create", "messages.create"],
      breaking: true,
      evidence: { sdk: "anthropic" },
    },
    {
      changeType: "RESPONSE_FIELD_TYPE_CHANGED",
      oldValue: "content[] blocks",
      description:
        "Messages content is a block array (text / tool_use / tool_result); string content no longer exists on responses.",
      affectedSymbols: ["anthropic.messages.create", "messages.create"],
      breaking: true,
      evidence: { sdk: "anthropic" },
    },
  ],
  patchSuggestions: {
    "anthropic.completions": {
      replacement: "anthropic.messages.create",
      description:
        "Replace legacy completions calls with the Messages API: client.messages.create({ model, max_tokens, messages }).",
      confidence: 90,
    },
    "anthropic.complete": {
      replacement: "anthropic.messages.create",
      description:
        "Replace legacy complete() calls with messages.create and pass max_tokens explicitly.",
      confidence: 90,
    },
  },
});
