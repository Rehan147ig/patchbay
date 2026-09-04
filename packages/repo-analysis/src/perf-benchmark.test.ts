import { describe, expect, it } from "vitest";
import { analyzeSource } from "./ast";

/**
 * AST parse performance guard (production gate).
 *
 * Pins parse throughput with a generous threshold so genuine order-of-magnitude
 * regressions fail loudly without flaking on loaded CI runners. Prints the
 * measured number for the report.
 */
function syntheticFile(index: number): { path: string; content: string } {
  const imports = `import { openai } from "openai";\nimport { z } from "zod";\n`;
  const body = Array.from(
    { length: 20 },
    (_, i) =>
      `export async function handler${index}_${i}(input: string): Promise<string> {\n` +
      `  const client = new openai.OpenAI({ apiKey: process.env.KEY });\n` +
      `  const completion = await client.chat.completions.create({ model: "gpt-4o", messages: [{ role: "user", content: input }] });\n` +
      `  return completion.choices[0]?.message?.content ?? "";\n}\n`,
  ).join("\n");
  return { path: `src/gen/file${index}.ts`, content: `${imports}\n${body}` };
}

describe("AST parse throughput", () => {
  it("stays under 100ms/file on a 200-file synthetic corpus", () => {
    const files = Array.from({ length: 200 }, (_, i) => syntheticFile(i));
    const trackPackages = new Set(["openai", "zod"]);
    const start = performance.now();
    let usageCount = 0;
    for (const file of files) {
      const result = analyzeSource(file.content, file.path, trackPackages, {});
      usageCount += result.usages.length;
    }
    const elapsed = performance.now() - start;
    const perFile = elapsed / files.length;
    console.log(
      `AST parse: ${perFile.toFixed(2)}ms/file over ${files.length} files (${usageCount} usages)`,
    );
    expect(usageCount).toBeGreaterThan(0);
    expect(perFile).toBeLessThan(100);
  });
});
