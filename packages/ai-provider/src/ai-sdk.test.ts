import { describe, expect, it, vi } from "vitest";
import type {
  AiPlanDraftInput,
  AiSdkProviderConfig,
  PatchPlanPromptRequest,
  PlanReviewPromptRequest,
} from "./index";
import { AiSdkProvider, AiSdkProviderError, createAiProvider } from "./index";

const API_KEY = "sk-super-secret-key";

const PLAN_FIXTURE = {
  releaseRecordId: "release-record-id",
  repositoryId: "repo-id",
  rationale: "Upgrade to the v4 client.",
  confidence: 80,
  requiresHumanReview: true,
  riskLevel: "LOW",
  riskTags: [],
  edits: [
    {
      filePath: "src/chat/chat-service.ts",
      expectedSourceHash: "0".repeat(64),
      operation: "REPLACE",
      searchText: "openai.createChatCompletion",
      replacement: "openai.chat.completions.create",
      precondition: "caller expression is a member call on the client instance",
      description: "Rename to the v4 API",
      confidence: 85,
    },
  ],
  validationProfile: ["typecheck"],
  addressedSymbols: ["openai.createChatCompletion"],
};

const VERDICT_FIXTURE = {
  approved: true,
  independent: true,
  confidence: 78,
  summary: "Independent review passed.",
  issues: [],
};

const DRAFT_FIXTURE = {
  rationale: "Upgrade to the v4 client.",
  steps: [{ description: "Rename the method call" }],
  confidence: 80,
  requiresHumanReview: true,
  riskLevel: "LOW",
  riskTags: [],
  suggestedEdits: [],
  applicableChangeTypes: ["METHOD_RENAMED"],
};

const PLANNER_INPUT: PatchPlanPromptRequest = {
  templateVersion: "h4-v1",
  vendorSlug: "openai",
  packageName: "openai",
  fromVersion: "3.3.0",
  toVersion: "4.0.0",
  breaking: true,
  resolvedVersion: "3.3.0",
  declaredRange: "^3.3.0",
  drafts: [
    {
      changeType: "METHOD_RENAMED",
      oldValue: "openai.createChatCompletion",
      newValue: "openai.chat.completions.create",
      description: "renamed",
      breaking: true,
      affectedSymbols: ["openai.createChatCompletion"],
      rule: "method-rename",
    },
  ],
  modules: [{ filePath: "src/chat/chat-service.ts", edgeKinds: ["INVOKES_API"], evidenceCount: 1 }],
};

const REVIEW_INPUT: PlanReviewPromptRequest = {
  templateVersion: "h4-v1",
  packageName: "openai",
  fromVersion: "3.3.0",
  toVersion: "4.0.0",
  breaking: true,
  plan: {
    rationale: "Upgrade to the v4 client.",
    confidence: 80,
    edits: [{ filePath: "src/chat/chat-service.ts", operation: "REPLACE", description: "rename" }],
    addressedSymbols: ["openai.createChatCompletion"],
  },
  evidence: {
    modules: [{ filePath: "src/chat/chat-service.ts", edgeKinds: ["INVOKES_API"] }],
  },
};

const DRAFT_INPUT: AiPlanDraftInput = {
  vendorSlug: "openai",
  changeType: "METHOD_RENAMED",
  oldValue: "openai.createChatCompletion",
  newValue: "openai.chat.completions.create",
  description: "Method renamed",
  affectedSymbols: ["openai.createChatCompletion"],
  usages: [
    {
      filePath: "src/chat/chat-service.ts",
      excerpt: 'const completion = openai.createChatCompletion({ model: "gpt-4", messages });',
    },
  ],
};

function chatResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: {
      "content-type": "application/json",
      "x-request-id": "req_test_1",
    },
  });
}

function completionBody(content: unknown): Record<string, unknown> {
  return {
    id: "req_test_1",
    object: "chat.completion",
    created: 1_700_000_000,
    model: "gpt-4o-mini",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: JSON.stringify(content) },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
  };
}

function okProvider(fetchImpl: typeof fetch, overrides: Partial<AiSdkProviderConfig> = {}) {
  return new AiSdkProvider({
    apiKey: API_KEY,
    model: "gpt-4o-mini",
    fetchImpl,
    maxRetries: 0,
    ...overrides,
  });
}

async function errorMessageOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("expected the promise to reject");
}

describe("AiSdkProvider", () => {
  it("parses typed structured planner output through the domain PatchPlan schema", async () => {
    const fetchImpl = vi.fn(async (_url: unknown, _init?: RequestInit) =>
      chatResponse(completionBody(PLAN_FIXTURE)),
    );
    const provider = okProvider(fetchImpl as unknown as typeof fetch);

    const result = await provider.generatePatchPlan(PLANNER_INPUT);

    expect(result.provider).toBe("ai-sdk");
    expect(result.requestId).toBe("req_test_1");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 20, model: "gpt-4o-mini" });
    const plan = result.output as { rationale: string; edits: unknown[] };
    expect(plan.rationale).toContain("v4 client");
    expect(plan.edits).toHaveLength(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toContain("/chat/completions");
    const headers = (init?.headers as Record<string, string>) ?? {};
    expect(headers.authorization).toBe(`Bearer ${API_KEY}`);
  });

  it("parses typed structured reviewer output through the domain reviewVerdict schema", async () => {
    const fetchImpl = vi.fn(async () => chatResponse(completionBody(VERDICT_FIXTURE)));
    const provider = okProvider(fetchImpl as unknown as typeof fetch);

    const result = await provider.reviewPatchPlan(REVIEW_INPUT);

    const verdict = result.output as { approved: boolean; independent: boolean };
    expect(verdict.approved).toBe(true);
    expect(verdict.independent).toBe(true);
    expect(result.provider).toBe("ai-sdk");
  });

  it("returns a typed AiPlanDraft for the draft endpoint", async () => {
    const fetchImpl = vi.fn(async () => chatResponse(completionBody(DRAFT_FIXTURE)));
    const provider = okProvider(fetchImpl as unknown as typeof fetch);

    const draft = await provider.draftRemediationPlan(DRAFT_INPUT);

    expect(draft.confidence).toBe(80);
    expect(draft.steps[0]?.description).toBe("Rename the method call");
    expect(draft.requiresHumanReview).toBe(true);
  });

  it("classifies malformed model output as an output_schema violation without the key", async () => {
    const fetchImpl = vi.fn(async () => chatResponse(completionBody("this is not json")));
    const provider = okProvider(fetchImpl as unknown as typeof fetch);

    const error = await provider.generatePatchPlan(PLANNER_INPUT).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(AiSdkProviderError);
    expect((error as AiSdkProviderError).kind).toBe("output_schema");
    expect((error as Error).message).not.toContain(API_KEY);
  });

  it("classifies schema-non-conforming output as an output_schema violation", async () => {
    const fetchImpl = vi.fn(async () => chatResponse(completionBody({ notTheSchema: true })));
    const provider = okProvider(fetchImpl as unknown as typeof fetch);

    const error = await provider.reviewPatchPlan(REVIEW_INPUT).then(
      () => null,
      (e: unknown) => e,
    );
    expect((error as AiSdkProviderError).kind).toBe("output_schema");
    expect((error as Error).message).not.toContain(API_KEY);
  });

  it("classifies provider HTTP 500s after bounded retries without the key", async () => {
    const fetchImpl = vi.fn(async () => chatResponse({ error: "boom" }, 500));
    const provider = okProvider(fetchImpl as unknown as typeof fetch, { maxRetries: 1 });

    const error = await provider.generatePatchPlan(PLANNER_INPUT).then(
      () => null,
      (e: unknown) => e,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect((error as AiSdkProviderError).kind).toBe("provider");
    expect((error as AiSdkProviderError).statusCode).toBe(500);
    expect((error as Error).message).not.toContain(API_KEY);
  });

  it("classifies 401 as an auth error without retrying", async () => {
    const fetchImpl = vi.fn(async () => chatResponse({ error: "bad key" }, 401));
    const provider = okProvider(fetchImpl as unknown as typeof fetch);

    const error = await provider.generatePatchPlan(PLANNER_INPUT).then(
      () => null,
      (e: unknown) => e,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect((error as AiSdkProviderError).kind).toBe("auth");
    expect((error as Error).message).not.toContain(API_KEY);
  });

  it("classifies 429 as rate limited", async () => {
    const fetchImpl = vi.fn(async () => chatResponse({ error: "slow down" }, 429));
    const provider = okProvider(fetchImpl as unknown as typeof fetch);

    const error = await provider.generatePatchPlan(PLANNER_INPUT).then(
      () => null,
      (e: unknown) => e,
    );
    expect((error as AiSdkProviderError).kind).toBe("rate_limited");
    expect((error as Error).message).not.toContain(API_KEY);
  });

  it("times out a hung provider call and classifies it as timeout", async () => {
    const fetchImpl = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
        }),
    );
    const provider = okProvider(fetchImpl as unknown as typeof fetch, { timeoutMs: 50 });

    const error = await provider.generatePatchPlan(PLANNER_INPUT).then(
      () => null,
      (e: unknown) => e,
    );
    expect((error as AiSdkProviderError).kind).toBe("timeout");
    expect((error as Error).message).not.toContain(API_KEY);
  });

  it("honours caller cancellation and classifies it as aborted", async () => {
    const fetchImpl = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
        }),
    );
    const provider = okProvider(fetchImpl as unknown as typeof fetch, { timeoutMs: 5_000 });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 30);

    const error = await provider
      .generatePatchPlan(PLANNER_INPUT, { signal: controller.signal })
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect((error as AiSdkProviderError).kind).toBe("aborted");
    expect((error as Error).message).not.toContain(API_KEY);
  });

  it("never fails over to the mock: provider errors surface classified, always", async () => {
    const fetchImpl = vi.fn(async () => chatResponse({ error: "boom" }, 500));
    const provider = okProvider(fetchImpl as unknown as typeof fetch, { maxRetries: 0 });

    const error = await provider.generatePatchPlan(PLANNER_INPUT).then(
      () => null,
      (e: unknown) => e,
    );
    expect((error as AiSdkProviderError).kind).toBe("provider");
    expect((error as Error).message).not.toContain("deterministic");
    expect((error as Error).message).not.toContain(API_KEY);
  });

  it("opens the circuit breaker after consecutive failures and fails fast", async () => {
    const fetchImpl = vi.fn(async () => chatResponse({ error: "boom" }, 500));
    const provider = okProvider(fetchImpl as unknown as typeof fetch, {
      maxRetries: 0,
      circuitBreaker: { maxConsecutiveFailures: 2, cooldownMs: 60_000 },
    });

    await expect(provider.generatePatchPlan(PLANNER_INPUT)).rejects.toMatchObject({
      kind: "provider",
    });
    await expect(provider.generatePatchPlan(PLANNER_INPUT)).rejects.toMatchObject({
      kind: "provider",
    });
    const before = fetchImpl.mock.calls.length;
    await expect(provider.generatePatchPlan(PLANNER_INPUT)).rejects.toMatchObject({
      kind: "circuit_open",
    });
    expect(fetchImpl.mock.calls.length).toBe(before);
  });

  it("resets the breaker on a successful call after cooldown", async () => {
    let fail = true;
    const fetchImpl = vi.fn(async () =>
      fail ? chatResponse({ error: "boom" }, 500) : chatResponse(completionBody(PLAN_FIXTURE)),
    );
    const provider = okProvider(fetchImpl as unknown as typeof fetch, {
      maxRetries: 0,
      circuitBreaker: { maxConsecutiveFailures: 1, cooldownMs: 20 },
    });

    await expect(provider.generatePatchPlan(PLANNER_INPUT)).rejects.toMatchObject({
      kind: "provider",
    });
    await expect(provider.generatePatchPlan(PLANNER_INPUT)).rejects.toMatchObject({
      kind: "circuit_open",
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    fail = false;
    const result = await provider.generatePatchPlan(PLANNER_INPUT);
    expect((result.output as { rationale: string }).rationale).toContain("v4 client");
  });

  it("rejects models outside the allowlist before any network call", () => {
    const fetchImpl = vi.fn(async () => chatResponse(completionBody(PLAN_FIXTURE)));
    expect(
      () =>
        new AiSdkProvider({
          apiKey: API_KEY,
          model: "gpt-4",
          allowedModels: ["gpt-4o-mini"],
          fetchImpl: fetchImpl as unknown as typeof fetch,
        }),
    ).toThrow(/not in the allowlist/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects base-url hosts outside the allowlist before any network call", () => {
    const fetchImpl = vi.fn(async () => chatResponse(completionBody(PLAN_FIXTURE)));
    expect(
      () =>
        new AiSdkProvider({
          apiKey: API_KEY,
          baseUrl: "https://evil.example.com/v1",
          allowedBaseUrlHosts: ["api.openai.com"],
          fetchImpl: fetchImpl as unknown as typeof fetch,
        }),
    ).toThrow(/not in the allowlist/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("createAiProvider (ai-sdk mode)", () => {
  it("requires OPENAI_API_KEY", () => {
    expect(() => createAiProvider({ AI_PROVIDER: "ai-sdk" })).toThrow(/OPENAI_API_KEY/);
  });

  it("builds an AiSdkProvider when configured", () => {
    const fetchImpl = vi.fn(async () => chatResponse(completionBody(PLAN_FIXTURE)));
    const provider = createAiProvider(
      { AI_PROVIDER: "ai-sdk", OPENAI_API_KEY: "sk-test", OPENAI_MODEL: "gpt-4o-mini" },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(provider).toBeInstanceOf(AiSdkProvider);
  });

  it("never lets the api key reach an error message from any failure path", async () => {
    const failing = vi.fn(async () => chatResponse({ error: `unauthorized ${API_KEY}` }, 401));
    const provider = okProvider(failing as unknown as typeof fetch);
    const message = await errorMessageOf(provider.generatePatchPlan(PLANNER_INPUT));
    expect(message).not.toContain(API_KEY);
  });
});
