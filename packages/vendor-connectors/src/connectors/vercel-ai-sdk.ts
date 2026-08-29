import { defineConnector } from "../sdk";
import { RiskTag } from "@patchbay/domain";

/**
 * Vercel AI SDK connector.
 *
 * Vercel AI SDK breaking changes (ai@3 -> ai@4):
 * - `ai` core restructured: `useChat`/`useCompletion` moved to `ai/react`
 * - `openai` provider `streamText` signature changed
 */
export const vercelAiConnector = defineConnector({
  slug: "vercel-ai-sdk",
  identifiers: ["ai", "ai/react", "@ai-sdk/openai"],
  rules: [
    {
      changeType: "METHOD_RENAMED",
      oldValue: "useChat",
      newValue: "useChat (ai/react)",
      description: "Vercel AI SDK restructured: useChat moved to ai/react entry point.",
      affectedSymbols: ["useChat", "useCompletion"],
      breaking: true,
      evidence: { sdk: "vercel-ai-sdk" },
    },
  ],
  patchSuggestions: {
    useChat: {
      replacement: "useChat",
      description: "Import useChat from ai/react (Vercel AI SDK v4).",
      confidence: 75,
    },
  },
});
