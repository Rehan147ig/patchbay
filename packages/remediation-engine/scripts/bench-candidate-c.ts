/**
 * LOCAL BASELINE — NOT PRODUCTION CAPACITY
 * Candidate C: Incremental / oldProgram reuse.
 */
import { performance } from "node:perf_hooks";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import * as ts from "typescript";

function rssMb(): number {
  return Math.round(process.memoryUsage().rss / 1024 / 1024);
}
function stats(a: number[]): {
  min: number;
  max: number;
  mean: number;
  median: number;
  p95: number;
  p99: number;
} {
  if (a.length === 0) return { min: 0, max: 0, mean: 0, median: 0, p95: 0, p99: 0 };
  const s = [...a].sort((x, y) => x - y);
  return {
    min: s[0],
    max: s[s.length - 1],
    mean: s.reduce((x, y) => x + y, 0) / s.length,
    median: s[Math.floor(s.length / 2)],
    p95: s[Math.floor(s.length * 0.95)] ?? s[s.length - 1],
    p99: s[Math.floor(s.length * 0.99)] ?? s[s.length - 1],
  };
}
function diagKey(d: ts.Diagnostic): [string, number, number, string, string] {
  return [
    d.file?.fileName ?? "unknown",
    d.start ?? 0,
    d.length ?? 0,
    d.code ?? "unknown",
    (d.messageText?.toString() ?? "").slice(0, 200),
  ];
}
function diagsEqual(a: ts.Diagnostic[], b: ts.Diagnostic[]): boolean {
  if (a.length !== b.length) return false;
  const ka = a.map(diagKey).sort();
  const kb = b.map(diagKey).sort();
  if (ka.length !== kb.length) return false;
  return ka.every(
    (k, i) =>
      k[0] === kb[i][0] &&
      k[1] === kb[i][1] &&
      k[2] === kb[i][2] &&
      k[3] === kb[i][3] &&
      k[4] === kb[i][4],
  );
}
function diagTuple(d: ts.Diagnostic): [string, number, number, number, string] {
  return [
    d.file?.fileName ?? "",
    d.start ?? 0,
    d.length ?? 0,
    d.code ?? 0,
    (d.messageText?.toString() ?? "").slice(0, 300),
  ];
}
function normalizeDiags(diags: ts.Diagnostic[]): [string, number, number, number, string][] {
  return diags.map(diagTuple);
}
async function walkDir(d: string, out: string[]): Promise<void> {
  for (const e of await fs.readdir(d, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (["node_modules", ".git", "dist", ".next"].includes(e.name)) continue;
      await walkDir(path.join(d, e.name), out);
    } else if (e.isFile() && /\.(ts|tsx)$/.test(e.name)) out.push(path.join(d, e.name));
  }
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
function loadOpts(projectDir: string): ts.CompilerOptions {
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
async function benchC(files: number): Promise<{
  baseTotal: number;
  incTotal: number;
  match: boolean;
  newErrors: boolean;
  rssBefore: number;
  rssAfter: number;
}> {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), `bench-candC-${files}-`));
  const repoDir = path.join(tmpRoot, "repo");
  await fs.mkdir(repoDir, { recursive: true });
  await createRepo(repoDir, files);
  const options = loadOpts(repoDir);
  let rootNames: string[] = [];
  const configPath = ts.findConfigFile(repoDir, ts.sys.fileExists, "tsconfig.json");
  if (configPath) {
    const raw = ts.readConfigFile(configPath, ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(raw.config, ts.sys, path.dirname(configPath));
    rootNames = parsed.fileNames;
  }
  if (rootNames.length === 0) {
    await walkDir(repoDir, rootNames);
  }
  const patchedFile = path.resolve(repoDir, `src/m0/file0.ts`);
  const original = await fs.readFile(patchedFile, "utf8");
  const patched = original.replace(`v0 = 0`, `v0 = 999`);
  const allFiles: string[] = [];
  async function collectFiles(d: string): Promise<void> {
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (["node_modules", ".git", "dist", ".next"].includes(e.name)) continue;
        await collectFiles(path.join(d, e.name));
      } else if (e.isFile() && /\.(ts|tsx)$/.test(e.name)) allFiles.push(path.join(d, e.name));
    }
  }
  await collectFiles(repoDir);
  rootNames = rootNames.length > 0 ? rootNames : allFiles;
  // ---- Candidate A: Current implementation ----
  const hostAA = ts.createCompilerHost(options, true);
  const progAA = ts.createProgram({ rootNames, options, host: hostAA });
  const synAA = progAA.getSyntacticDiagnostics();
  const semAA = progAA.getSemanticDiagnostics();
  const baseLine = { syn: normalizeDiags(synAA), sem: normalizeDiags(semAA) };
  const tAA = performance.now();
  const hostAB = ts.createCompilerHost(options, true);
  const overlayAB = new Map<string, string>([[patchedFile, patched]]);
  const origGet = hostAB.getSourceFile.bind(hostAB);
  hostAB.getSourceFile = (
    fn: string,
    lang: ts.ScriptTarget,
    onError?: (msg: string) => void,
    shouldCreate?: boolean,
  ) => {
    const ov = overlayAB.get(fn);
    if (ov !== undefined) return ts.createSourceFile(fn, ov, lang, true);
    return origGet(fn, lang, onError, shouldCreate);
  };
  const progAB = ts.createProgram({ rootNames, options, host: hostAB });
  const synAB = progAB.getSyntacticDiagnostics();
  const semAB = progAB.getSemanticDiagnostics();
  const patchedLine = { syn: normalizeDiags(synAB), sem: normalizeDiags(semAB) };
  const baseTotal = performance.now() - tAA;
  // ---- Candidate C: Incremental / oldProgram reuse ----
  // 1. Create baseline Program
  const hostC = ts.createCompilerHost(options, true);
  const progCBase = ts.createProgram({ rootNames, options, host: hostC });
  const synCBase = progCBase.getSyntacticDiagnostics();
  const semCBase = progCBase.getSemanticDiagnostics();
  // 2. Create patched program reusing baseline as oldProgram
  const tCC = performance.now();
  const progCPatched = ts.createProgram({ rootNames, options, host: hostC, oldProgram: progCBase });
  const synCPat = progCPatched.getSyntacticDiagnostics();
  const semCPat = progCPatched.getSemanticDiagnostics();
  const incTotal = performance.now() - tCC;
  const baseC = { syn: normalizeDiags(synCBase), sem: normalizeDiags(semCBase) };
  const patchedC = { syn: normalizeDiags(synCPat), sem: normalizeDiags(semCPat) };
  const matchC =
    diagsEqual(baseLine.syn, baseC.syn) &&
    diagsEqual(baseLine.sem, baseC.sem) &&
    diagsEqual(patchedLine.syn, patchedC.syn) &&
    diagsEqual(patchedLine.sem, patchedC.sem);
  let newErrors = false;
  if (patchedLine.sem.length > baseLine.sem.length) newErrors = true;
  if (patchedC.sem.length > baseC.sem.length) newErrors = newErrors || true;
  await fs.rm(tmpRoot, { recursive: true, force: true });
  return { baseTotal, incTotal, match: matchC, newErrors, rssBefore: rssMb(), rssAfter: rssMb() };
}
async function run(): Promise<void> {
  console.log("LOCAL BASELINE — NOT PRODUCTION CAPACITY");
  console.log("Candidate C: Incremental / oldProgram reuse");
  const workloads = [100, 500, 1000];
  for (const files of workloads) {
    console.log(`\n=== ${files} TS files (warmup + 10 runs) ===`);
    const first = await benchC(files);
    if (global.gc) global.gc();
    await new Promise((r) => setTimeout(r, 300));
    const runs: Array<{ baseTotal: number; incTotal: number; match: boolean; newErrors: boolean }> =
      [];
    let peakRss = 0;
    for (let i = 0; i < 10; i++) {
      const m = await benchC(files);
      runs.push(m);
      peakRss = Math.max(peakRss, m.rssAfter);
      console.log(
        `  run ${i + 1}: base ${m.baseTotal.toFixed(0)}ms inc ${m.incTotal.toFixed(0)}ms match ${m.match} newErrs ${m.newErrors}`,
      );
      if (global.gc) global.gc();
      await new Promise((r) => setTimeout(r, 150));
    }
    const b = runs.map((r) => r.baseTotal);
    const i = runs.map((r) => r.incTotal);
    const mb = (a: number[]) => stats(a);
    console.log(`  base: p50 ${mb(b).median.toFixed(0)} p95 ${mb(b).p95.toFixed(0)}`);
    console.log(`  inc: p50 ${mb(i).median.toFixed(0)} p95 ${mb(i).p95.toFixed(0)}`);
    console.log(`  match rate: ${runs.filter((r) => r.match).length}/10`);
    console.log(`  newErrors: ${runs.some((r) => r.newErrors) ? "YES" : "NO"}`);
    console.log(`  peak RSS: ${peakRss}MB`);
  }
  const mem = rssMb();
  if (mem < 4000) {
    console.log("\n=== 5000 TS files (3 runs) ===");
    for (let i = 0; i < 3; i++) {
      try {
        const m = await benchC(5000);
        console.log(
          `  run ${i + 1}: base ${m.baseTotal.toFixed(0)}ms inc ${m.incTotal.toFixed(0)}ms match ${m.match} newErrs ${m.newErrors} peak ${m.rssAfter}MB`,
        );
      } catch (e) {
        console.log(`  run ${i + 1} failed: ${String(e).slice(0, 200)}`);
        break;
      }
    }
  } else console.log(`\nSkipping 5000: peak already ${mem}MB would OOM`);
}
run().catch((e) => {
  console.error(e);
  process.exit(1);
});
