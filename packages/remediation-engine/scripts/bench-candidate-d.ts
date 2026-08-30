/**
 * LOCAL BASELINE — NOT PRODUCTION CAPACITY
 * Candidate D: Limited diagnostics to changed surfaces.
 * Expected: DIFFER from full diagnostics (miss errors = false negatives).
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
// Find files transitively importing changed file
async function findTransitiveDependents(
  rootDir: string,
  changedAbs: string,
  allFiles: string[],
  fsRef: any,
): Set<string> {
  const importMap = new Map<string, Set<string>>();
  for (const f of allFiles) {
    const content = await fsRef.readFile(f, "utf8");
    const imports = new Set<string>();
    const impRegex = /import\s+[^{}]+\s+from\s+["']([^"']+)["']/g;
    let m: RegExpExecArray | null;
    while ((m = impRegex.exec(content)) !== null) {
      imports.add(m[1]);
    }
    importMap.set(f, imports);
  }
  const dependents = new Set<string>();
  const queue: string[] = [changedAbs];
  const visited = new Set<string>([changedAbs]);
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const [f, imports] of importMap.entries()) {
      if (visited.has(f)) continue;
      if (imports.has(path.relative(path.dirname(current), f))) {
        visited.add(f);
        dependents.add(f);
        queue.push(f);
      }
    }
  }
  return dependents;
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
async function benchD(files: number): Promise<{
  baseTotal: number;
  limTotal: number;
  match: boolean;
  missedErrors: number;
  rssBefore: number;
  rssAfter: number;
}> {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), `bench-candD-${files}-`));
  const repoDir = path.join(tmpRoot, "repo");
  await fs.mkdir(repoDir, { recursive: true });
  await createRepo(repoDir, files);
  const opts: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    allowJs: true,
  };
  const configPath = ts.findConfigFile(repoDir, ts.sys.fileExists, "tsconfig.json");
  let rootNames: string[] = [];
  if (configPath) {
    const raw = ts.readConfigFile(configPath, ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(raw.config, ts.sys, path.dirname(configPath));
    rootNames = parsed.fileNames;
  }
  if (rootNames.length === 0) {
    const collected: string[] = [];
    async function collect(d: string): Promise<void> {
      for (const e of await fs.readdir(d, { withFileTypes: true })) {
        if (e.isDirectory()) {
          if (["node_modules", ".git", "dist", ".next"].includes(e.name)) continue;
          await collect(path.join(d, e.name));
        } else if (e.isFile() && /\.(ts|tsx)$/.test(e.name)) collected.push(path.join(d, e.name));
      }
    }
    await collect(repoDir);
    rootNames = collected;
  }
  const patchedFile = path.resolve(repoDir, `src/m0/file0.ts`);
  const original = await fs.readFile(patchedFile, "utf8");
  const patched = original.replace(`v0 = 0`, `v0 = 999`);
  // Collect all file paths into allFiles
  const allFiles: string[] = [];
  async function collectAll(d: string): Promise<void> {
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (["node_modules", ".git", "dist", ".next"].includes(e.name)) continue;
        await collectAll(path.join(d, e.name));
      } else if (e.isFile() && /\.(ts|tsx)$/.test(e.name)) allFiles.push(path.join(d, e.name));
    }
  }
  await collectAll(repoDir);
  // ---- Candidate A: Full diagnostics (baseline + patched) ----
  const hostAA = ts.createCompilerHost(opts, true);
  const progAA = ts.createProgram({ rootNames, options: opts, host: hostAA });
  const synAA = progAA.getSyntacticDiagnostics();
  const semAA = progAA.getSemanticDiagnostics();
  const baseFull = { syn: normalizeDiags(synAA), sem: normalizeDiags(semAA) };
  const t0A = performance.now();
  const hostAB = ts.createCompilerHost(opts, true);
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
  const progAB = ts.createProgram({ rootNames, options: opts, host: hostAB });
  const synAB = progAB.getSyntacticDiagnostics();
  const semAB = progAB.getSemanticDiagnostics();
  const patchedFull = { syn: normalizeDiags(synAB), sem: normalizeDiags(semAB) };
  baseTotal = performance.now() - t0A;
  // ---- Candidate D: Limited diagnostics to changed surfaces ----
  // 1. Find transitive dependents of changed file
  const changedAbs = path.resolve(repoDir, path.relative(repoDir, patchedFile));
  const dependents = await findTransitiveDependents(repoDir, changedAbs, allFiles, fs);
  // The "limited set" = changed file + transitive dependents
  const limitedSet = new Set<string>([patchedFile, ...dependents]);
  // Also add files in the same m0/ directory as the changed file
  for (const f of allFiles) {
    if (path.dirname(f) === path.dirname(patchedFile)) limitedSet.add(f);
  }
  // 2. Run program with overlay, then filter diagnostics to limited set
  const hostD = ts.createCompilerHost(opts, true);
  const overlayD = new Map<string, string>([[patchedFile, patched]]);
  const origGetD = hostD.getSourceFile.bind(hostD);
  hostD.getSourceFile = (
    fn: string,
    lang: ts.ScriptTarget,
    onError?: (msg: string) => void,
    shouldCreate?: boolean,
  ) => {
    const ov = overlayD.get(fn);
    if (ov !== undefined) return ts.createSourceFile(fn, ov, lang, true);
    return origGetD(fn, lang, onError, shouldCreate);
  };
  const progD = ts.createProgram({ rootNames, options: opts, host: hostD });
  const synD = progD.getSyntacticDiagnostics();
  const semD = progD.getSemanticDiagnostics();
  // Filter semantic diagnostics to only files in limited set
  const limitedSem = normalizeDiags(semD).filter((d) => limitedSet.has(d[0])); // d[0] is fileName
  const limitedSyn = normalizeDiags(synD).filter((d) => limitedSet.has(d[0]));
  limTotal = performance.now() - t0A;
  // Count missed errors: full patched sem tuples whose fileName is NOT in limited set
  const fullPatchedSemTuples = normalizeDiags(semAB);
  let missedErrors = 0;
  for (const d of fullPatchedSemTuples) {
    if (!limitedSet.has(d[0])) {
      missedErrors++;
    }
  }
  // Also check: are there NEW errors from the patch that limited misses?
  // new errors = in patched but not in baseline
  // For now, just count missed as diagnostics outside limited set
  await fs.rm(tmpRoot, { recursive: true, force: true });
  matchD = diagsEqual(baseFull.sem, limitedSem); // expected: false
  return {
    baseTotal,
    limTotal,
    match: matchD,
    missedErrors,
    rssBefore: rssMb(),
    rssAfter: rssMb(),
  };
}
let baseTotal, limTotal, matchD;
async function run(): Promise<void> {
  console.log("LOCAL BASELINE — NOT PRODUCTION CAPACITY");
  console.log(
    "Candidate D: Limited diagnostics to changed surfaces (expected: match=false, missed>0)",
  );
  const workloads = [100, 500, 1000];
  for (const files of workloads) {
    console.log(`\n=== ${files} TS files (warmup + 5 runs) ===`);
    const m = await benchD(files);
    if (global.gc) global.gc();
    await new Promise((r) => setTimeout(r, 300));
    const runs: Array<{
      baseTotal: number;
      limTotal: number;
      match: boolean;
      missedErrors: number;
    }> = [];
    let peakRss = 0;
    for (let i = 0; i < 5; i++) {
      const r = await benchD(files);
      runs.push(r);
      peakRss = Math.max(peakRss, r.rssAfter);
      console.log(
        `  run ${i + 1}: base ${r.baseTotal.toFixed(0)}ms lim ${r.limTotal.toFixed(0)}ms match=${r.match} missed=${r.missedErrors}`,
      );
      if (global.gc) global.gc();
      await new Promise((r) => setTimeout(r, 150));
    }
    const b = runs.map((r) => r.baseTotal);
    const l = runs.map((r) => r.limTotal);
    const mb = (a: number[]) => stats(a);
    console.log(`  base: p50 ${mb(b).median.toFixed(0)} p95 ${mb(b).p95.toFixed(0)}`);
    console.log(`  lim: p50 ${mb(l).median.toFixed(0)} p95 ${mb(l).p95.toFixed(0)}`);
    console.log(
      `  match rate: ${runs.filter((r) => r.match).length}/5 (expected: 0/5 - limited should differ from full)`,
    );
    console.log(
      `  missed errors per run: ${runs.map((r) => r.missedErrors).join(",")} (expected: >0, i.e. limited misses some errors)`,
    );
    console.log(`  peak RSS: ${peakRss}MB`);
  }
  const mem = rssMb();
  if (mem < 4000) {
    console.log("\n=== 5000 TS files (3 runs) ===");
    for (let i = 0; i < 3; i++) {
      try {
        const m = await benchD(5000);
        console.log(
          `  run ${i + 1}: base ${m.baseTotal.toFixed(0)}ms lim ${m.limTotal.toFixed(0)}ms match=${m.match} missed=${m.missedErrors}`,
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
