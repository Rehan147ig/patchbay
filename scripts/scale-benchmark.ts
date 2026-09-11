/**
 * Fleet-scale extraction benchmark (manual, NOT a CI gate — wall-clock).
 *
 * Generates synthetic repos at several sizes, then measures:
 *   1. full extractGraph time (cold index: the mass-onboarding cost), and
 *   2. incremental re-index after a single leaf change
 *      (computeReextractionSet + partial extract + merge: the steady-state
 *      cost per commit), verified byte-equal to a clean full re-extraction.
 *
 * Run: pnpm exec tsx scripts/scale-benchmark.ts
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { extractGraph } from "../packages/repo-analysis/src/graph";
import { computeReextractionSet, inverseIndex } from "../packages/repo-analysis/src/invalidation";
import {
  edgeComparisonKey,
  mergeIncrementalExtraction,
  nodeComparisonKey,
} from "../packages/repo-analysis/src/merge";

const SIZES = [10, 100, 400];
const TRACKED = ["openai", "stripe"];

function leafContent(index: number): string {
  const prev = index === 0 ? `"./shared"` : `"./mod-${index - 1}"`;
  const prevName = index === 0 ? "shared" : `f${index - 1}`;
  return (
    `import { shared } from "./shared";\n` +
    `import { ${prevName} } from ${prev};\n` +
    `export const f${index} = { v: shared.v, prev: ${prevName} };\n`
  );
}

function buildSyntheticRepo(fileCount: number): string {
  const root = mkdtempSync(path.join(tmpdir(), "patchbay-scale-"));
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "scale-fixture" }));
  mkdirSync(path.join(root, "src"), { recursive: true });
  writeFileSync(path.join(root, "src", "shared.ts"), "export const shared = { v: 1 };\n");
  for (let i = 0; i < fileCount; i += 1) {
    writeFileSync(path.join(root, "src", `mod-${i}.ts`), leafContent(i));
  }
  // Webhook surface so P0/P1 extractors run at scale too.
  mkdirSync(path.join(root, "src", "webhooks"), { recursive: true });
  writeFileSync(
    path.join(root, "src", "webhooks", "stripe.ts"),
    'import { z } from "zod";\n' +
      'import app from "express";\n' +
      "export const stripeEventSchema = z.object({ id: z.string(), data: z.object({ object: z.string() }) });\n" +
      'app.post("/webhooks/stripe", async () => {});\n',
  );
  return root;
}

interface Row {
  files: number;
  fullMs: number;
  nodes: number;
  edges: number;
  incrementalMs: number;
  reextracted: number;
  heapDeltaMb: number;
  verified: boolean;
}

async function benchmarkSize(fileCount: number): Promise<Row> {
  const root = buildSyntheticRepo(fileCount);
  try {
    const heapBefore = process.memoryUsage().heapUsed;
    const fullStart = Date.now();
    const baseline = await extractGraph({ rootDir: root, trackPackages: TRACKED });
    const fullMs = Date.now() - fullStart;

    const { reverseImports, reverseCalls } = inverseIndex(baseline);
    const allFiles = [
      ...new Set(
        baseline.nodeFacts.map((node) => node.filePath).filter((f): f is string => f !== null),
      ),
    ];
    const leaf = `src/mod-${fileCount - 1}.ts`;
    const changed = computeReextractionSet({
      changedFiles: [leaf],
      reverseImports,
      reverseCalls,
      allFiles,
    });

    const target = path.join(root, leaf);
    const before = (await import("node:fs")).readFileSync(target, "utf8");
    (await import("node:fs")).writeFileSync(target, `${before}\n// scale-mutation\n`);

    const incStart = Date.now();
    const incremental = await extractGraph({
      rootDir: root,
      trackPackages: TRACKED,
      changedFiles: new Map(changed.reextract.map((file) => [file, ""])),
    });
    const merged = mergeIncrementalExtraction(baseline, incremental, new Set(changed.reextract));
    const incrementalMs = Date.now() - incStart;

    const oracle = await extractGraph({ rootDir: root, trackPackages: TRACKED });
    const verified =
      JSON.stringify(merged.nodeFacts.map(nodeComparisonKey).sort()) ===
        JSON.stringify(oracle.nodeFacts.map(nodeComparisonKey).sort()) &&
      JSON.stringify(merged.edgeFacts.map(edgeComparisonKey).sort()) ===
        JSON.stringify(oracle.edgeFacts.map(edgeComparisonKey).sort());
    const heapDeltaMb = Math.round((process.memoryUsage().heapUsed - heapBefore) / 1024 / 1024);

    return {
      files: allFiles.length,
      fullMs,
      nodes: baseline.nodeFacts.length,
      edges: baseline.edgeFacts.length,
      incrementalMs,
      reextracted: changed.reextract.length,
      heapDeltaMb,
      verified,
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  console.log("files | fullMs | nodes | edges | incrMs | reextracted | heapMb | verified");
  let failed = false;
  for (const size of SIZES) {
    const row = await benchmarkSize(size);
    if (!row.verified) failed = true;
    console.log(
      `${row.files} | ${row.fullMs} | ${row.nodes} | ${row.edges} | ${row.incrementalMs} | ${row.reextracted} | ${row.heapDeltaMb} | ${row.verified}`,
    );
  }
  if (failed) {
    console.error("MISMATCH: incremental merge differed from clean full extraction");
    process.exitCode = 1;
  }
}

void main();
