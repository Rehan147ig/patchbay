/**
 * Historical release-to-repository matching corpus (roadmap Phase H5).
 *
 * Replays deterministic dependency matching against a hand-labeled corpus of
 * real historical releases (openai 3.x/4.x, stripe 12/13, twilio 3/4) and
 * realistic customer manifest snapshots, then reports precision/recall against
 * the launch targets (recall >= 95%, precision >= 90%).
 *
 * Ground truth is explicit per (release, repository) pair, so changing the
 * matcher or the semver engine requires consciously re-labeling the corpus
 * instead of silently drifting. Pure and DB-free: runs in CI, no network.
 */
import { evaluateReleaseMatch, type DependencyFacts } from "./matching";

export interface CorpusRelease {
  /** Corpus entry id (e.g. "openai-4.0.0"). */
  id: string;
  vendor: string;
  packageName: string;
  version: string;
  previousVersion?: string;
  /** Repository ids expected to match this release. */
  expectedMatches: string[];
}

export interface CorpusRepository {
  id: string;
  vendor: string;
  packageName: string;
  dependency: DependencyFacts;
}

export interface CorpusMismatch {
  releaseId: string;
  repositoryId: string;
  expected: boolean;
  actual: boolean;
  reason?: string;
}

export interface VendorMetrics {
  pairs: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  recall: number;
  precision: number;
}

export interface CorpusMetrics {
  pairs: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  recall: number;
  precision: number;
  byVendor: Record<string, VendorMetrics>;
  mismatches: CorpusMismatch[];
}

export const CORPUS_REPOSITORIES: CorpusRepository[] = [
  {
    id: "customer-core-api",
    vendor: "openai",
    packageName: "openai",
    dependency: { declaredRange: "^3.3.0", resolvedVersion: "3.3.0" },
  },
  {
    id: "customer-chatbot",
    vendor: "openai",
    packageName: "openai",
    dependency: { declaredRange: "^4.0.0", resolvedVersion: "4.8.1" },
  },
  {
    id: "customer-misc",
    vendor: "openai",
    packageName: "openai",
    dependency: { declaredRange: ">=3.0.0 <4.0.0", resolvedVersion: "3.6.0" },
  },
  {
    id: "customer-pinned-api",
    vendor: "openai",
    packageName: "openai",
    dependency: { declaredRange: "4.8.1", resolvedVersion: "4.8.1" },
  },
  {
    id: "customer-billing",
    vendor: "stripe",
    packageName: "stripe",
    dependency: { declaredRange: "^12.18.0", resolvedVersion: "12.18.0" },
  },
  {
    id: "customer-checkout",
    vendor: "stripe",
    packageName: "stripe",
    dependency: { declaredRange: "^13.18.0", resolvedVersion: "13.18.0" },
  },
  {
    id: "customer-legacy-payments",
    vendor: "stripe",
    packageName: "stripe",
    dependency: { declaredRange: "~13.0.0", resolvedVersion: "13.0.5" },
  },
  {
    id: "customer-alerts",
    vendor: "twilio",
    packageName: "twilio",
    dependency: { declaredRange: "^3.35.0", resolvedVersion: "3.85.0" },
  },
  {
    id: "customer-sms-gateway",
    vendor: "twilio",
    packageName: "twilio",
    dependency: { declaredRange: "^4.10.0", resolvedVersion: "4.10.0" },
  },
  {
    id: "customer-sms-v4",
    vendor: "twilio",
    packageName: "twilio",
    dependency: { declaredRange: "^4.0.0", resolvedVersion: "4.0.5" },
  },
];

export const CORPUS_RELEASES: CorpusRelease[] = [
  {
    id: "openai-3.3.0",
    vendor: "openai",
    packageName: "openai",
    version: "3.3.0",
    previousVersion: "3.2.1",
    expectedMatches: ["customer-core-api", "customer-misc"],
  },
  {
    id: "openai-4.0.0",
    vendor: "openai",
    packageName: "openai",
    version: "4.0.0",
    previousVersion: "3.3.0",
    expectedMatches: ["customer-chatbot"],
  },
  {
    id: "openai-4.0.0-beta.5",
    vendor: "openai",
    packageName: "openai",
    version: "4.0.0-beta.5",
    previousVersion: "3.3.0",
    expectedMatches: [],
  },
  {
    id: "openai-4.8.1",
    vendor: "openai",
    packageName: "openai",
    version: "4.8.1",
    previousVersion: "4.8.0",
    expectedMatches: ["customer-chatbot", "customer-pinned-api"],
  },
  {
    id: "stripe-12.18.0",
    vendor: "stripe",
    packageName: "stripe",
    version: "12.18.0",
    previousVersion: "12.17.0",
    expectedMatches: ["customer-billing"],
  },
  {
    id: "stripe-13.0.0",
    vendor: "stripe",
    packageName: "stripe",
    version: "13.0.0",
    previousVersion: "12.18.0",
    expectedMatches: ["customer-legacy-payments"],
  },
  {
    id: "stripe-13.18.0",
    vendor: "stripe",
    packageName: "stripe",
    version: "13.18.0",
    previousVersion: "13.17.0",
    expectedMatches: ["customer-checkout"],
  },
  {
    id: "twilio-3.85.0",
    vendor: "twilio",
    packageName: "twilio",
    version: "3.85.0",
    previousVersion: "3.84.1",
    expectedMatches: ["customer-alerts"],
  },
  {
    id: "twilio-4.0.0",
    vendor: "twilio",
    packageName: "twilio",
    version: "4.0.0",
    previousVersion: "3.85.0",
    expectedMatches: ["customer-sms-v4"],
  },
  {
    id: "twilio-4.10.0",
    vendor: "twilio",
    packageName: "twilio",
    version: "4.10.0",
    previousVersion: "4.9.0",
    expectedMatches: ["customer-sms-gateway", "customer-sms-v4"],
  },
];

/** Replays the whole corpus and returns aggregate + per-vendor metrics. */
export function runMatchCorpus(
  repos = CORPUS_REPOSITORIES,
  releases = CORPUS_RELEASES,
): CorpusMetrics {
  const byVendor: Record<string, VendorMetrics> = {};
  const mismatches: CorpusMismatch[] = [];
  let truePositives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;
  let pairs = 0;

  const touch = (vendor: string): VendorMetrics => {
    byVendor[vendor] ??= {
      pairs: 0,
      truePositives: 0,
      falsePositives: 0,
      falseNegatives: 0,
      recall: 0,
      precision: 0,
    };
    return byVendor[vendor]!;
  };

  for (const release of releases) {
    for (const repo of repos) {
      if (repo.packageName !== release.packageName) continue;
      pairs += 1;
      const vendor = touch(release.vendor);
      vendor.pairs += 1;

      const expected = release.expectedMatches.includes(repo.id);
      const outcome = evaluateReleaseMatch(release.version, repo.dependency, repo.packageName);
      const actual = outcome.matched;

      if (expected && actual) {
        truePositives += 1;
        vendor.truePositives += 1;
      } else if (!expected && actual) {
        falsePositives += 1;
        vendor.falsePositives += 1;
        mismatches.push({
          releaseId: release.id,
          repositoryId: repo.id,
          expected: false,
          actual: true,
          reason: outcome.reason,
        });
      } else if (expected && !actual) {
        falseNegatives += 1;
        vendor.falseNegatives += 1;
        mismatches.push({
          releaseId: release.id,
          repositoryId: repo.id,
          expected: true,
          actual: false,
        });
      }
    }
  }

  for (const vendor of Object.values(byVendor)) {
    vendor.recall = vendor.truePositives / (vendor.truePositives + vendor.falseNegatives || 1);
    vendor.precision = vendor.truePositives / (vendor.truePositives + vendor.falsePositives || 1);
  }

  const recall = truePositives / (truePositives + falseNegatives || 1);
  const precision = truePositives / (truePositives + falsePositives || 1);

  return {
    pairs,
    truePositives,
    falsePositives,
    falseNegatives,
    recall,
    precision,
    byVendor,
    mismatches,
  };
}

/** Human-readable metrics table for reports and test diagnostics. */
export function formatCorpusReport(metrics: CorpusMetrics): string {
  const line = (label: string, value: string): string => `  ${label.padEnd(16)} ${value}`;
  const rows = [
    line("pairs", String(metrics.pairs)),
    line("true positives", String(metrics.truePositives)),
    line("false positives", String(metrics.falsePositives)),
    line("false negatives", String(metrics.falseNegatives)),
    line("recall", `${(metrics.recall * 100).toFixed(1)}%`),
    line("precision", `${(metrics.precision * 100).toFixed(1)}%`),
  ];
  for (const [vendor, v] of Object.entries(metrics.byVendor)) {
    rows.push(
      line(
        `${vendor}`,
        `recall ${(v.recall * 100).toFixed(1)}% / precision ${(v.precision * 100).toFixed(1)}% (${v.pairs} pairs)`,
      ),
    );
  }
  return `Corpus metrics\n${rows.join("\n")}`;
}
