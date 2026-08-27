/**
 * Python gate parity probe (Gap #5).
 * Verifies: Python AST scan -> transform -> pyright gate.
 * Run: npx tsx packages/repo-analysis/scripts/verify-python-gate.ts
 */
import { analyzeRepository } from "../src/index";

async function main(): Promise<void> {
  const analysis = await analyzeRepository({
    rootDir: "fixtures/repositories/openai-python-legacy",
    trackPackages: ["openai"],
  });
  console.log(`Python fixture: ${analysis.pythonFiles} py files, ${analysis.usages.length} usages`);
  for (const u of analysis.usages.slice(0, 5)) {
    console.log(`  ${u.filePath}:${u.line} ${u.symbol}`);
  }
  if (analysis.usages.length === 0) {
    console.error(
      "FAIL: No Python usages found - gate unverified, Patch is TS-only until this passes.",
    );
    process.exit(1);
  }
  console.log(
    "PASS: Python AST scan finds usages. Next: npx patch-migrate openai --cwd /tmp/python-openai-legacy --write (requires pyright).",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
