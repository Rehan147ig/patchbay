import { describe, expect, it } from "vitest";
import { scanPatchSafety, scanPatches } from "./patch-safety";

describe("scanPatchSafety", () => {
  it("accepts a benign migration patch", () => {
    const content = `import { OpenAI } from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
client.chat.completions.create({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] });`;
    expect(scanPatchSafety("src/client.ts", content)).toEqual([]);
  });

  it("accepts words that merely resemble dangerous tokens", () => {
    expect(
      scanPatchSafety("src/eval-utils.ts", "export function evaluate(fn) { return fn(); }"),
    ).toEqual([]);
    expect(
      scanPatchSafety("src/index.ts", 'const stream = "echo & amp".replace(/&/, "and");'),
    ).toEqual([]);
  });

  it("rejects dynamic process execution", () => {
    const findings = scanPatchSafety("src/index.ts", 'require("child_process").exec("curl x")');
    expect(findings).toHaveLength(1);
    expect(findings[0]!.reason).toContain("process execution");
  });

  it("rejects eval and new Function", () => {
    expect(scanPatchSafety("src/a.ts", "eval(userInput)")).toHaveLength(1);
    expect(scanPatchSafety("src/b.ts", "const f = new Function(src);")).toHaveLength(1);
  });

  it("rejects shell constructs", () => {
    expect(scanPatchSafety("src/c.ts", 'run("rm -rf /")')).toHaveLength(1);
    expect(scanPatchSafety("src/d.sh", "$(dangerous)")).toHaveLength(1);
  });

  it("rejects path escapes", () => {
    expect(scanPatchSafety("src/e.ts", 'write("../../outside/x")')).toHaveLength(1);
    expect(scanPatchSafety("src/f.ts", 'const p = "/etc/passwd";')).toHaveLength(1);
  });

  it("rejects credential literals and hardcoded secret assignments", () => {
    expect(
      scanPatchSafety("src/g.ts", 'const key = "sk-abcdefghijklmnopqrstuvwxyz123456";'),
    ).toHaveLength(1);
    expect(
      scanPatchSafety("src/h.ts", 'password: "hunter2-hunter2"').map((f) => f.reason),
    ).toContain("hardcoded secret assignment");
  });

  it("aggregates findings across patches", () => {
    const verdict = scanPatches([
      { filePath: "a.ts", patched: "const x = 1;" },
      { filePath: "b.ts", patched: "eval(payload)" },
      { filePath: "c.ts", patched: "ok code" },
    ]);
    expect(verdict.safe).toBe(false);
    expect(verdict.findings).toHaveLength(1);
    expect(verdict.findings[0]!.filePath).toBe("b.ts");
  });
});
