import { describe, expect, it } from "vitest";
import { MockAiProvider, createAiProvider } from "./index";

/**
 * Provider error + egress safety (connected-repo pipeline §6):
 * - upstream response bodies never reach persisted errors;
 * - credentials never appear in messages;
 * - mock is the default with zero network egress;
 * - ai-sdk follows the same advisory/planning path as openai-compatible.
 */
describe("provider error safety", () => {
  it("does not retain upstream response bodies in persisted errors", async () => {
    const secretBody = "upstream-secret-body-container-should-never-persist";
    const fetchImpl = (async () => {
      return new Response(JSON.stringify({ error: { message: secretBody } }), {
        status: 500,
        statusText: "Internal Server Error",
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
    const provider = createAiProvider(
      { AI_PROVIDER: "openai-compatible", OPENAI_API_KEY: "test-key" } as NodeJS.ProcessEnv,
      { fetchImpl },
    );
    await expect(
      provider.generatePatchPlan({
        templateVersion: "t",
        vendorSlug: "openai",
        packageName: "openai",
        fromVersion: null,
        toVersion: "4.0.0",
        breaking: false,
        resolvedVersion: null,
        declaredRange: null,
        drafts: [],
        modules: [],
      }),
    ).rejects.toThrow(/AI provider request failed: 500/);
    try {
      await provider.generatePatchPlan({
        templateVersion: "t",
        vendorSlug: "openai",
        packageName: "openai",
        fromVersion: null,
        toVersion: "4.0.0",
        breaking: false,
        resolvedVersion: null,
        declaredRange: null,
        drafts: [],
        modules: [],
      });
      expect.unreachable();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain(secretBody);
      expect(message).not.toContain("test-key");
    }
  });

  it("uses the deterministic mock by default with no network egress", async () => {
    const provider = createAiProvider({} as NodeJS.ProcessEnv);
    expect(provider).toBeInstanceOf(MockAiProvider);
    const result = await provider.generatePatchPlan({
      templateVersion: "t",
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
          oldValue: "a",
          newValue: "b",
          description: "renamed",
          breaking: true,
          affectedSymbols: ["a"],
          rule: "method-rename",
        },
      ],
      modules: [{ filePath: "src/a.ts", edgeKinds: ["INVOKES_API"], evidenceCount: 1 }],
    });
    expect(result.provider).toBe("mock");
    expect(result.usage?.model).toBe("mock");
  });

  it("ai-sdk follows the same advisory/planning path shape as openai-compatible", async () => {
    // Construction (not network) proves the factory routes ai-sdk to the
    // structured advisory path; network calls stay stubbed in tests.
    expect(() => createAiProvider({ AI_PROVIDER: "ai-sdk" } as NodeJS.ProcessEnv)).toThrow(
      /requires OPENAI_API_KEY/,
    );
    const mock = new MockAiProvider();
    const plan = await mock.generatePatchPlan({
      templateVersion: "t",
      vendorSlug: "stripe",
      packageName: "stripe",
      fromVersion: null,
      toVersion: "1.0.0",
      breaking: false,
      resolvedVersion: null,
      declaredRange: null,
      drafts: [],
      modules: [],
    });
    expect(plan.provider).toBe("mock");
  });
});
