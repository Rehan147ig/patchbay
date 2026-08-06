import { describe, expect, it, vi } from "vitest";
import { RiskLevel, RiskTag } from "@patchbay/domain";
import { MockAiProvider, OpenAiCompatibleProvider, createAiProvider } from "./index";
import type { AiPlanDraftInput } from "./openai-compatible";

const sampleInput: AiPlanDraftInput = {
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

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText: ok ? "OK" : "Error",
    headers: { "Content-Type": "application/json" },
  });
}

describe("MockAiProvider", () => {
  const provider = new MockAiProvider();

  it("returns a deterministic draft without network access", async () => {
    const draft = await provider.draftRemediationPlan(sampleInput);
    expect(draft.requiresHumanReview).toBe(true);
    expect(draft.confidence).toBeGreaterThanOrEqual(0);
    expect(draft.confidence).toBeLessThanOrEqual(100);
    expect(draft.riskTags.length).toBe(0);
    expect(draft.steps.length).toBeGreaterThan(0);
    expect(draft.applicableChangeTypes).toContain("METHOD_RENAMED");

    const again = await provider.draftRemediationPlan(sampleInput);
    expect(again).toEqual(draft);
  });

  it("flags payment/auth/webhook risk from the vendor slug", async () => {
    const draft = await provider.draftRemediationPlan({
      ...sampleInput,
      vendorSlug: "stripe",
    });
    expect(draft.riskTags).toContain(RiskTag.PAYMENT);
    expect(draft.riskLevel).toBe(RiskLevel.HIGH);
  });

  it("lowers confidence and raises risk for breaking changes", async () => {
    const draft = await provider.draftRemediationPlan({
      ...sampleInput,
      description: "Breaking: parameter now required",
    });
    expect(draft.confidence).toBe(62);
    expect(draft.riskLevel).toBe(RiskLevel.MEDIUM);
  });
});

describe("OpenAiCompatibleProvider", () => {
  it("calls the chat completions endpoint with redacted-safe auth and parses output", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        messages: Array<{ role: string; content: string }>;
      };
      expect(body.messages[0]?.role).toBe("system");
      expect(body.messages[1]?.content).toContain("openai.createChatCompletion");
      return jsonResponse({
        choices: [
          {
            message: {
              content: JSON.stringify({
                rationale: "Upgrade to the v4 client.",
                steps: [{ description: "Rename the method call" }],
                confidence: 80,
                requiresHumanReview: true,
                riskLevel: "LOW",
                riskTags: [],
                suggestedEdits: [],
                applicableChangeTypes: ["METHOD_RENAMED"],
              }),
            },
          },
        ],
      });
    });

    const provider = new OpenAiCompatibleProvider({
      apiKey: "sk-test-secret",
      model: "gpt-4o-mini",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const draft = await provider.draftRemediationPlan(sampleInput);
    expect(draft.rationale).toContain("v4 client");
    expect(draft.confidence).toBe(80);

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer sk-test-secret");
  });

  it("throws a key-free error when the API responds with an error", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ message: "bad key" }, false, 401));
    const provider = new OpenAiCompatibleProvider({
      apiKey: "sk-secret-value",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(provider.draftRemediationPlan(sampleInput)).rejects.toThrow(/401/);
    await expect(provider.draftRemediationPlan(sampleInput)).rejects.not.toThrow(/sk-secret/);
  });

  it("rejects output that fails Zod validation", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        choices: [{ message: { content: JSON.stringify({ notTheSchema: true }) } }],
      }),
    );
    const provider = new OpenAiCompatibleProvider({
      apiKey: "sk-test-secret",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(provider.draftRemediationPlan(sampleInput)).rejects.toThrow(/schema validation/);
  });

  it("throws on non-JSON message content", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ choices: [{ message: { content: "plain text, not json" } }] }),
    );
    const provider = new OpenAiCompatibleProvider({
      apiKey: "sk-test-secret",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(provider.draftRemediationPlan(sampleInput)).rejects.toThrow(/invalid JSON/);
  });
});

describe("createAiProvider", () => {
  it("defaults to the mock provider", () => {
    expect(createAiProvider({})).toBeInstanceOf(MockAiProvider);
    expect(createAiProvider({ AI_PROVIDER: "mock" })).toBeInstanceOf(MockAiProvider);
  });

  it("throws when openai mode is requested without a key", () => {
    expect(() => createAiProvider({ AI_PROVIDER: "openai" })).toThrow(/OPENAI_API_KEY/);
    expect(() => createAiProvider({ AI_PROVIDER: "openai-compatible" })).toThrow(/OPENAI_API_KEY/);
  });

  it("builds an OpenAiCompatibleProvider when configured", () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ choices: [{ message: { content: "{}" } }] }),
    );
    const provider = createAiProvider(
      { AI_PROVIDER: "openai", OPENAI_API_KEY: "sk-test" },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(provider).toBeInstanceOf(OpenAiCompatibleProvider);
  });
});
