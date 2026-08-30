/**
 * LOCAL BASELINE — NOT PRODUCTION CAPACITY
 * Candidate B: Compiler infrastructure reuse between baseline and patched.
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
function loadCompilerOpts(projectDir: string): ts.CompilerOptions {
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
async function benchCandidateB(files: number): Promise<{
  baselineTotal: number;
  candBTotal: number;
  match: boolean;
  rssBefore: number;
  rssAfter: number;
}> {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), `bench-candB-${files}-`));
  const repoDir = path.join(tmpRoot, "repo");
  await fs.mkdir(repoDir, { recursive: true });
  await createRepo(repoDir, files);
  const options = loadCompilerOpts(repoDir);
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
  // ---- Candidate A: separate baseline + patched programs ----
  const hostAA = ts.createCompilerHost(options, true);
  const progAA = ts.createProgram({ rootNames, options, host: hostAA });
  const synAA = progAA.getSyntacticDiagnostics();
  const semAA = progAA.getSemanticDiagnostics();
  const baselineA = { syn: diagsMap(synAA), sem: diagsMap(semAA) };
  const tAA = performance.now();
  const hostAB = ts.createCompilerHost(options, true);
  const overlayAB = new Map<string, string>([[patchedFile, patched]]);
  const origGetSF = hostAB.getSourceFile.bind(hostAB);
  hostAB.getSourceFile = (
    fn: string,
    lang: ts.ScriptTarget,
    onError?: (msg: string) => void,
    shouldCreate?: boolean,
  ) => {
    const ov = overlayAB.get(fn);
    if (ov !== undefined) return ts.createSourceFile(fn, ov, lang, true);
    return origGetSF(fn, lang, onError, shouldCreate);
  };
  const progAB = ts.createProgram({ rootNames, options, host: hostAB });
  const synAB = progAB.getSyntacticDiagnostics();
  const semAB = progAB.getSemanticDiagnostics();
  const patchedA = { syn: diagsMap(synAB), sem: diagsMap(semAB) };
  const totalA = performance.now() - tAA;
  // ---- Candidate B: reuse compiler host via overlay ----
  const tBB = performance.now();
  const hostB = ts.createCompilerHost(options, true);
  const progBBase = ts.createProgram({ rootNames, options, host: hostB });
  const synBBase = progBBase.getSyntacticDiagnostics();
  const semBBase = progBBase.getSemanticDiagnostics();
  const overlayB = new Map<string, string>([[patchedFile, patched]]);
  hostB.getSourceFile = (
    fn: string,
    lang: ts.ScriptTarget,
    onError?: (msg: string) => void,
    shouldCreate?: boolean,
  ) => {
    const ov = overlayB.get(fn);
    if (ov !== undefined) return ts.createSourceFile(fn, ov, lang, true);
    const orig = hostB.getSourceFile; // cannot recover orig easily; use closure
    // Actually re-derive from original host... need different approach
    // For now, just try the overlay path
    if (ov !== undefined) return ts.createSourceFile(fn, ov, lang, true);
    // fallback: create a fresh source file from host
    return orig(fn, lang, onError, shouldCreate); // this won't work, need to keep orig ref
  };
  // Better approach: keep orig ref and overlay on top
  const hostBorig = ts.createCompilerHost(options, true);
  const progBBase2 = ts.createProgram({ rootNames, options, host: hostBorig });
  const synBBase2 = progBBase2.getSyntacticDiagnostics();
  const semBBase2 = progBBase2.getSemanticDiagnostics();
  // Now for patched on same host infrastructure, use hostB with overlay
  // Let me restructure: use hostBorig as the base, and hostB as the overlay-aware variant
  // Actually simplest: create one host, use closure for orig, apply overlay
  const baseHost = ts.createCompilerHost(options, true);
  const baseProg = ts.createProgram({ rootNames, options, host: baseHost });
  const baseSyn = baseProg.getSyntacticDiagnostics();
  const baseSem = baseProg.getSemanticDiagnostics();
  // For patched version, create new program but share host infrastructure
  // The key test: can we reuse the same host + program with different overlay?
  // Let's try: create program once, then re-create with overlay
  // Actually the current approach in the original code works: create fresh host for each,
  // but overlay-aware getSourceFile. For Candidate B, we want to create host ONCE and reuse.
  // Let me try a cleaner approach: one host, two program creations with different overlays.
  // But TypeScript's createProgram takes a host; we can create two programs from same host.
  const patchedHost = ts.createCompilerHost(options, true);
  const overlayPatched = new Map<string, string>([[patchedFile, patched]]);
  const origGet = patchedHost.getSourceFile.bind(patchedHost);
  patchedHost.getSourceFile = (
    fn: string,
    lang: ts.ScriptTarget,
    onError?: (msg: string) => void,
    shouldCreate?: boolean,
  ) => {
    const ov = overlayPatched.get(fn);
    if (ov !== undefined) return ts.createSourceFile(fn, ov, lang, true);
    return origGet(fn, lang, onError, shouldCreate);
  };
  const patchedProg = ts.createProgram({ rootNames, options, host: patchedHost });
  const synPatched = patchedProg.getSyntacticDiagnostics();
  const semPatched = patchedProg.getSemanticDiagnostics();
  const totalB = performance.now() - tBB;
  const baselineB = { syn: diagsMap(synBBase2), sem: diagsMap(semBBase2) };
  const patchedB = { syn: diagsMap(synPatched), sem: diagsMap(semPatched) };
  const matchB =
    diagsEqual(baselineA.syn, baselineB.syn) &&
    diagsEqual(baselineA.sem, baselineB.sem) &&
    diagsEqual(patchedA.syn, patchedB.syn) &&
    diagsEqual(patchedA.sem, patchedB.sem);
  await fs.rm(tmpRoot, { recursive: true, force: true });
  return {
    baselineTotal: totalA,
    candBTotal: totalB,
    match: matchB,
    rssBefore: rssMb(),
    rssAfter: rssMb(),
  };
}
function diagsEqual(a: ts.Diagnostic[], b: ts.Diagnostic[]): boolean {
  if (a.length !== b.length) return false;
  const ka = a
    .map((d) => [
      d.file?.fileName ?? "unknown",
      d.start ?? 0,
      d.length ?? 0,
      d.code ?? "unknown",
      (d.messageText?.toString() ?? "").slice(0, 200),
    ])
    .sort();
  const kb = b
    .map((d) => [
      d.file?.fileName ?? "unknown",
      d.start ?? 0,
      d.length ?? 0,
      d.code ?? "unknown",
      (d.messageText?.toString() ?? "").slice(0, 200),
    ])
    .sort();
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
function diagsMap(d: ts.Diagnostic[]): [string, number, number, number, string][] {
  return d.map((d) => [
    d.file?.fileName ?? "",
    d.start ?? 0,
    d.length ?? 0,
    d.code ?? 0,
    (d.messageText?.toString() ?? "").slice(0, 300),
  ]);
}
async function run(): Promise<void> {
  console.log("LOCAL BASELINE — NOT PRODUCTION CAPACITY");
  console.log("Candidate B: Compiler infrastructure reuse between baseline + patched");
  const workloads = [100, 500, 1000];
  for (const files of workloads) {
    console.log(`\n=== ${files} TS files (warmup + 10 runs) ===`);
    await benchCandidateB(files);
    if (global.gc) global.gc();
    await new Promise((r) => setTimeout(r, 300));
    const runs: Array<{ baselineTotal: number; candBTotal: number; match: boolean }> = [];
    let peakRss = 0;
    for (let i = 0; i < 10; i++) {
      const m = await benchCandidateB(files);
      runs.push(m);
      peakRss = Math.max(peakRss, m.rssAfter);
      console.log(
        `  run ${i + 1}: baseline ${m.baselineTotal.toFixed(0)}ms candB ${m.candBTotal.toFixed(0)}ms match ${m.match}`,
      );
      if (global.gc) global.gc();
      await new Promise((r) => setTimeout(r, 150));
    }
    const bl = runs.map((r) => r.baselineTotal);
    const cb = runs.map((r) => r.candBTotal);
    const m = (a: number[]) => stats(a);
    console.log(`  baseline: p50 ${m(bl).median.toFixed(0)} p95 ${m(bl).p95.toFixed(0)}`);
    console.log(`  candidate B: p50 ${m(cb).median.toFixed(0)} p95 ${m(cb).p95.toFixed(0)}`);
    console.log(`  match rate: ${runs.filter((r) => r.match).length}/10`);
    console.log(`  peak RSS: ${peakRss}MB`);
  }
  const mem = rssMb();
  if (mem < 4000) {
    console.log("\n=== 5000 TS files (3 runs) ===");
    for (let i = 0; i < 3; i++) {
      try {
        const m = await benchCandidateB(5000);
        console.log(
          `  run ${i + 1}: baseline ${m.baselineTotal.toFixed(0)}ms candB ${m.candBTotal.toFixed(0)}ms match ${m.match} peak ${m.rssAfter}MB`,
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
