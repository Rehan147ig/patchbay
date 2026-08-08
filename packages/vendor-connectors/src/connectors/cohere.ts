import { defineConnector } from "../sdk";

/**
 * Cohere connector.
 *
 * Cohere v2 restructured the client and endpoints:
 * - `generate()` / `embed()` moved to a v2 surface; `chat()` is the
 *   primary path with different parameter names.
 * - Tokenizer API (`tokenize`/`detokenize`) was deprecated.
 * - The client constructor changed (`COHERE_API_KEY` env + `client` object).
 */
export const cohereConnector = defineConnector({
  slug: "cohere",
  identifiers: ["cohere", "cohere-ai"],
  rules: [
    {
      changeType: "METHOD_REMOVED",
      oldValue: "cohere.generate",
      newValue: "cohere.chat",
      description:
        "Cohere v2 removed the standalone generate()/embed() endpoints in favor of chat() and v2 embed().",
      affectedSymbols: ["cohere.generate", "cohere.embed", "cohere.tokenize", "cohere.detokenize"],
      breaking: true,
      evidence: { sdk: "cohere" },
    },
    {
      changeType: "METHOD_RENAMED",
      oldValue: "new cohere.CohereClient()",
      description:
        "The client constructor changed across v2; use the documented factory / env-based init.",
      affectedSymbols: ["CohereClient", "cohere.CohereClient"],
      breaking: true,
      evidence: { sdk: "cohere" },
    },
  ],
  patchSuggestions: {
    "cohere.generate": {
      replacement: "cohere.chat",
      description:
        "Migrate cohere.generate to cohere.chat (v2); map prompt -> message and adjust params.",
      confidence: 80,
    },
    "cohere.embed": {
      replacement: "cohere.embed",
      description: "Update embed() to the v2 signature (input_type and model are now required).",
      confidence: 78,
    },
  },
});
