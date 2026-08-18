import {
  APICallError,
  InvalidResponseDataError,
  JSONParseError,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  Output as AiOutput,
  RetryError,
  TypeValidationError,
  generateText,
  zodSchema,
  type LanguageModel,
} from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  aiPlanDraftSchema,
  patchPlanSchema,
  reviewVerdictSchema,
  type AiPlanDraft,
} from "@patchbay/domain";
import {
  buildPlanGenerationPrompt,
  buildPlanReviewPrompt,
  buildUserPrompt,
  loadPlanDraftTemplate,
  loadPlanGenerationTemplate,
  loadPlanReviewTemplate,
  type AiPlanDraftInput,
  type AiProvider,
  type AiProviderResult,
  type PatchPlanPromptRequest,
  type PlanReviewPromptRequest,
  type ProviderCallOptions,
} from "./openai-compatible";

/**
 * Vercel AI SDK provider (WP7) behind the AiProvider transport contract.
 *
 * Uses `generateText` with an `output.object({ schema })` setting (AI SDK v7)
 * bound to the existing domain Zod schemas (aiPlanDraft, patchPlan,
 * reviewVerdict) for typed structured output. The ai-harness remains the
 * schema/budget/persistence authority and re-validates the full schema after
 * transport; this provider only guarantees the model-visible subset.
 *
 * Safety policy (WP7):
 * - Timeout: every call races against AbortSignal.timeout; a late provider is
 *   classified `timeout` and never silently retried past the configured cap.
 * - Cancellation: callers may pass an AbortSignal; aborted calls surface as
 *   `aborted` (mapped to ABORTED by the workflow, never retried as success).
 * - Retries: bounded by maxRetries (SDK default 2) for transient HTTP
 *   failures only; schema violations and aborts are never retried.
 * - Allowlist: model id and base-URL host are rejected before any network
 *   call when an allowlist is configured.
 * - Circuit breaker: consecutive provider-health failures open the breaker
 *   for a cooldown window; calls fail fast with `circuit_open`.
 * - Fail-loud fallback: provider failures are always surfaced as classified
 *   errors. A silent fallback to the deterministic mock is deliberately NOT
 *   implemented — substituting a mock plan for a real provider result would
 *   fabricate truth.
 * - No secrets: error messages carry kind/status only; the API key never
 *   appears in messages, logs, or audit data.
 */

export type AiSdkErrorKind =
  | "config"
  | "auth"
  | "rate_limited"
  | "timeout"
  | "aborted"
  | "circuit_open"
  | "output_schema"
  | "provider"
  | "network";

export class AiSdkProviderError extends Error {
  constructor(
    public readonly kind: AiSdkErrorKind,
    message: string,
    public readonly statusCode: number | null = null,
  ) {
    super(message);
    this.name = "AiSdkProviderError";
  }
}

export interface AiSdkCircuitBreakerConfig {
  /** Consecutive health failures before the breaker opens. */
  maxConsecutiveFailures: number;
  /** How long the breaker stays open before allowing one probe call. */
  cooldownMs: number;
}

export interface AiSdkProviderConfig {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Per-call wall-clock timeout in ms. */
  timeoutMs?: number;
  /** Hard cap on generated output tokens per call. */
  maxOutputTokens?: number;
  /** Transient-failure retries (SDK semantics; 0 disables). */
  maxRetries?: number;
  /** Model allowlist: when non-empty, unlisted models are rejected up front. */
  allowedModels?: readonly string[];
  /** Provider (base URL host) allowlist: when non-empty, other hosts are rejected up front. */
  allowedBaseUrlHosts?: readonly string[];
  circuitBreaker?: Partial<AiSdkCircuitBreakerConfig>;
}

const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 2048;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_MAX_CONSECUTIVE_FAILURES = 5;
const DEFAULT_COOLDOWN_MS = 30_000;

/** Failure kinds that indicate provider health and trip the circuit breaker. */
const BREAKER_FAILURE_KINDS: ReadonlySet<AiSdkErrorKind> = new Set([
  "auth",
  "rate_limited",
  "timeout",
  "provider",
  "network",
]);

type DomainZodSchema = Parameters<typeof zodSchema>[0];

export class AiSdkProvider implements AiProvider {
  private readonly apiKey: string;
  private readonly modelName: string;
  private readonly model: LanguageModel;
  private readonly timeoutMs: number;
  private readonly maxOutputTokens: number;
  private readonly maxRetries: number;
  private readonly allowedModels: readonly string[];
  private readonly allowedBaseUrlHosts: readonly string[];
  private readonly maxConsecutiveFailures: number;
  private readonly cooldownMs: number;
  private readonly systemPrompt: string;
  private readonly planGenerationPrompt: string;
  private readonly planReviewPrompt: string;

  private consecutiveFailures = 0;
  private circuitOpenedAt: number | null = null;

  constructor(config: AiSdkProviderConfig) {
    if (!config.apiKey || config.apiKey.length === 0) {
      throw new AiSdkProviderError("config", "AiSdkProvider requires an apiKey");
    }
    this.apiKey = config.apiKey;
    this.modelName = config.model ?? DEFAULT_MODEL;

    const baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    let hostname: string;
    try {
      hostname = new URL(baseUrl).hostname;
    } catch {
      throw new AiSdkProviderError(
        "config",
        `AiSdkProvider baseUrl is not a valid URL: ${baseUrl}`,
      );
    }

    this.allowedModels = config.allowedModels ?? [];
    if (this.allowedModels.length > 0 && !this.allowedModels.includes(this.modelName)) {
      throw new AiSdkProviderError(
        "config",
        `model '${this.modelName}' is not in the allowlist [${this.allowedModels.join(", ")}]`,
      );
    }
    this.allowedBaseUrlHosts = config.allowedBaseUrlHosts ?? [];
    if (this.allowedBaseUrlHosts.length > 0 && !this.allowedBaseUrlHosts.includes(hostname)) {
      throw new AiSdkProviderError(
        "config",
        `provider host '${hostname}' is not in the allowlist [${this.allowedBaseUrlHosts.join(", ")}]`,
      );
    }

    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxOutputTokens = config.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.maxConsecutiveFailures =
      config.circuitBreaker?.maxConsecutiveFailures ?? DEFAULT_MAX_CONSECUTIVE_FAILURES;
    this.cooldownMs = config.circuitBreaker?.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    this.systemPrompt = loadPlanDraftTemplate();
    this.planGenerationPrompt = loadPlanGenerationTemplate();
    this.planReviewPrompt = loadPlanReviewTemplate();

    const sdk = createOpenAICompatible({
      name: "patchbay-ai-sdk",
      baseURL: baseUrl,
      apiKey: this.apiKey,
      supportsStructuredOutputs: true,
      fetch: (config.fetchImpl ?? fetch) as Parameters<typeof createOpenAICompatible>[0]["fetch"],
    });
    this.model = sdk.languageModel(this.modelName);
  }

  async draftRemediationPlan(
    input: AiPlanDraftInput,
    options?: ProviderCallOptions,
  ): Promise<AiPlanDraft> {
    const { object } = await this.generateStructured(
      aiPlanDraftSchema,
      this.systemPrompt,
      buildUserPrompt(input),
      options,
    );
    return object as AiPlanDraft;
  }

  async generatePatchPlan(
    input: PatchPlanPromptRequest,
    options?: ProviderCallOptions,
  ): Promise<AiProviderResult> {
    const { object, usage, requestId, latencyMs } = await this.generateStructured(
      patchPlanSchema,
      this.planGenerationPrompt,
      buildPlanGenerationPrompt(input),
      options,
    );
    return {
      output: object,
      usage: {
        inputTokens: usage?.inputTokens ?? 0,
        outputTokens: usage?.outputTokens ?? 0,
        model: this.modelName,
      },
      requestId,
      latencyMs,
      provider: "ai-sdk",
    };
  }

  async reviewPatchPlan(
    input: PlanReviewPromptRequest,
    options?: ProviderCallOptions,
  ): Promise<AiProviderResult> {
    const { object, usage, requestId, latencyMs } = await this.generateStructured(
      reviewVerdictSchema,
      this.planReviewPrompt,
      buildPlanReviewPrompt(input),
      options,
    );
    return {
      output: object,
      usage: {
        inputTokens: usage?.inputTokens ?? 0,
        outputTokens: usage?.outputTokens ?? 0,
        model: this.modelName,
      },
      requestId,
      latencyMs,
      provider: "ai-sdk",
    };
  }

  /** Circuit breaker + timeout/cancellation + SDK structured call in one path. */
  private async generateStructured(
    schema: DomainZodSchema,
    systemPrompt: string,
    prompt: string,
    options?: ProviderCallOptions,
  ): Promise<{
    object: unknown;
    usage: { inputTokens: number; outputTokens: number } | null;
    requestId: string | null;
    latencyMs: number;
  }> {
    this.assertCircuitClosed();
    const startedAt = Date.now();
    const external = options?.signal;
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const signal = external ? AbortSignal.any([external, timeout]) : timeout;
    try {
      const {
        output: object,
        usage,
        response,
      } = await generateText({
        model: this.model,
        output: AiOutput.object({ schema: zodSchema(schema) }),
        system: systemPrompt,
        prompt,
        maxOutputTokens: this.maxOutputTokens,
        maxRetries: this.maxRetries,
        abortSignal: signal,
      });
      this.consecutiveFailures = 0;
      this.circuitOpenedAt = null;
      return {
        object,
        usage:
          (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0) > 0
            ? { inputTokens: usage.inputTokens ?? 0, outputTokens: usage.outputTokens ?? 0 }
            : null,
        requestId: response?.id ?? null,
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      const classified = this.classify(error, external, timeout);
      if (BREAKER_FAILURE_KINDS.has(classified.kind)) {
        this.consecutiveFailures += 1;
        if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
          this.circuitOpenedAt = Date.now();
        }
      }
      throw classified;
    }
  }

  private assertCircuitClosed(): void {
    if (this.circuitOpenedAt !== null) {
      if (Date.now() - this.circuitOpenedAt >= this.cooldownMs) {
        this.circuitOpenedAt = null;
        this.consecutiveFailures = 0;
      } else {
        throw new AiSdkProviderError(
          "circuit_open",
          "ai-sdk provider circuit breaker is open; failing fast",
        );
      }
    }
  }

  /** Key-free classification; error messages never contain credentials or bodies. */
  private classify(
    error: unknown,
    external: AbortSignal | undefined,
    timeout: AbortSignal,
  ): AiSdkProviderError {
    if (external?.aborted) {
      return new AiSdkProviderError("aborted", "ai-sdk provider call aborted by caller");
    }
    if (timeout.aborted) {
      return new AiSdkProviderError(
        "timeout",
        `ai-sdk provider call exceeded ${this.timeoutMs}ms timeout`,
      );
    }
    if (error instanceof RetryError) {
      return this.classify(error.lastError, external, timeout);
    }
    if (error instanceof APICallError) {
      const status = error.statusCode;
      if (status === 401 || status === 403) {
        return new AiSdkProviderError(
          "auth",
          `ai-sdk provider rejected the API key (http ${status})`,
          status,
        );
      }
      if (status === 429) {
        return new AiSdkProviderError(
          "rate_limited",
          "ai-sdk provider rate limited (http 429)",
          status,
        );
      }
      if (status !== undefined && status >= 500) {
        return new AiSdkProviderError(
          "provider",
          `ai-sdk provider returned an error (http ${status})`,
          status,
        );
      }
      return new AiSdkProviderError(
        "provider",
        `ai-sdk provider request failed (http ${status ?? "unknown"})`,
        status ?? null,
      );
    }
    if (
      error instanceof NoObjectGeneratedError ||
      error instanceof NoOutputGeneratedError ||
      error instanceof JSONParseError ||
      error instanceof InvalidResponseDataError ||
      error instanceof TypeValidationError
    ) {
      return new AiSdkProviderError(
        "output_schema",
        "ai-sdk provider output failed structured schema validation",
      );
    }
    if (error instanceof TypeError) {
      return new AiSdkProviderError("network", "ai-sdk provider network request failed");
    }
    return new AiSdkProviderError("provider", "ai-sdk provider call failed");
  }
}
