import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openaiConnector, openaiPythonConnector } from "@patchbay/vendor-connectors";
import { applyPythonClientBootstrap, generatePlan, validatePatchSyntax } from "./engine";
import { unifiedDiff } from "./diff";
import type { PlanInput } from "./types";

const OPENAI_FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/repositories/openai-node-legacy",
);

const PYTHON_FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/repositories/openai-python-legacy",
);

const MIGRATION_PAYLOAD = {
  sdk: "openai",
  fromVersion: "3.x",
  toVersion: "4.x",
  migration: {
    methodRenames: [{ from: "openai.createChatCompletion", to: "openai.chat.completions.create" }],
    responseChanges: [{ symbol: "completion.data", description: "v4 returns the body directly." }],
  },
};

function openAiInput(): PlanInput {
  const drafts = openaiConnector.normalizeChange({
    rawPayload: MIGRATION_PAYLOAD,
    sourceType: "SDK_RELEASE",
  });
  return {
    fixtureDir: OPENAI_FIXTURE,
    repositoryName: "ai-assistant-service",
    usages: [
      {
        filePath: "src/chat/chat-service.ts",
        line: 31,
        symbol: "openai.createChatCompletion",
        excerpt: '  const completion = openai.createChatCompletion({ model: "gpt-4", messages });',
      },
    ],
    patchSuggestions: openaiConnector.buildPatchSuggestions(drafts),
    normalizations: drafts,
    assessmentConfidence: 92,
  };
}

describe("generatePlan", () => {
  it("produces a rule-based patch for the openai fixture chat service", async () => {
    const plan = await generatePlan(openAiInput());

    expect(plan.patches).toHaveLength(1);
    const patch = plan.patches[0]!;
    expect(patch.filePath).toBe("src/chat/chat-service.ts");
    expect(patch.generationMethod).toBe("RULE_BASED");
    expect(patch.confidence).toBe(90);
    expect(patch.originalHash).not.toBe(patch.patchedHash);
    expect(plan.requiresHumanReview).toBe(false);
    expect(plan.skippedFiles).toEqual([]);

    expect(patch.patched).toContain("openai.chat.completions.create");
    expect(patch.patched).not.toContain("openai.createChatCompletion");
    expect(patch.patched).toContain("completion.choices[0]");
    expect(patch.patched).not.toContain("completion.data");

    expect(patch.unifiedDiff).toContain("--- a/src/chat/chat-service.ts");
    expect(patch.unifiedDiff).toContain("+++ b/src/chat/chat-service.ts");
    expect(patch.unifiedDiff).toContain("-  const completion = openai.createChatCompletion(");
    expect(patch.unifiedDiff).toContain("+  const completion = openai.chat.completions.create(");
  });

  it("returns a plan-only draft when no rule matches", async () => {
    const plan = await generatePlan({
      fixtureDir: OPENAI_FIXTURE,
      repositoryName: "ai-assistant-service",
      usages: [
        {
          filePath: "src/chat/chat-service.ts",
          line: 31,
          symbol: "openai.nonexistent",
          excerpt: "x",
        },
      ],
      patchSuggestions: [],
      normalizations: [],
      assessmentConfidence: 92,
    });

    expect(plan.patches).toEqual([]);
    expect(plan.requiresHumanReview).toBe(true);
    expect(plan.confidence).toBe(60);
    expect(plan.strategy).toContain("Plan-only");
  });

  it("skips files that do not parse after the edit", async () => {
    const input = openAiInput();
    input.fixtureDir = path.resolve(input.fixtureDir, "src/chat");
    const plan = await generatePlan(input);
    expect(plan.patches).toEqual([]);
  });

  it("applies feature-adoption inserts from NEW_CAPABILITY normalizations", async () => {
    const payload = {
      sdk: "openai",
      capabilities: [
        {
          symbol: "openai.createChatCompletion",
          feature: "Structured outputs (JSON mode)",
          searchText: 'model: "gpt-4"',
          insertText: ', response_format: { type: "json_object" }',
        },
      ],
    };
    const drafts = openaiConnector.normalizeChange({
      rawPayload: payload,
      sourceType: "SDK_RELEASE",
    });
    const plan = await generatePlan({
      fixtureDir: OPENAI_FIXTURE,
      repositoryName: "ai-assistant-service",
      usages: [
        {
          filePath: "src/chat/chat-service.ts",
          line: 31,
          symbol: "openai.createChatCompletion",
          excerpt:
            '  const completion = openai.createChatCompletion({ model: "gpt-4", messages });',
        },
      ],
      patchSuggestions: openaiConnector.buildPatchSuggestions(drafts),
      normalizations: drafts,
      assessmentConfidence: 92,
    });

    expect(drafts.some((d) => d.changeType === "NEW_CAPABILITY" && !d.breaking)).toBe(true);
    expect(plan.patches).toHaveLength(1);
    const patch = plan.patches[0]!;
    expect(patch.generationMethod).toBe("RULE_BASED");
    expect(patch.confidence).toBe(88);
    expect(patch.patched).toContain('model: "gpt-4", response_format: { type: "json_object" }');
    expect(patch.patched).toContain("openai.createChatCompletion");
    expect(patch.description).toContain("Adopt Structured outputs (JSON mode)");
  });
});

describe("python plans (openai-python v0 -> v1)", () => {
  const MIGRATION_PAYLOAD = {
    sdk: "openai-python",
    fromVersion: "0.x",
    toVersion: "1.x",
    migration: {
      methodRenames: [
        { from: "openai.ChatCompletion.create", to: "client.chat.completions.create" },
      ],
    },
  };

  function pythonInput(): PlanInput {
    const drafts = openaiPythonConnector.normalizeChange({
      rawPayload: MIGRATION_PAYLOAD,
      sourceType: "SDK_RELEASE",
    });
    return {
      fixtureDir: PYTHON_FIXTURE,
      repositoryName: "openai-python-legacy",
      usages: [
        {
          filePath: "src/chat.py",
          line: 10,
          symbol: "openai.ChatCompletion.create",
          excerpt:
            "completion = openai.ChatCompletion.create(model=DEFAULT_MODEL, messages=messages)",
        },
      ],
      patchSuggestions: openaiPythonConnector.buildPatchSuggestions(drafts),
      normalizations: drafts,
      assessmentConfidence: 90,
    };
  }

  it("rewrites the module call onto the v1 client and inserts the client bootstrap", async () => {
    const plan = await generatePlan(pythonInput());

    expect(plan.patches).toHaveLength(1);
    const patch = plan.patches[0]!;
    expect(patch.filePath).toBe("src/chat.py");
    expect(patch.generationMethod).toBe("RULE_BASED");
    expect(plan.skippedFiles).toEqual([]);

    expect(patch.patched).toContain("client.chat.completions.create(");
    expect(patch.patched).not.toContain("openai.ChatCompletion.create");
    expect(patch.patched).toContain("from openai import OpenAI");
    expect(patch.patched).toContain("client = OpenAI()");
    // Bootstrap lands in the import block, never inside run_chat().
    const constructionLine = patch.patched
      .split("\n")
      .findIndex((line) => line.startsWith("client = OpenAI()"));
    const defLine = patch.patched.split("\n").findIndex((line) => line.startsWith("def run_chat"));
    expect(constructionLine).toBeGreaterThan(-1);
    expect(constructionLine).toBeLessThan(defLine);
    expect(patch.description).toContain("client bootstrap");

    expect(await validatePatchSyntax(patch.filePath, patch.patched)).toBe(true);
  });

  it("rejects broken python via the tree-sitter syntax check", async () => {
    expect(await validatePatchSyntax("src/x.py", "def broken(:\n")).toBe(false);
    expect(await validatePatchSyntax("src/x.py", "x = 1\n")).toBe(true);
  });

  it("bootstrap insertion is idempotent and skips existing constructions", () => {
    const once = applyPythonClientBootstrap("import openai\n\nopenai.ChatCompletion.create()\n");
    expect(once).toContain("from openai import OpenAI");
    expect(once).toContain("client = OpenAI()");
    const twice = applyPythonClientBootstrap(once);
    expect(twice).toBe(once);

    const withClient = applyPythonClientBootstrap(
      "from openai import OpenAI\n\nclient = OpenAI(api_key='k')\n",
    );
    expect(withClient).not.toContain("client = OpenAI()\n");
  });

  it("prepends the bootstrap when the file has no import block", () => {
    const bootstrapped = applyPythonClientBootstrap("openai.Completion.create()\n");
    expect(bootstrapped.startsWith("from openai import OpenAI\nclient = OpenAI()\n")).toBe(true);
  });
});

describe("unifiedDiff", () => {
  it("emits a standard hunk for a single changed line", () => {
    const before = "a\nb\nc\nd\ne\nf\ng\n";
    const after = "a\nb\nX\nd\ne\nf\ng\n";
    const diff = unifiedDiff(before, after, "src/app.ts");

    expect(diff).toContain("--- a/src/app.ts");
    expect(diff).toContain("+++ b/src/app.ts");
    expect(diff).toMatch(/@@ -1,\d+ \+1,\d+ @@/);
    expect(diff).toContain("-c");
    expect(diff).toContain("+X");
  });

  it("reports no changes for identical content", () => {
    const diff = unifiedDiff("same\ncontent\n", "same\ncontent\n", "src/app.ts");
    expect(diff).toContain("(no changes)");
  });
});
