import { MockAiProvider } from "./mock";
import { OpenAiCompatibleProvider } from "./openai-compatible";
import type { AiProvider } from "./openai-compatible";

export { MockAiProvider } from "./mock";
export { OpenAiCompatibleProvider, loadPlanDraftTemplate } from "./openai-compatible";
export type {
  AiPlanDraftInput,
  AiProvider,
  AiProviderResult,
  OpenAiCompatibleConfig,
  PatchPlanPromptRequest,
  PlanReviewPromptRequest,
} from "./openai-compatible";
export type { AiPlanDraft } from "@patchbay/domain";

/**
 * Env-gated provider factory.
 *
 * - `AI_PROVIDER=openai` (or `openai-compatible`) requires `OPENAI_API_KEY`;
 *   uses `OPENAI_MODEL` (default gpt-4o-mini) and `OPENAI_BASE_URL`
 *   (default https://api.openai.com/v1).
 * - Anything else returns the deterministic MockAiProvider (no network).
 */
export function createAiProvider(
  env: NodeJS.ProcessEnv,
  overrides?: { fetchImpl?: typeof fetch },
): AiProvider {
  if (env.AI_PROVIDER === "openai" || env.AI_PROVIDER === "openai-compatible") {
    if (!env.OPENAI_API_KEY) {
      throw new Error("AI_PROVIDER=openai requires OPENAI_API_KEY");
    }
    return new OpenAiCompatibleProvider({
      apiKey: env.OPENAI_API_KEY,
      model: env.OPENAI_MODEL,
      baseUrl: env.OPENAI_BASE_URL,
      fetchImpl: overrides?.fetchImpl,
    });
  }
  return new MockAiProvider();
}
