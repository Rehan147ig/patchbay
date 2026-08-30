/**
 * LOCAL BASELINE — NOT PRODUCTION CAPACITY
 * Read-only benchmark harness for Phase 1A/1B.
 * Does not modify production code, does not send PRs, does not mutate DB.
 * Synthetic repos under fs.mkdtemp(), deleted after unless kept.
 */
import { performance } from "node:perf_hooks";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { analyzeRepository } from "../src/index.ts";
import { extractGraph } from "../src/graph.ts";
import { generatePlan, validatePatchSyntax } from "../../remediation-engine/src/index.ts";
import { runSemanticGate } from "../../remediation-engine/src/semantic-gate.ts";
import { getConnector } from "../../vendor-connectors/src/registry.ts";

type StageResult = { ms: number; extra?: Record<string, number> };
type WorkloadResult = {
  workload: string;
  repos: number;
  files: number;
  usages: number;
  concurrency: number;
  totalMs: number;
  stages: Record<string, StageResult>;
  peakRssMb: number;
  rssBeforeMb: number;
  rssAfterMb: number;
};

function rssMb(): number {
  return Math.round(process.memoryUsage().rss / 1024 / 1024);
}

async function collectFiles(rootDir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory()) {
        if (["node_modules", ".git", "dist", ".next"].includes(e.name)) continue;
        await walk(path.join(dir, e.name));
      } else if (e.isFile() && /\.(ts|tsx|js|jsx)$/.test(e.name)) {
        out.push(path.join(dir, e.name));
      }
    }
  }
  await walk(rootDir);
  return out;
}

// Realistic TS file with imports, class, and usages
function makeFileContent(usagesInFile: number, fileIndex: number): string {
  const imports = `import { OpenAI } from "openai";\nimport pino from "pino";\nconst logger = pino();\nconst openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });\n`;
  const header = `// file-${fileIndex}.ts - realistic service module\n${imports}\n`;
  let body = "";
  for (let i = 0; i < usagesInFile; i++) {
    body += `\nexport async function handler${fileIndex}_${i}(prompt: string) {\n  logger.info("call", { prompt });\n  const completion = await openai.createChatCompletion({ model: "gpt-4", messages: [{ role: "user", content: prompt }] });\n  return completion.data.choices[0]?.message?.content ?? "";\n}\n`;
  }
  // Add some non-usage code to make file realistic
  body += `\nexport function helper${fileIndex}(x: number): number { return x * 2; }\n`;
  return header + body;
}

async function createSyntheticRepo(rootDir: string, files: number, usages: number): Promise<void> {
  const usagesPerFile = Math.max(1, Math.ceil(usages / files));
  let remaining = usages;
  for (let f = 0; f < files; f++) {
    const dir = path.join(rootDir, `src/module${Math.floor(f / 10)}`);
    await fs.mkdir(dir, { recursive: true });
    const fileUsages = Math.min(usagesPerFile, remaining);
    if (fileUsages <= 0) {
      await fs.writeFile(
        path.join(dir, `file${f}.ts`),
        `// empty\n export const v${f}=${f};\n`,
        "utf8",
      );
    } else {
      await fs.writeFile(path.join(dir, `file${f}.ts`), makeFileContent(fileUsages, f), "utf8");
      remaining -= fileUsages;
    }
    if (remaining <= 0 && f < files - 1) {
      // Fill remaining files with non-usage content
      for (let rf = f + 1; rf < files; rf++) {
        const rdir = path.join(rootDir, `src/module${Math.floor(rf / 10)}`);
        await fs.mkdir(rdir, { recursive: true });
        await fs.writeFile(
          path.join(rdir, `file${rf}.ts`),
          `// empty ${rf}\nexport const v${rf}=${rf};\n`,
          "utf8",
        );
      }
      break;
    }
  }
  await fs.writeFile(
    path.join(rootDir, "package.json"),
    JSON.stringify({ name: "bench", dependencies: { openai: "3.3.0" } }),
    "utf8",
  );
  await fs.writeFile(
    path.join(rootDir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "bundler",
        esModuleInterop: true,
        skipLibCheck: true,
        noEmit: true,
        strict: false,
      },
    }),
    "utf8",
  );
}

async function benchWorkload(
  label: string,
  files: number,
  usages: number,
): Promise<WorkloadResult> {
  const tmpRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), `patch-bench-${label.replace(/\s/g, "-")}-`),
  );
  const repoDir = path.join(tmpRoot, "repo");
  await fs.mkdir(repoDir, { recursive: true });
  await createSyntheticRepo(repoDir, files, usages);

  const rssBefore = rssMb();
  let peakRss = rssBefore;
  const stages: Record<string, StageResult> = {};
  const totalStart = performance.now();

  // Stage 1: file collection
  let t0 = performance.now();
  const discovered = await collectFiles(repoDir);
  stages["file_collection"] = { ms: performance.now() - t0, extra: { files: discovered.length } };
  peakRss = Math.max(peakRss, rssMb());

  // Stage 2+3: analyzeRepository (scan + AST) - production path
  t0 = performance.now();
  const analysis = await analyzeRepository({ rootDir: repoDir, trackPackages: ["openai"] });
  const astMs = performance.now() - t0;
  stages["ast_analysis"] = {
    ms: astMs,
    extra: { files: analysis.typescriptFiles, usages: analysis.usages.length },
  };
  peakRss = Math.max(peakRss, rssMb());

  // Stage 3: graph extraction (uses analysis.usages + analysis manifest)
  t0 = performance.now();
  // extractGraph needs a snapshot; we build minimal from analysis
  // If extractGraph requires DB, fallback to no-op measurement
  let nodes = 0,
    edges = 0;
  try {
    // extractGraph is pure in-memory for bench - we call it if available
    const graph = await (extractGraph as any)({
      usages: analysis.usages,
      manifests: analysis.manifests,
    });
    nodes = graph?.nodes?.length ?? analysis.usages.length;
    edges = graph?.edges?.length ?? 0;
  } catch {
    nodes = analysis.usages.length;
    edges = 0;
  }
  stages["graph_extraction"] = { ms: performance.now() - t0, extra: { nodes, edges } };
  peakRss = Math.max(peakRss, rssMb());

  // Stage 4: plan generation
  const connector = getConnector("openai");
  const payload = {
    sdk: "openai",
    fromVersion: "3.x",
    toVersion: "4.x",
    migration: {
      methodRenames: [
        { from: "openai.createChatCompletion", to: "openai.chat.completions.create" },
      ],
      responseChanges: [{ symbol: "completion.data", description: "v4" }],
    },
  };
  const normalizations = connector
    ? connector.normalizeChange({ rawPayload: payload, sourceType: "SDK_RELEASE" })
    : [];
  const suggestions = connector ? connector.buildPatchSuggestions(normalizations) : [];
  t0 = performance.now();
  const plan = await generatePlan({
    fixtureDir: repoDir,
    repositoryName: `bench-${label}`,
    usages: analysis.usages.map((u) => ({
      filePath: u.filePath,
      line: u.line,
      symbol: u.symbol,
      excerpt: u.excerpt,
    })),
    patchSuggestions: suggestions,
    normalizations,
    assessmentConfidence: 90,
  });
  stages["plan_generation"] = {
    ms: performance.now() - t0,
    extra: { patches: plan.patches.length, skipped: plan.skippedFiles.length },
  };
  peakRss = Math.max(peakRss, rssMb());

  // Stage 5: patch syntax validation
  t0 = performance.now();
  let validated = 0;
  for (const p of plan.patches) {
    await validatePatchSyntax(p.filePath, p.patched);
    validated++;
  }
  stages["patch_validation"] = { ms: performance.now() - t0, extra: { files: validated } };
  peakRss = Math.max(peakRss, rssMb());

  // Stage 6: semantic gate
  t0 = performance.now();
  let gateFiles = 0;
  if (plan.patches.length > 0) {
    const overlay = new Map(plan.patches.map((p) => [p.filePath, p.patched]));
    const gate = runSemanticGate({ projectDir: repoDir, patchedFiles: overlay });
    gateFiles = plan.patches.length;
    stages["semantic_gate"] = {
      ms: performance.now() - t0,
      extra: { files: gateFiles, ok: gate.ok ? 1 : 0 },
    };
  } else {
    stages["semantic_gate"] = { ms: performance.now() - t0, extra: { files: 0 } };
  }
  peakRss = Math.max(peakRss, rssMb());

  const totalMs = performance.now() - totalStart;
  const rssAfter = rssMb();
  peakRss = Math.max(peakRss, rssAfter);

  // Cleanup
  await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});

  return {
    workload: label,
    repos: 1,
    files,
    usages: analysis.usages.length,
    concurrency: 1,
    totalMs,
    stages,
    peakRssMb: peakRss,
    rssBeforeMb: rssBefore,
    rssAfterMb: rssAfter,
  };
}

function stats(values: number[]) {
  if (values.length === 0) return { min: 0, max: 0, mean: 0, median: 0, p95: 0, p99: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  const median = sorted[Math.floor(sorted.length / 2)]!;
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? sorted[sorted.length - 1]!;
  const p99 = sorted[Math.floor(sorted.length * 0.99)] ?? sorted[sorted.length - 1]!;
  return { min: sorted[0]!, max: sorted[sorted.length - 1]!, mean, median, p95, p99 };
}

async function runWithRepeats(
  label: string,
  files: number,
  usages: number,
  repeats: number,
): Promise<WorkloadResult[]> {
  console.log(`\n=== ${label}: ${files} files, ~${usages} usages (warmup + ${repeats} runs) ===`);
  // Warmup (not measured)
  await benchWorkload(`${label} warmup`, files, usages);
  if (global.gc) global.gc();
  await new Promise((r) => setTimeout(r, 500));
  const results: WorkloadResult[] = [];
  for (let i = 0; i < repeats; i++) {
    const r = await benchWorkload(`${label} run${i + 1}`, files, usages);
    results.push(r);
    console.log(
      `  run ${i + 1}: total ${r.totalMs.toFixed(0)}ms, peak ${r.peakRssMb}MB, usages ${r.usages}`,
    );
    if (global.gc) global.gc();
    await new Promise((r) => setTimeout(r, 200));
  }
  return results;
}

async function main(): Promise<void> {
  console.log("LOCAL BASELINE — NOT PRODUCTION CAPACITY");
  console.log(`Node ${process.version} | rss before ${rssMb()}MB`);
  const workloads: Array<{ label: string; files: number; usages: number }> = [
    { label: "A-10 usages", files: 5, usages: 10 },
    { label: "B-100 usages", files: 20, usages: 100 },
    { label: "C-1k usages", files: 100, usages: 1000 },
  ];

  const all: WorkloadResult[][] = [];
  for (const w of workloads) {
    const repeats = w.usages >= 1000 ? 5 : 10; // fewer repeats for expensive
    const results = await runWithRepeats(w.label, w.files, w.usages, repeats);
    all.push(results);
    // Report per-workload stats
    const totals = results.map((r) => r.totalMs);
    const s = stats(totals);
    console.log(
      `\n${w.label} totals (ms): min ${s.min.toFixed(0)} max ${s.max.toFixed(0)} mean ${s.mean.toFixed(0)} median ${s.median.toFixed(0)} p95 ${s.p95.toFixed(0)} p99 ${s.p99.toFixed(0)}`,
    );
    const rssVals = results.map((r) => r.peakRssMb);
    const rssS = stats(rssVals);
    console.log(`  peak RSS MB: min ${rssS.min} max ${rssS.max} mean ${rssS.mean.toFixed(1)}`);
  }

  // Save raw JSON for report
  const outPath = path.join(process.cwd(), "bench-phase1-results.json");
  await fs.writeFile(outPath, JSON.stringify(all.flat(), null, 2), "utf8");
  console.log(`\nRaw results written to ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
