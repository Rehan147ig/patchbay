/**
 * LOCAL BASELINE — NOT PRODUCTION CAPACITY
 * Isolated semantic-gate benchmark.
 * Measures ts.createProgram, createOverlayHost, syntactic/semantic diagnostics, baseline vs patched.
 * Does NOT modify production code. Synthetic repos under fs.mkdtemp(), deleted after.
 */
import { performance } from "node:perf_hooks";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import * as ts from "typescript";

function rssMb(): number {
  return Math.round(process.memoryUsage().rss / 1024 / 1024);
}
function heapMb(): number {
  return Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
}

function stats(values: number[]) {
  if (values.length === 0) return { min: 0, max: 0, mean: 0, median: 0, p95: 0, p99: 0 };
  const s = [...values].sort((a, b) => a - b);
  return {
    min: s[0]!,
    max: s[s.length - 1]!,
    mean: s.reduce((a, b) => a + b, 0) / s.length,
    median: s[Math.floor(s.length / 2)]!,
    p95: s[Math.floor(s.length * 0.95)] ?? s[s.length - 1]!,
    p99: s[Math.floor(s.length * 0.99)] ?? s[s.length - 1]!,
  };
}

async function createRepo(rootDir: string, files: number): Promise<void> {
  for (let i = 0; i < files; i++) {
    const dir = path.join(rootDir, `src/m${Math.floor(i / 100)}`);
    await fs.mkdir(dir, { recursive: true });
    const content = `// file${i}.ts\nimport { OpenAI } from "openai";\nexport const v${i} = ${i};\nexport async function f${i}(x: string) { return x + "${i}"; }\n`;
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

function loadOptions(projectDir: string): ts.CompilerOptions {
  const configPath = ts.findConfigFile(projectDir, ts.sys.fileExists, "tsconfig.json");
  if (!configPath)
    return {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      allowJs: true,
    } as any;
  const raw = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(raw.config, ts.sys, path.dirname(configPath));
  return { ...parsed.options, noEmit: true, skipLibCheck: true };
}

function createOverlayHost(
  options: ts.CompilerOptions,
  overlay: Map<string, string>,
): ts.CompilerHost {
  const host = ts.createCompilerHost(options, true);
  const origGetSourceFile = host.getSourceFile.bind(host);
  const origReadFile = host.readFile.bind(host);
  const origFileExists = host.fileExists.bind(host);
  host.getSourceFile = (fileName, lang, onError, shouldCreate) => {
    const ov = overlay.get(path.resolve(fileName));
    if (ov !== undefined) return ts.createSourceFile(fileName, ov, lang, true);
    return origGetSourceFile(fileName, lang, onError, shouldCreate);
  };
  host.readFile = (fileName) => overlay.get(path.resolve(fileName)) ?? origReadFile(fileName);
  host.fileExists = (fileName) => overlay.has(path.resolve(fileName)) || origFileExists(fileName);
  return host;
}

async function benchOnce(files: number): Promise<Record<string, number>> {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), `bench-sem-${files}-`));
  const repoDir = path.join(tmpRoot, "repo");
  await fs.mkdir(repoDir, { recursive: true });
  await createRepo(repoDir, files);

  const options = loadOptions(repoDir);
  const configPath = ts.findConfigFile(repoDir, ts.sys.fileExists, "tsconfig.json");
  let rootNames: string[] = [];
  if (configPath) {
    const raw = ts.readConfigFile(configPath, ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(raw.config, ts.sys, path.dirname(configPath));
    rootNames = parsed.fileNames;
  }
  if (rootNames.length === 0) {
    // fallback: all files we created
    const all: string[] = [];
    async function walk(d: string) {
      for (const e of await fs.readdir(d, { withFileTypes: true })) {
        if (e.isDirectory()) await walk(path.join(d, e.name));
        else if (e.name.endsWith(".ts")) all.push(path.join(d, e.name));
      }
    }
    await walk(repoDir);
    rootNames = all;
  }

  // Patch 1 file
  const patchedFile = path.resolve(repoDir, `src/m0/file0.ts`);
  const original = await fs.readFile(patchedFile, "utf8");
  const patched = original.replace(`v0 = 0`, `v0 = 999`);

  const overlay = new Map<string, string>([[patchedFile, patched]]);

  const m: Record<string, number> = {};

  // createProgram baseline
  let t0 = performance.now();
  let host = createOverlayHost(options, new Map());
  let program = ts.createProgram({ rootNames, options, host });
  m.createProgramBaseline = performance.now() - t0;

  t0 = performance.now();
  const synBase = program.getSyntacticDiagnostics();
  m.syntacticBaseline = performance.now() - t0;

  t0 = performance.now();
  const semBase = program.getSemanticDiagnostics();
  m.semanticBaseline = performance.now() - t0;

  // createProgram patched
  t0 = performance.now();
  host = createOverlayHost(options, overlay);
  program = ts.createProgram({ rootNames, options, host });
  m.createProgramPatched = performance.now() - t0;

  t0 = performance.now();
  const synPatched = program.getSyntacticDiagnostics();
  m.syntacticPatched = performance.now() - t0;

  t0 = performance.now();
  const semPatched = program.getSemanticDiagnostics();
  m.semanticPatched = performance.now() - t0;

  m.total =
    m.createProgramBaseline +
    m.syntacticBaseline +
    m.semanticBaseline +
    m.createProgramPatched +
    m.syntacticPatched +
    m.semanticPatched;
  m.synCountBase = synBase.length;
  m.semCountBase = semBase.length;
  m.synCountPatched = synPatched.length;
  m.semCountPatched = semPatched.length;

  await fs.rm(tmpRoot, { recursive: true, force: true });
  return m;
}

async function run(): Promise<void> {
  console.log("LOCAL BASELINE — NOT PRODUCTION CAPACITY");
  console.log("Semantic-gate isolated benchmark");
  const workloads = [100, 500, 1000];
  // 5000 only if 1000 peak < 5GB
  for (const files of workloads) {
    console.log(`\n=== ${files} TS files (warmup + 10 runs) ===`);
    const rssBefore = rssMb();
    const heapBefore = heapMb();
    // warmup
    await benchOnce(files);
    if (global.gc) global.gc();
    await new Promise((r) => setTimeout(r, 300));
    const runs: Record<string, number>[] = [];
    let peakRss = rssBefore;
    let peakHeap = heapBefore;
    for (let i = 0; i < 10; i++) {
      const m = await benchOnce(files);
      runs.push(m);
      peakRss = Math.max(peakRss, rssMb());
      peakHeap = Math.max(peakHeap, heapMb());
      console.log(
        `  run ${i + 1}: total ${m.total.toFixed(0)}ms (create ${m.createProgramPatched.toFixed(0)} + syn ${m.syntacticPatched.toFixed(0)} + sem ${m.semanticPatched.toFixed(0)})`,
      );
      if (global.gc) global.gc();
      await new Promise((r) => setTimeout(r, 150));
    }
    const totals = runs.map((r) => r.total);
    const creates = runs.map((r) => r.createProgramPatched);
    const syns = runs.map((r) => r.syntacticPatched);
    const sems = runs.map((r) => r.semanticPatched);
    const s = (a: number[]) => stats(a);
    console.log(
      `  total: min ${s(totals).min.toFixed(0)} max ${s(sems).max.toFixed(0)} mean ${s(totals).mean.toFixed(0)} median ${s(totals).median.toFixed(0)} p95 ${s(totals).p95.toFixed(0)} p99 ${s(totals).p99.toFixed(0)}`,
    );
    console.log(
      `  createProgramPatched: p50 ${s(creates).median.toFixed(0)} p95 ${s(creates).p95.toFixed(0)}`,
    );
    console.log(
      `  syntacticPatched: p50 ${s(syns).median.toFixed(0)} p95 ${s(syns).p95.toFixed(0)}`,
    );
    console.log(
      `  semanticPatched: p50 ${s(sems).median.toFixed(0)} p95 ${s(sems).p95.toFixed(0)}`,
    );
    console.log(
      `  rss before ${rssBefore}MB peak ${peakRss}MB after ${rssMb()}MB heap peak ${peakHeap}MB`,
    );
    if (peakRss > 5000) {
      console.log(`  STOP: peak RSS ${peakRss}MB > 5GB, not proceeding to larger workload`);
      break;
    }
  }
  // Try 5000 if safe
  const mem = rssMb();
  if (mem < 4000) {
    console.log("\n=== 5000 TS files (3 runs, may OOM) ===");
    for (let i = 0; i < 3; i++) {
      try {
        const m = await benchOnce(5000);
        console.log(`  run ${i + 1}: total ${m.total.toFixed(0)}ms peak ${rssMb()}MB`);
      } catch (e) {
        console.log(`  run ${i + 1} failed: ${String(e).slice(0, 200)}`);
        break;
      }
    }
  } else {
    console.log(`\nSkipping 5000 files: peak already ${mem}MB, would OOM on 7.3GiB host`);
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
