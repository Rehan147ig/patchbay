import { measureWorkflow } from "@patchbay/ai-harness";
import { createAiProvider } from "@patchbay/ai-provider";
import type { PatchGenerationInput } from "@patchbay/domain";

/**
 * WP8 planner/reviewer performance bench (CLI).
 *
 * Usage:  pnpm --filter @patchbay/worker bench
 *
 * Modes:
 *  - default (AI_PROVIDER unset): deterministic mock — measures harness
 *    overhead only (schema validation, budgeting, accounting), never a truth
 *    claim about model latency.
 *  - AI_PROVIDER=ai-sdk + OPENAI_API_KEY: live measurement of the real
 *    planner + independent reviewer sequence (2 model calls per round).
 *
 * Env tuning: BENCH_ROUNDS (default 5), BENCH_BUDGET_CENTS, and the standard
 * AI_* provider tuning vars (AI_TIMEOUT_MS etc.). Exits 1 when the verdict
 * fails its thresholds.
 */

const env = process.env;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const provider = createAiProvider(env);
if (env.AI_PROVIDER === "ai-sdk" && !env.OPENAI_API_KEY) {
  fail("AI_PROVIDER=ai-sdk requires OPENAI_API_KEY (live bench)");
}

const rounds = Math.max(1, Number.parseInt(env.BENCH_ROUNDS ?? "5", 10) || 5);
const budgetCents = env.BENCH_BUDGET_CENTS
  ? Math.max(0, Number.parseInt(env.BENCH_BUDGET_CENTS, 10) || 100)
  : undefined;

const INPUT: PatchGenerationInput = {
  releaseRecordId: "bench-r1",
  repositoryId: "bench-repo",
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
      description: "Method openai.createChatCompletion was renamed.",
      breaking: true,
      affectedSymbols: ["openai.createChatCompletion"],
      rule: "method-rename",
    },
  ],
  modules: [
    {
      filePath: "src/chat/chat-service.ts",
      edgeKinds: ["INVOKES_API", "USES_PACKAGE"],
      evidenceCount: 1,
    },
  ],
};

const report = await measureWorkflow(provider, INPUT, { rounds, budgetCents });

console.log(JSON.stringify(report, null, 2));
if (report.verdict === "FAIL") {
  fail(`bench verdict FAIL (provider=${report.provider}, rounds=${report.rounds})`);
}
