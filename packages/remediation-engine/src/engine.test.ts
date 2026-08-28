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

  it("produces a plan-only draft for Python (ASSESS-only: no certified patch kit)", async () => {
    const plan = await generatePlan(pythonInput());

    // Demoted to ASSESS: no patch suggestions → plan-only output.
    expect(plan.patches).toHaveLength(0);
    expect(plan.requiresHumanReview).toBe(true);
    expect(plan.confidence).toBe(60);
    expect(plan.strategy).toContain("Plan-only");
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

describe("regression: safe refactoring pipeline", () => {
  it("handles multiple renames on the same line (Promise.all)", async () => {
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const dir = await mkdtemp(`${tmpdir()}/patch-multi-`);
    const filePath = "src/app.ts";
    // Actually test foo(oldA(), oldB()) same line
    const sameLine = "line1\nline2\nfoo(oldA(), oldB())\nline4\nline5\n";
    await import("node:fs/promises").then((fs) => fs.mkdir(`${dir}/src`, { recursive: true }));
    const { writeFile } = await import("node:fs/promises");
    await writeFile(`${dir}/${filePath}`, sameLine, "utf8");
    const plan = await generatePlan({
      fixtureDir: dir,
      repositoryName: "test",
      usages: [
        { filePath, line: 3, symbol: "oldA", excerpt: sameLine.trim() },
        { filePath, line: 3, symbol: "oldB", excerpt: sameLine.trim() },
      ],
      patchSuggestions: [
        { symbol: "oldA", replacement: "newA", description: "a", confidence: 90 },
        { symbol: "oldB", replacement: "newB", description: "b", confidence: 90 },
      ],
      normalizations: [],
      assessmentConfidence: 90,
    });
    expect(plan.patches).toHaveLength(1);
    expect(plan.patches[0]!.patched).toBe("line1\nline2\nfoo(newA(), newB())\nline4\nline5\n");
    expect(plan.patches[0]!.patched).not.toContain("oldA");
    expect(plan.patches[0]!.patched).not.toContain("oldB");
  });

  it("preserves CRLF line endings", async () => {
    const { mkdtemp, writeFile, mkdir } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const dir = await mkdtemp(`${tmpdir()}/patch-crlf-`);
    const filePath = "src/app.ts";
    const original = "line1\r\noldSymbol()\r\nline3\r\n";
    await mkdir(`${dir}/src`, { recursive: true });
    await writeFile(`${dir}/${filePath}`, original, "utf8");
    const plan = await generatePlan({
      fixtureDir: dir,
      repositoryName: "test",
      usages: [{ filePath, line: 2, symbol: "oldSymbol", excerpt: "oldSymbol()" }],
      patchSuggestions: [
        { symbol: "oldSymbol", replacement: "newSymbol", description: "x", confidence: 90 },
      ],
      normalizations: [],
      assessmentConfidence: 90,
    });
    expect(plan.patches).toHaveLength(1);
    const patched = plan.patches[0]!.patched;
    // Should still be CRLF, not normalized to LF, and only intended line changed
    expect(patched).toContain("\r\n");
    expect(patched).not.toContain("\noldSymbol()");
    expect(patched).toContain("newSymbol()");
    expect(patched.split("\r\n")).toHaveLength(original.split("\r\n").length);
  });

  it("applies Python bootstrap after renames (zero line shift during renames)", async () => {
    const { mkdtemp, writeFile, mkdir } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const dir = await mkdtemp(`${tmpdir()}/patch-py-`);
    const filePath = "src/chat.py";
    const original = "import os\n\nopenai.ChatCompletion.create(model='x')\n";
    await mkdir(`${dir}/src`, { recursive: true });
    await writeFile(`${dir}/${filePath}`, original, "utf8");
    // Use a Python-targeted suggestion that triggers bootstrap
    const plan = await generatePlan({
      fixtureDir: dir,
      repositoryName: "test",
      usages: [
        {
          filePath,
          line: 3,
          symbol: "openai.ChatCompletion.create",
          excerpt: "openai.ChatCompletion.create",
        },
      ],
      patchSuggestions: [
        {
          symbol: "openai.ChatCompletion.create",
          replacement: "client.chat.completions.create",
          description: "py",
          confidence: 90,
        },
      ],
      normalizations: [],
      assessmentConfidence: 90,
    });
    // Should have bootstrap + rename, and rename was at original line 3 (not shifted)
    expect(plan.patches).toHaveLength(1);
    const patched = plan.patches[0]!.patched;
    expect(patched).toContain("from openai import OpenAI");
    expect(patched).toContain("client = OpenAI()");
    expect(patched).toContain("client.chat.completions.create");
    // Ensure bootstrap is after imports, not before, and original line content still correct
    const lines = patched.split("\n");
    const bootstrapIdx = lines.findIndex((l) => l.includes("client = OpenAI()"));
    const renameIdx = lines.findIndex((l) => l.includes("client.chat.completions.create"));
    expect(bootstrapIdx).toBeGreaterThan(-1);
    expect(renameIdx).toBeGreaterThan(bootstrapIdx);
  });

  it("bails safely when line content drifted (TOCTOU)", async () => {
    const { mkdtemp, writeFile, mkdir } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const dir = await mkdtemp(`${tmpdir()}/patch-toctou-`);
    const filePath = "src/app.ts";
    const originalAtPatchTime = "const x = 1;\nconst y = 2;\n";
    await mkdir(`${dir}/src`, { recursive: true });
    await writeFile(`${dir}/${filePath}`, originalAtPatchTime, "utf8");
    // Usage was recorded at analysis time as line 1 with symbol oldSymbol, but file no longer contains it
    const plan = await generatePlan({
      fixtureDir: dir,
      repositoryName: "test",
      usages: [{ filePath, line: 1, symbol: "oldSymbol", excerpt: "oldSymbol()" }],
      patchSuggestions: [
        { symbol: "oldSymbol", replacement: "newSymbol", description: "x", confidence: 90 },
      ],
      normalizations: [],
      assessmentConfidence: 90,
    });
    // Should be skipped (no patch) because target line does not contain from
    expect(plan.patches).toHaveLength(0);
    expect(plan.skippedFiles).toContain(filePath);
  });
});

describe("hash-based TOCTOU guard (expectedFileHashes)", () => {
  it("fails closed when line inserted above target but same symbol on wrong line", async () => {
    const { mkdtemp, writeFile, mkdir, readFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { sha256Hex } = await import("./diff");
    const dir = await mkdtemp(`${tmpdir()}/patch-hash-`);
    const filePath = "src/app.ts";
    const atAnalysis = "line1\nline2\noldSymbol()\nline4\n";
    await mkdir(`${dir}/src`, { recursive: true });
    await writeFile(`${dir}/${filePath}`, atAnalysis, "utf8");
    const expectedHash = sha256Hex(atAnalysis);
    // Drift: insert comment containing same symbol at line 2, so line 3 (usage line 3) now is comment, but still contains oldSymbol
    const drifted = "line1\n// oldSymbol in comment\nline2\noldSymbol()\nline4\n";
    await writeFile(`${dir}/${filePath}`, drifted, "utf8");
    const plan = await generatePlan({
      fixtureDir: dir,
      repositoryName: "test",
      usages: [{ filePath, line: 3, symbol: "oldSymbol", excerpt: "oldSymbol()" }],
      patchSuggestions: [
        { symbol: "oldSymbol", replacement: "newSymbol", description: "x", confidence: 90 },
      ],
      normalizations: [],
      assessmentConfidence: 90,
      expectedFileHashes: new Map([[filePath, expectedHash]]),
    });
    // Hash mismatch -> no patch, even though line 3 still contains oldSymbol (in comment)
    expect(plan.patches).toHaveLength(0);
    expect(plan.skippedFiles).toContain(filePath);
    // Verify file not corrupted (still drifted content, not partially patched)
    expect(await readFile(`${dir}/${filePath}`, "utf8")).toBe(drifted);
  });

  it("allows patch when hash matches (no drift)", async () => {
    const { mkdtemp, writeFile, mkdir } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { sha256Hex } = await import("./diff");
    const dir = await mkdtemp(`${tmpdir()}/patch-hash-ok-`);
    const filePath = "src/app.ts";
    const content = "line1\nline2\noldSymbol()\nline4\n";
    await mkdir(`${dir}/src`, { recursive: true });
    await writeFile(`${dir}/${filePath}`, content, "utf8");
    const plan = await generatePlan({
      fixtureDir: dir,
      repositoryName: "test",
      usages: [{ filePath, line: 3, symbol: "oldSymbol", excerpt: "oldSymbol()" }],
      patchSuggestions: [
        { symbol: "oldSymbol", replacement: "newSymbol", description: "x", confidence: 90 },
      ],
      normalizations: [],
      assessmentConfidence: 90,
      expectedFileHashes: new Map([[filePath, sha256Hex(content)]]),
    });
    expect(plan.patches).toHaveLength(1);
    expect(plan.patches[0]!.patched).toContain("newSymbol()");
  });

  it("one conflicting file does not prevent another file from patching", async () => {
    const { mkdtemp, writeFile, mkdir } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { sha256Hex } = await import("./diff");
    const dir = await mkdtemp(`${tmpdir()}/patch-hash-multi-`);
    const fileA = "src/a.ts";
    const fileB = "src/b.ts";
    const contentA = "line1\noldSymbol()\nline3\n";
    const contentB = "line1\noldSymbol()\nline3\n";
    await mkdir(`${dir}/src`, { recursive: true });
    await writeFile(`${dir}/${fileA}`, contentA, "utf8");
    await writeFile(`${dir}/${fileB}`, contentB, "utf8");
    const wrongHash = sha256Hex("different");
    const plan = await generatePlan({
      fixtureDir: dir,
      repositoryName: "test",
      usages: [
        { filePath: fileA, line: 2, symbol: "oldSymbol", excerpt: "oldSymbol()" },
        { filePath: fileB, line: 2, symbol: "oldSymbol", excerpt: "oldSymbol()" },
      ],
      patchSuggestions: [
        { symbol: "oldSymbol", replacement: "newSymbol", description: "x", confidence: 90 },
      ],
      normalizations: [],
      assessmentConfidence: 90,
      expectedFileHashes: new Map([
        [fileA, wrongHash],
        [fileB, sha256Hex(contentB)],
      ]),
    });
    expect(plan.patches).toHaveLength(1);
    expect(plan.patches[0]!.filePath).toBe(fileB);
    expect(plan.skippedFiles).toContain(fileA);
    expect(plan.skippedFiles).not.toContain(fileB);
  });

  it("same-line multiple transformations still work with hash", async () => {
    const { mkdtemp, writeFile, mkdir } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { sha256Hex } = await import("./diff");
    const dir = await mkdtemp(`${tmpdir()}/patch-hash-same-`);
    const filePath = "src/app.ts";
    const content = "line1\nline2\nfoo(oldA(), oldB())\nline4\n";
    await mkdir(`${dir}/src`, { recursive: true });
    await writeFile(`${dir}/${filePath}`, content, "utf8");
    const plan = await generatePlan({
      fixtureDir: dir,
      repositoryName: "test",
      usages: [
        { filePath, line: 3, symbol: "oldA", excerpt: "foo(oldA(), oldB())" },
        { filePath, line: 3, symbol: "oldB", excerpt: "foo(oldA(), oldB())" },
      ],
      patchSuggestions: [
        { symbol: "oldA", replacement: "newA", description: "a", confidence: 90 },
        { symbol: "oldB", replacement: "newB", description: "b", confidence: 90 },
      ],
      normalizations: [],
      assessmentConfidence: 90,
      expectedFileHashes: new Map([[filePath, sha256Hex(content)]]),
    });
    expect(plan.patches).toHaveLength(1);
    expect(plan.patches[0]!.patched).toContain("foo(newA(), newB())");
  });
});
