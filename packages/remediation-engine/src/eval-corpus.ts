/**
 * H8 full-loop evaluation corpus (roadmap "Evaluation and Launch Metrics").
 *
 * Replays the complete deterministic relay per supported vendor against the
 * real fixture repositories:
 *
 *   release evidence → dependency/API match (evaluateReleaseMatch)
 *   → connector normalization → deterministic plan (generatePlan)
 *   → patch validation (re-parse) → policy outcome (evaluatePolicy)
 *
 * and reports the roadmap launch metrics:
 *   - dependency match recall      >= 95%
 *   - affected-usage match precision >= 90% (no false alerts)
 *   - automatic patch validation   >= 80%
 *   - false-positive alert rate    <  10%
 *   - policy outcomes match ground truth (100%)
 *
 * Ground truth is explicit per (entry, aspect) pair, so changing the matcher,
 * a connector, the engine, or the policy requires consciously re-labeling the
 * corpus instead of silently drifting. Pure and DB-free: runs in CI, no
 * network, no database.
 */
import type { RiskTag } from "@patchbay/domain";
import { PolicyDecision, evaluateReleaseMatch } from "@patchbay/domain";
import { evaluatePolicy } from "@patchbay/policy-engine";
import {
  analyzeRepository,
  resolveFixtureDir,
  type RepositoryAnalysis,
} from "@patchbay/repo-analysis";
import { getConnector } from "@patchbay/vendor-connectors";
import { generatePlan, reparseCheck } from "./engine";
import type { PlanDraft } from "./types";

export interface EvalCorpusEntry {
  id: string;
  vendor: string;
  fixture: string;
  packageName: string;
  /** Release evidence: the released version and its predecessor. */
  releaseVersion: string;
  previousVersion: string;
  /** Raw change facts fed to the vendor connector (deterministic, no AI). */
  payload: Record<string, unknown>;
  /** Ground truth: does this release match the fixture's pinned version? */
  expectedMatched: boolean;
  /** Ground truth: files the deterministic engine must patch ([] = none). */
  expectedFiles: string[];
  /** Change-classification facts (breaking/review required) that drive policy. */
  facts: {
    breaking: boolean;
    requiresHumanReview: boolean;
    riskTags: RiskTag[];
  };
  /** Ground truth: policy decision the full chain must end at. */
  expectedDecision: PolicyDecision;
}

export interface EvalCaseResult {
  id: string;
  matched: boolean;
  patchFiles: string[];
  skippedFiles: string[];
  planConfidence: number | null;
  /** True when patched content re-parses for every patch of the entry. */
  validationPassed: boolean;
  decision: PolicyDecision;
}

export interface EvalMismatch {
  entryId: string;
  aspect: "match" | "patches" | "analyser-errors" | "validation" | "policy" | "skipped";
  expected: string;
  actual: string;
  detail?: string;
}

export interface EvalMetrics {
  entries: number;
  /** Labeled-matched releases correctly matched (includes exact pins). */
  matchRecall: number;
  /** Labeled-unmatched releases that produced zero patches (no false alerts). */
  precision: number;
  /** Expected patch files actually produced / expected patch files. */
  patchRecall: number;
  /** Patched files that re-parse / patched files. */
  validationRate: number;
  /** Entries ending at the labeled policy decision / entries. */
  policyCorrect: number;
  /** Entries where an unmatched release still produced an alert artifact. */
  falsePositiveAlerts: number;
  mismatches: EvalMismatch[];
}

const TRACKED = ["stripe", "openai", "twilio", "auth0"];

export const EVAL_CORPUS: EvalCorpusEntry[] = [
  {
    id: "openai-3.3.0",
    vendor: "openai",
    fixture: "openai-node-legacy",
    packageName: "openai",
    releaseVersion: "3.3.0",
    previousVersion: "3.2.1",
    payload: {
      sdk: "openai",
      fromVersion: "3.x",
      toVersion: "4.x",
      migration: {
        methodRenames: [
          { from: "openai.createChatCompletion", to: "openai.chat.completions.create" },
        ],
        responseChanges: [
          { symbol: "completion.data", description: "v4 returns the body directly." },
        ],
      },
    },
    expectedMatched: true,
    expectedFiles: ["src/chat/chat-service.ts"],
    facts: { breaking: true, requiresHumanReview: true, riskTags: [] },
    expectedDecision: PolicyDecision.REQUIRE_APPROVAL,
  },
  {
    id: "openai-4.0.0",
    vendor: "openai",
    fixture: "openai-node-legacy",
    packageName: "openai",
    releaseVersion: "4.0.0",
    previousVersion: "3.3.0",
    payload: { fromVersion: "3.x", toVersion: "4.x" },
    expectedMatched: false,
    expectedFiles: [],
    facts: { breaking: false, requiresHumanReview: false, riskTags: [] },
    expectedDecision: PolicyDecision.ALLOW_PLAN_ONLY,
  },
  {
    id: "stripe-16.12.0",
    vendor: "stripe",
    fixture: "stripe-node-legacy",
    packageName: "stripe",
    releaseVersion: "16.12.0",
    previousVersion: "16.11.0",
    payload: { sdk: "stripe" },
    expectedMatched: true,
    expectedFiles: ["src/payments/customers.ts"],
    facts: { breaking: true, requiresHumanReview: true, riskTags: ["PAYMENT"] },
    expectedDecision: PolicyDecision.REQUIRE_APPROVAL,
  },
  {
    id: "stripe-13.0.0",
    vendor: "stripe",
    fixture: "stripe-node-legacy",
    packageName: "stripe",
    releaseVersion: "13.0.0",
    previousVersion: "12.18.0",
    payload: { fromVersion: "12.x", toVersion: "13.x" },
    expectedMatched: false,
    expectedFiles: [],
    facts: { breaking: false, requiresHumanReview: false, riskTags: [] },
    expectedDecision: PolicyDecision.ALLOW_PLAN_ONLY,
  },
  {
    id: "twilio-3.84.0",
    vendor: "twilio",
    fixture: "twilio-node-legacy",
    packageName: "twilio",
    releaseVersion: "3.84.0",
    previousVersion: "3.83.0",
    payload: { sdk: "twilio" },
    expectedMatched: true,
    expectedFiles: ["src/notifications/sms.ts"],
    facts: { breaking: true, requiresHumanReview: true, riskTags: [] },
    expectedDecision: PolicyDecision.REQUIRE_APPROVAL,
  },
  {
    id: "twilio-4.0.0",
    vendor: "twilio",
    fixture: "twilio-node-legacy",
    packageName: "twilio",
    releaseVersion: "4.0.0",
    previousVersion: "3.84.0",
    payload: { fromVersion: "3.x", toVersion: "4.x" },
    expectedMatched: false,
    expectedFiles: [],
    facts: { breaking: false, requiresHumanReview: false, riskTags: [] },
    expectedDecision: PolicyDecision.ALLOW_PLAN_ONLY,
  },
  {
    id: "auth0-3.3.0",
    vendor: "auth0",
    fixture: "auth0-node-legacy",
    packageName: "auth0",
    releaseVersion: "3.3.0",
    previousVersion: "3.2.0",
    payload: { sdk: "auth0" },
    expectedMatched: true,
    expectedFiles: [],
    facts: { breaking: true, requiresHumanReview: true, riskTags: ["AUTH"] },
    expectedDecision: PolicyDecision.ALLOW_PLAN_ONLY,
  },
  {
    id: "auth0-3.1.0",
    vendor: "auth0",
    fixture: "auth0-node-legacy",
    packageName: "auth0",
    releaseVersion: "3.1.0",
    previousVersion: "3.0.0",
    payload: { fromVersion: "3.0.x", toVersion: "3.1.x" },
    expectedMatched: false,
    expectedFiles: [],
    facts: { breaking: false, requiresHumanReview: false, riskTags: [] },
    expectedDecision: PolicyDecision.ALLOW_PLAN_ONLY,
  },
];

function fixturedDependency(
  analysis: RepositoryAnalysis,
  packageName: string,
): { declaredRange: string | null; resolvedVersion: string } {
  const primaryManifest = [...analysis.manifests].sort((a, b) => a.path.localeCompare(b.path))[0];
  const declaredRange =
    primaryManifest?.dependencies[packageName] ??
    primaryManifest?.devDependencies[packageName] ??
    null;
  return { declaredRange, resolvedVersion: analysis.lockfileVersions[packageName] ?? "" };
}

/** Replays one corpus entry end to end. */
export async function runEvalCase(entry: EvalCorpusEntry): Promise<EvalCaseResult> {
  const analysis = await analyzeRepository({
    rootDir: resolveFixtureDir(entry.fixture),
    trackPackages: TRACKED,
  });

  const matched = evaluateReleaseMatch(
    entry.releaseVersion,
    fixturedDependency(analysis, entry.packageName),
    entry.packageName,
  ).matched;

  const connector = getConnector(entry.vendor);
  if (!connector) throw new Error(`no connector registered for corpus vendor ${entry.vendor}`);
  const normalizations = connector.normalizeChange({
    rawPayload: entry.payload,
    sourceType: "SDK_RELEASE",
  });
  const suggestions = connector.buildPatchSuggestions(normalizations);

  const plan: PlanDraft = generatePlan({
    fixtureDir: resolveFixtureDir(entry.fixture),
    repositoryName: entry.fixture,
    usages: analysis.usages,
    patchSuggestions: suggestions,
    normalizations,
    assessmentConfidence: 90,
  });

  const validationPassed = plan.patches.every((patch) =>
    reparseCheck(patch.filePath, patch.patched),
  );

  const decision = evaluatePolicy({
    confidence: plan.confidence,
    patchCount: plan.patches.length,
    requiresHumanReview: entry.facts.requiresHumanReview,
    hasPassingValidation: validationPassed,
    approvalDecision: null,
    riskTags: entry.facts.riskTags,
  });

  return {
    id: entry.id,
    matched,
    patchFiles: plan.patches.map((patch) => patch.filePath).sort(),
    skippedFiles: plan.skippedFiles,
    planConfidence: plan.patches.length > 0 ? plan.confidence : null,
    validationPassed,
    decision: decision.decision,
  };
}

interface EvalResult {
  cases: EvalCaseResult[];
  metrics: EvalMetrics;
  report: string;
}

/** Replays the whole corpus and returns per-case results + launch metrics. */
export async function runEvalCorpus(entries: EvalCorpusEntry[] = EVAL_CORPUS): Promise<EvalResult> {
  const cases: EvalCaseResult[] = [];
  const mismatches: EvalMismatch[] = [];
  let falsePositiveAlerts = 0;
  let patchFilesTotal = 0;
  let patchedFilesValid = 0;
  let expectedPatchFiles = 0;
  let foundPatchFiles = 0;

  const canValidate = (entry: EvalCorpusEntry): boolean =>
    entry.expectedMatched && entry.expectedFiles.length > 0;

  const entryById = new Map(entries.map((entry) => [entry.id, entry]));

  for (const entry of entries) {
    const result = await runEvalCase(entry);

    const note = (
      aspect: EvalMismatch["aspect"],
      expected: string,
      actual: string,
      detail?: string,
    ) => mismatches.push({ entryId: entry.id, aspect, expected, actual, detail });

    if (result.matched !== entry.expectedMatched) {
      note("match", String(entry.expectedMatched), String(result.matched));
    }

    const expectedSet = new Set(entry.expectedFiles);
    const actualSet = new Set(result.patchFiles);
    if (entry.expectedMatched) {
      for (const file of expectedSet) {
        expectedPatchFiles += 1;
        if (actualSet.has(file)) foundPatchFiles += 1;
      }
    }
    const patchSetEqual =
      result.patchFiles.length === entry.expectedFiles.length &&
      result.patchFiles.every((f) => expectedSet.has(f));
    if (!patchSetEqual) {
      note(
        "patches",
        entry.expectedFiles.join(",") || "(none)",
        result.patchFiles.join(",") || "(none)",
        `skipped=${result.skippedFiles.join(",") || "(none)"}`,
      );
    }

    if (result.skippedFiles.length > 0 && result.patchFiles.length === 0) {
      note("skipped", "(none)", result.skippedFiles.join(","));
    }

    if (canValidate(entry)) {
      patchFilesTotal += result.patchFiles.length;
      if (result.validationPassed) patchedFilesValid += result.patchFiles.length;
      if (!result.validationPassed) {
        note("validation", "patched files re-parse", "some patched file does not parse");
      }
    }

    if (result.decision !== entry.expectedDecision) {
      note("policy", entry.expectedDecision, result.decision);
    }

    if (!entry.expectedMatched && result.patchFiles.length > 0) {
      falsePositiveAlerts += 1;
      note("match", "no alert for unmatched release", "patches produced for unmatched release");
    }
    cases.push(result);
  }

  const labeledMatched = entries.filter((entry) => entry.expectedMatched).length;
  const correctMatches = cases.filter((c) => c.matched).length;
  const policyCorrect = cases.filter(
    (c) => c.decision === entryById.get(c.id)?.expectedDecision,
  ).length;

  const matchRecall = labeledMatched === 0 ? 1 : correctMatches / labeledMatched;
  const precision = entries.length === 0 ? 1 : 1 - falsePositiveAlerts / entries.length;
  const patchRecall = expectedPatchFiles === 0 ? 1 : foundPatchFiles / expectedPatchFiles;
  const validationRate = patchFilesTotal === 0 ? 1 : patchedFilesValid / patchFilesTotal;

  return {
    cases,
    metrics: {
      entries: entries.length,
      matchRecall,
      precision,
      patchRecall,
      validationRate,
      policyCorrect: policyCorrect / entries.length,
      falsePositiveAlerts,
      mismatches,
    },
    report: formatEvalCorpusReport({
      entries: entries.length,
      matchRecall,
      precision,
      patchRecall,
      validationRate,
      policyCorrect: policyCorrect / entries.length,
      falsePositiveAlerts,
      mismatches,
    }),
  };
}

/** Human-readable metrics table for reports and test diagnostics. */
export function formatEvalCorpusReport(metrics: EvalMetrics): string {
  const pct = (value: number): string => `${(value * 100).toFixed(1)}%`;
  const rows = [
    `entries                         ${metrics.entries}`,
    `dependency match recall         ${pct(metrics.matchRecall)} (target >= 95%)`,
    `affected-usage match precision  ${pct(metrics.precision)} (target >= 90%)`,
    `patch recall                    ${pct(metrics.patchRecall)}`,
    `automatic patch validation      ${pct(metrics.validationRate)} (target >= 80%)`,
    `false-positive alert rate       ${pct(1 - metrics.precision)} (target < 10%)`,
    `policy outcome correctness      ${pct(metrics.policyCorrect)} (target 100%)`,
    `mismatches                      ${metrics.mismatches.length}`,
  ];
  return `H8 full-loop evaluation corpus\n${rows.join("\n")}`;
}
