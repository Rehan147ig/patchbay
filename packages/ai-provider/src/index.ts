import { AiSdkProvider } from "./ai-sdk";
import { MockAiProvider } from "./mock";
import { OpenAiCompatibleProvider } from "./openai-compatible";
import type { AiProvider } from "./openai-compatible";

export { AiSdkProvider, AiSdkProviderError } from "./ai-sdk";
export type { AiSdkErrorKind, AiSdkProviderConfig } from "./ai-sdk";
export { MockAiProvider } from "./mock";
export { OpenAiCompatibleProvider, loadPlanDraftTemplate } from "./openai-compatible";
export type {
  AiPlanDraftInput,
  AiProvider,
  AiProviderResult,
  OpenAiCompatibleConfig,
  PatchPlanPromptRequest,
  PlanReviewPromptRequest,
  ProviderCallOptions,
} from "./openai-compatible";
export type { AiPlanDraft } from "@patchbay/domain";

/**
 * Env-gated provider factory.
 *
 * - `AI_PROVIDER=ai-sdk` (Vercel AI SDK, WP7) requires `OPENAI_API_KEY`;
 *   uses `OPENAI_MODEL` (default gpt-4o-mini) and `OPENAI_BASE_URL`
 *   (default https://api.openai.com/v1). Tuning: `AI_TIMEOUT_MS`,
 *   `AI_MAX_OUTPUT_TOKENS`, `AI_MAX_RETRIES`, `AI_ALLOWED_MODELS`,
 *   `AI_ALLOWED_BASE_URL_HOSTS`, `AI_CIRCUIT_MAX_FAILURES`,
 *   `AI_CIRCUIT_COOLDOWN_MS`.
 * - `AI_PROVIDER=openai` (or `openai-compatible`) requires `OPENAI_API_KEY`;
 *   legacy REST client, same envs minus the AI_* tuning vars.
 * - Anything else returns the deterministic MockAiProvider (no network).
 */
export function createAiProvider(
  env: NodeJS.ProcessEnv,
  overrides?: { fetchImpl?: typeof fetch },
): AiProvider {
  if (env.AI_PROVIDER === "ai-sdk") {
    if (!env.OPENAI_API_KEY) {
      throw new Error("AI_PROVIDER=ai-sdk requires OPENAI_API_KEY");
    }
    return new AiSdkProvider({
      apiKey: env.OPENAI_API_KEY,
      model: env.OPENAI_MODEL,
      baseUrl: env.OPENAI_BASE_URL,
      fetchImpl: overrides?.fetchImpl,
      timeoutMs: positiveIntEnv(env.AI_TIMEOUT_MS, 60_000),
      maxOutputTokens: positiveIntEnv(env.AI_MAX_OUTPUT_TOKENS, 2048),
      maxRetries: nonNegativeIntEnv(env.AI_MAX_RETRIES, 2),
      allowedModels: csvEnv(env.AI_ALLOWED_MODELS),
      allowedBaseUrlHosts: csvEnv(env.AI_ALLOWED_BASE_URL_HOSTS),
      circuitBreaker: {
        maxConsecutiveFailures: positiveIntEnv(env.AI_CIRCUIT_MAX_FAILURES, 5),
        cooldownMs: positiveIntEnv(env.AI_CIRCUIT_COOLDOWN_MS, 30_000),
      },
    });
  }
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

function positiveIntEnv(raw: string | undefined, fallback: number): number {
  const parsed = raw === undefined ? NaN : Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeIntEnv(raw: string | undefined, fallback: number): number {
  const parsed = raw === undefined ? NaN : Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function csvEnv(raw: string | undefined): string[] | undefined {
  const values = (raw ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return values.length > 0 ? values : undefined;
}
