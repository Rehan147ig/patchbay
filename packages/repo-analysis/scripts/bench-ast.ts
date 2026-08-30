/**
 * LOCAL BASELINE — NOT PRODUCTION CAPACITY
 * Isolated AST/file benchmark (no semantic gate).
 * Measures collectFiles, parsing, binding collection, analyzeSource, graph extraction.
 */
import { performance } from "node:perf_hooks";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { analyzeRepository } from "../src/index.ts";
import { extractGraph } from "../src/graph.ts";

function rssMb(): number {
  return Math.round(process.memoryUsage().rss / 1024 / 1024);
}
function heapMb(): number {
  return Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
}
function stats(a: number[]) {
  if (a.length === 0) return { min: 0, max: 0, mean: 0, median: 0, p95: 0, p99: 0 };
  const s = [...a].sort((x, y) => x - y);
  return {
    min: s[0]!,
    max: s[s.length - 1]!,
    mean: s.reduce((x, y) => x + y, 0) / s.length,
    median: s[Math.floor(s.length / 2)]!,
    p95: s[Math.floor(s.length * 0.95)] ?? s[s.length - 1]!,
    p99: s[Math.floor(s.length * 0.99)] ?? s[s.length - 1]!,
  };
}
async function createRepo(rootDir: string, files: number): Promise<void> {
  for (let i = 0; i < files; i++) {
    const dir = path.join(rootDir, `src/m${Math.floor(i / 100)}`);
    await fs.mkdir(dir, { recursive: true });
    const content = `import { OpenAI } from "openai";\nexport const v${i} = ${i};\nexport function f${i}(x: string) { return x + "${i}"; }\n`;
    await fs.writeFile(path.join(dir, `file${i}.ts`), content, "utf8");
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
async function collectFiles(rootDir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(d: string): Promise<void> {
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (["node_modules", ".git", "dist", ".next"].includes(e.name)) continue;
        await walk(path.join(d, e.name));
      } else if (e.isFile() && /\.(ts|tsx|js|jsx)$/.test(e.name)) out.push(path.join(d, e.name));
    }
  }
  await walk(rootDir);
  return out;
}
async function benchOnce(files: number): Promise<Record<string, number>> {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), `bench-ast-${files}-`));
  const repoDir = path.join(tmpRoot, "repo");
  await fs.mkdir(repoDir, { recursive: true });
  await createRepo(repoDir, files);
  const m: Record<string, number> = {};
  let t0 = performance.now();
  const discovered = await collectFiles(repoDir);
  m.collectFiles = performance.now() - t0;
  m.files = discovered.length;
  t0 = performance.now();
  const analysis = await analyzeRepository({ rootDir: repoDir, trackPackages: ["openai"] });
  m.astAnalysis = performance.now() - t0;
  m.usages = analysis.usages.length;
  t0 = performance.now();
  try {
    const g: any = await (extractGraph as any)({
      usages: analysis.usages,
      manifests: analysis.manifests,
    });
    m.graph = performance.now() - t0;
    m.nodes = g?.nodes?.length ?? analysis.usages.length;
    m.edges = g?.edges?.length ?? 0;
  } catch {
    m.graph = performance.now() - t0;
    m.nodes = analysis.usages.length;
    m.edges = 0;
  }
  m.total = m.collectFiles + m.astAnalysis + m.graph;
  await fs.rm(tmpRoot, { recursive: true, force: true });
  return m;
}
async function run(): Promise<void> {
  console.log("LOCAL BASELINE — NOT PRODUCTION CAPACITY");
  console.log("AST/file isolated benchmark (no semantic gate)");
  const workloads = [1000, 5000];
  // 10k only if 5k peak < 5GB
  for (const files of workloads) {
    console.log(`\n=== ${files} files (warmup + 10 runs) ===`);
    const rssBefore = rssMb();
    await benchOnce(files); // warmup
    if (global.gc) global.gc();
    await new Promise((r) => setTimeout(r, 300));
    const runs: Record<string, number>[] = [];
    let peakRss = rssBefore;
    for (let i = 0; i < 10; i++) {
      const m = await benchOnce(files);
      runs.push(m);
      peakRss = Math.max(peakRss, rssMb());
      console.log(
        `  run ${i + 1}: collect ${m.collectFiles.toFixed(0)}ms ast ${m.astAnalysis.toFixed(0)}ms graph ${m.graph.toFixed(0)}ms total ${m.total.toFixed(0)}ms files ${m.files} usages ${m.usages}`,
      );
      if (global.gc) global.gc();
      await new Promise((r) => setTimeout(r, 150));
    }
    const totals = runs.map((r) => r.total);
    const collects = runs.map((r) => r.collectFiles);
    const asts = runs.map((r) => r.astAnalysis);
    const s = (a: number[]) => stats(a);
    console.log(
      `  total: p50 ${s(totals).median.toFixed(0)} p95 ${s(totals).p95.toFixed(0)} p99 ${s(totals).p99.toFixed(0)}`,
    );
    console.log(
      `  collectFiles: p50 ${s(collects).median.toFixed(0)} p95 ${s(collects).p95.toFixed(0)}`,
    );
    console.log(
      `  astAnalysis: p50 ${s(asts).median.toFixed(0)} p95 ${s(asts).p95.toFixed(0)} files/sec ${(files / (s(asts).median / 1000)).toFixed(1)}`,
    );
    console.log(`  rss before ${rssBefore}MB peak ${peakRss}MB after ${rssMb()}MB`);
    if (peakRss > 5000) {
      console.log(`  STOP: peak ${peakRss}MB >5GB, not proceeding to larger`);
      break;
    }
  }
  const mem = rssMb();
  if (mem < 4000) {
    console.log("\n=== 10k files (3 runs, may OOM) ===");
    for (let i = 0; i < 3; i++) {
      try {
        const m = await benchOnce(10000);
        console.log(`  run ${i + 1}: total ${m.total.toFixed(0)}ms peak ${rssMb()}MB`);
      } catch (e) {
        console.log(`  run ${i + 1} failed: ${String(e).slice(0, 200)}`);
        break;
      }
    }
  } else console.log(`\nSkipping 10k: peak ${mem}MB would OOM`);
}
run().catch((e) => {
  console.error(e);
  process.exit(1);
});
