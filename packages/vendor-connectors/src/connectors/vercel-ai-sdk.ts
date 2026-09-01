import { defineConnector } from "../sdk";

/**
 * Vercel AI SDK connector.
 *
 * Vercel AI SDK breaking changes (ai@3 -> ai@4):
 * - `ai` core restructured: `useChat`/`useCompletion` moved to `ai/react`
 * - `openai` provider `streamText` signature changed
 */
export const vercelAiConnector = defineConnector({
  slug: "vercel-ai-sdk",
  identifiers: ["vercel-ai-sdk", "ai", "ai/react", "@ai-sdk/openai"],
  rules: [
    {
      changeType: "METHOD_RENAMED",
      oldValue: "useChat",
      newValue: "useChatV4",
      description: "Vercel AI SDK v4: useChat API renamed to useChatV4 (ai -> ai/react migration).",
      affectedSymbols: ["useChat"],
      breaking: true,
      evidence: { sdk: "vercel-ai-sdk" },
    },
  ],
  patchSuggestions: {
    useChat: {
      replacement: "useChat",
      description: "Insert migration marker for useChat (Vercel AI SDK v4).",
      confidence: 85,
      insert: { searchText: "useChat", insertText: "/* v4 */ " },
    },
  },
});
