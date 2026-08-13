import { describe, expect, it } from "vitest";
import { EVAL_CORPUS, formatEvalCorpusReport, runEvalCase, runEvalCorpus } from "./eval-corpus";

/**
 * H8 full-loop evaluation gates (roadmap launch metrics): replay the complete
 * deterministic relay on the real fixture repositories and gate:
 *   - dependency match recall          >= 95%
 *   - affected-usage match precision   >= 90% (false-positive alerts < 10%)
 *   - automatic patch validation       >= 80%
 *   - policy outcome correctness       =  100% against labeled ground truth
 * Ground truth is explicit in eval-corpus.ts; re-label consciously.
 */
const RECALL_TARGET = 0.95;
const PRECISION_TARGET = 0.9;
const VALIDATION_TARGET = 0.8;

let cachedEval: ReturnType<typeof runEvalCorpus> | null = null;
/** Memoized full-corpus replay shared by the gates below. */
function corpus(): ReturnType<typeof runEvalCorpus> {
  cachedEval ??= runEvalCorpus();
  return cachedEval;
}

describe("H8 full-loop evaluation corpus (launch-metric gates)", () => {
  it("replays without a single mismatch", async () => {
    const metrics = (await corpus()).metrics;
    expect(metrics.mismatches).toEqual([]);
  });

  it("meets the dependency match recall target (>= 95%)", async () => {
    const metrics = (await corpus()).metrics;
    expect(metrics.matchRecall).toBeGreaterThanOrEqual(RECALL_TARGET);
  });

  it("meets the affected-usage match precision target (>= 90%)", async () => {
    const metrics = (await corpus()).metrics;
    expect(metrics.precision).toBeGreaterThanOrEqual(PRECISION_TARGET);
    expect(metrics.falsePositiveAlerts).toBe(0);
  });

  it("meets the automatic patch validation target (>= 80%)", async () => {
    const metrics = (await corpus()).metrics;
    expect(metrics.validationRate).toBeGreaterThanOrEqual(VALIDATION_TARGET);
  });

  it("ends at the labeled policy decision for every entry", async () => {
    const metrics = (await corpus()).metrics;
    expect(metrics.policyCorrect).toBe(1);
  });

  it("reports the metrics table in failure output", async () => {
    const result = await corpus();
    expect(result.metrics.entries).toBe(EVAL_CORPUS.length);
    expect(formatEvalCorpusReport(result.metrics)).toContain("dependency match recall");
    expect(formatEvalCorpusReport(result.metrics)).toContain("100.0%");
    expect(result.report).toContain("H8 full-loop evaluation corpus");
  });

  it("is not vacuous: at least one match, patch, approval gate and plan-only gate", async () => {
    const matched = EVAL_CORPUS.filter((entry) => entry.expectedMatched);
    const patched = EVAL_CORPUS.filter((entry) => entry.expectedFiles.length > 0);
    const approvalGated = EVAL_CORPUS.filter(
      (entry) => entry.expectedDecision === "REQUIRE_APPROVAL",
    );
    const planOnly = EVAL_CORPUS.filter((entry) => entry.expectedDecision === "ALLOW_PLAN_ONLY");
    expect(matched.length).toBeGreaterThanOrEqual(3);
    expect(patched.length).toBeGreaterThanOrEqual(3);
    expect(approvalGated.length).toBeGreaterThanOrEqual(3);
    expect(planOnly.length).toBeGreaterThanOrEqual(4);
    expect((await corpus()).metrics.patchRecall).toBe(1);
  });
});

describe("H8 per-entry cases", () => {
  it("an unmixed set of vendors exercises connectors end to end", async () => {
    const vendors = new Set(EVAL_CORPUS.map((entry) => entry.vendor));
    expect(vendors).toEqual(new Set(["openai", "stripe", "twilio", "auth0"]));
  });

  it("a subsequent major release never alerts on a repo pinned to an older range", async () => {
    const entries = EVAL_CORPUS.filter((entry) => !entry.expectedMatched);
    for (const entry of entries) {
      const replay = await runEvalCorpus([entry]);
      expect(replay.metrics.mismatches).toEqual([]);
      expect(replay.metrics.falsePositiveAlerts).toBe(0);
    }
  });

  it("labels allow-structural coverage: each full-loop entry carries its own facts", () => {
    for (const entry of EVAL_CORPUS.filter((e) => e.expectedFiles.length > 0)) {
      expect(entry.facts).toBeDefined();
    }
  });
});

describe("H8 case-level assertions", () => {
  for (const entry of EVAL_CORPUS.filter((e) => e.expectedFiles.length > 0)) {
    it(`${entry.id}: patches the expected file(s) with a parseable diff`, async () => {
      const result = await runEvalCase(entry);
      expect(result.patchFiles).toEqual([...entry.expectedFiles].sort());
      expect(result.validationPassed).toBe(true);
      expect(result.skippedFiles).toEqual([]);
    });
  }

  for (const entry of EVAL_CORPUS.filter((e) => !e.expectedMatched)) {
    it(`${entry.id}: unmatched release produces no patches and no plan mandates approval`, async () => {
      const replay = await runEvalCorpus([entry]);
      expect(replay.cases[0]?.matched).toBe(false);
      expect(replay.cases[0]?.patchFiles).toEqual([]);
      expect(replay.cases[0]?.decision).toBe(entry.expectedDecision);
      expect(replay.metrics.mismatches).toEqual([]);
    });
  }
});
