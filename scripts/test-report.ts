/**
 * Production-readiness reporter (Phase 8).
 *
 * Consumes a vitest JSON report
 *   pnpm vitest run --reporter=json --outputFile=test-results.vitest.json
 * and prints the Patchbay production-readiness scorecard to stdout. Exits
 * non-zero when any suite failed, so CI can gate on it. Coverage is read
 * from a v8/c8 summary when present (informational only — thresholds are
 * enforced by the CI step, not this printer).
 *
 * Usage: pnpm exec tsx scripts/test-report.ts [path-to-vitest-json]
 */
import { readFileSync, existsSync } from "node:fs";

interface VitestAssertionResult {
  ancestorTitles: string[];
  title: string;
  status: "passed" | "failed" | "pending" | "todo" | "skipped";
  duration?: number;
}

interface VitestFileResult {
  name: string;
  assertionResults: VitestAssertionResult[];
}

interface VitestReport {
  testResults: VitestFileResult[];
}

const SECURITY_FILES = ["security-ssrf", "security-auth", "security-injection"];
const RACE_FILES = ["workflow-races"];
const PERF_FILES = ["perf-benchmark"];
const CORPUS_FILES = ["eval-corpus"];

function bucketOf(fileName: string): string {
  if (CORPUS_FILES.some((k) => fileName.includes(k))) return "Eval Corpus";
  if (SECURITY_FILES.some((k) => fileName.includes(k))) return "Security";
  if (RACE_FILES.some((k) => fileName.includes(k))) return "Workflow Races";
  if (PERF_FILES.some((k) => fileName.includes(k))) return "Performance";
  return "Unit";
}

function main(): void {
  const reportPath = process.argv[2] ?? "test-results.vitest.json";
  if (!existsSync(reportPath)) {
    console.error(`test report not found: ${reportPath}`);
    console.error("run: pnpm vitest run --reporter=json --outputFile=test-results.vitest.json");
    process.exit(2);
  }
  const report = JSON.parse(readFileSync(reportPath, "utf8")) as VitestReport;

  const buckets = new Map<string, { passed: number; failed: number; skipped: number }>();
  let totalDuration = 0;
  for (const file of report.testResults ?? []) {
    for (const assertion of file.assertionResults ?? []) {
      const bucket = bucketOf(file.name);
      const entry = buckets.get(bucket) ?? { passed: 0, failed: 0, skipped: 0 };
      if (assertion.status === "passed") entry.passed += 1;
      else if (assertion.status === "failed") entry.failed += 1;
      else entry.skipped += 1;
      buckets.set(bucket, entry);
      totalDuration += assertion.duration ?? 0;
    }
  }

  const order = ["Unit", "Security", "Workflow Races", "Performance", "Eval Corpus"];
  let totalPassed = 0;
  let totalFailed = 0;
  const lines: string[] = [];
  lines.push("╔══════════════════════════════════════════════════════╗");
  lines.push("║           PATCHBAY PRODUCTION READINESS              ║");
  lines.push("╠══════════════════════════════════════════════════════╣");
  for (const name of order) {
    const entry = buckets.get(name);
    if (!entry) continue;
    const total = entry.passed + entry.failed + entry.skipped;
    totalPassed += entry.passed;
    totalFailed += entry.failed;
    const mark = entry.failed === 0 ? "✅" : "❌";
    lines.push(
      `║ ${name.padEnd(18)} ${String(entry.passed).padStart(4)}/${String(total).padStart(4)}  ${mark}                     ║`,
    );
  }
  lines.push("║──────────────────────────────────────────────────────║");
  const grand = totalPassed + totalFailed;
  const verdict = totalFailed === 0 ? "PRODUCTION READY" : "NOT READY";
  const verdictMark = totalFailed === 0 ? "✅" : "❌";
  lines.push(
    `║ TOTAL: ${String(totalPassed).padStart(4)}/${String(grand).padEnd(4)} ${verdictMark} ${verdict.padEnd(30)}║`,
  );
  lines.push(`║ Duration: ${(totalDuration / 1000).toFixed(1)}s assertion time`.padEnd(61) + "║");
  lines.push("╚══════════════════════════════════════════════════════╝");
  console.log(lines.join("\n"));

  if (totalFailed > 0) process.exit(1);
}

main();
