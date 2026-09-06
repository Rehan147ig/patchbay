import { defineConnector } from "../sdk";
import type { RulePack } from "@patchbay/domain";

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
  /** WP6 rule-pack declaration (see openai.ts for the contract semantics). */
  rulePack: {
    packVersion: "1.0.0",
    vendorSlug: "vercel-ai-sdk",
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
