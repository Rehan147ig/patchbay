import { describe, expect, it } from "vitest";
import {
  CORPUS_RELEASES,
  CORPUS_REPOSITORIES,
  formatCorpusReport,
  runMatchCorpus,
} from "./match-corpus";

/**
 * Phase H5 replay gate (roadmap launch targets: dependency match recall >= 95%,
 * affected-usage match precision >= 90%). Runs in CI whenever the matcher or
 * semver engine changes. Ground truth is explicit in match-corpus.ts.
 */
const RECALL_TARGET = 0.95;
const PRECISION_TARGET = 0.9;

describe("H5 historical match corpus (precision/recall gate)", () => {
  const metrics = runMatchCorpus();

  it("replays without a single mismatch", () => {
    expect(metrics.mismatches).toEqual([]);
  });

  it("meets the recall target (>= 95%)", () => {
    expect(metrics.recall).toBeGreaterThanOrEqual(RECALL_TARGET);
  });

  it("meets the precision target (>= 90%)", () => {
    expect(metrics.precision).toBeGreaterThanOrEqual(PRECISION_TARGET);
  });

  it("meets targets per vendor", () => {
    for (const [vendor, v] of Object.entries(metrics.byVendor)) {
      expect(v.recall, `${vendor} recall`).toBeGreaterThanOrEqual(RECALL_TARGET);
      expect(v.precision, `${vendor} precision`).toBeGreaterThanOrEqual(PRECISION_TARGET);
    }
  });

  it("labels at least one positive per release category (corpus is not vacuous)", () => {
    const positive = CORPUS_RELEASES.filter((release) => release.expectedMatches.length > 0);
    expect(positive.length).toBeGreaterThanOrEqual(8);
    expect(metrics.truePositives).toBeGreaterThanOrEqual(10);
    expect(metrics.pairs).toBeGreaterThanOrEqual(30);
  });

  it("reports the metrics table in failure output", () => {
    expect(formatCorpusReport(metrics)).toContain("recall");
    expect(formatCorpusReport(metrics)).toContain("precision 100.0%");
  });
});

describe("H5 corpus regression cases", () => {
  const reposById = (ids: string[]) => CORPUS_REPOSITORIES.filter((repo) => ids.includes(repo.id));

  it("a future major does not match a caret-locked older major (no positive bias)", () => {
    const release = CORPUS_RELEASES.find((r) => r.id === "openai-4.0.0")!;
    const repos = reposById(["customer-core-api", "customer-billing", "customer-alerts"]);
    const replay = runMatchCorpus(repos, [release]);
    expect(replay.truePositives).toBe(0);
    expect(replay.falsePositives).toBe(0);
    expect(replay.mismatches).toEqual([]);
  });

  it("an older release never matches a repo resolved to a newer version", () => {
    const release = CORPUS_RELEASES.find((r) => r.id === "stripe-13.0.0")!;
    const repos = reposById(["customer-checkout", "customer-billing"]);
    const replay = runMatchCorpus(repos, [release]);
    expect(replay.truePositives).toBe(0);
    expect(replay.falsePositives).toBe(0);
  });

  it("prerelease releases alert on no stable repository", () => {
    const release = CORPUS_RELEASES.find((r) => r.id === "openai-4.0.0-beta.5")!;
    const replay = runMatchCorpus(CORPUS_REPOSITORIES, [release]);
    expect(replay.falsePositives).toBe(0);
    expect(replay.truePositives).toBe(0);
  });
});
