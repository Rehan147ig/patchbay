import { parentPort } from "node:worker_threads";
import ts from "typescript";
import { analyzeSource, collectBindings, collectUntrackedImports } from "./ast";
import { collectModuleExports, makeRelativeResolver } from "./exports";
import type { AnalyzedUsage, AnalysisError, ModuleExports, WorkspacePackage } from "./types";

/**
 * Worker-thread entry for parallel repository analysis.
 *
 * The parent (`parallel.ts`) fans out per-file chunks across a small pool;
 * each 3-pass phase stays sequential (fixed-point), only files run in
 * parallel. All messages are plain JSON so structured clone is cheap and
 * deterministic; results merge in chunk order on the parent.
 *
 * Spawned as `./analyze-worker.ts` and inherits the parent loader (tsx in
 * dev/prod, vite-node under vitest). Any spawn failure falls back to the
 * serial path — never fail a scan because threads are unavailable.
 */

export interface WorkerChunkFile {
  rel: string;
  source: string;
}

export interface WorkerShared {
  trackPackages: string[];
  envPrefixes: Record<string, string>;
  files: string[];
  workspacePackages: Array<{ name: string; entry: string; subpaths: Array<[string, string]> }>;
  exportsSnapshot: Array<{
    rel: string;
    named: Array<[string, string]>;
    defaultPackage: string | null;
  }>;
  bindingsSnapshot: Array<{ rel: string; bindings: Array<[string, string]> }>;
}

export type WorkerMode = "bindings" | "exports" | "analyze";

export interface WorkerRequest {
  taskId: number;
  mode: WorkerMode;
  files: WorkerChunkFile[];
  shared: WorkerShared;
}

export type WorkerPayload =
  | { kind: "bindings"; entries: Array<{ rel: string; bindings: Array<[string, string]> }> }
  | {
      kind: "exports";
      entries: Array<{
        rel: string;
        named: Array<[string, string]>;
        defaultPackage: string | null;
      }>;
    }
  | {
      kind: "analyze";
      usages: AnalyzedUsage[];
      untrackedUsages: number;
      /** Per-chunk import occurrence counts; the parent sums across chunks
       * and ranks by frequency (single source of ranking truth lives there). */
      untrackedCounts: Array<{ pkg: string; count: number }>;
      errors: AnalysisError[];
    };

export interface WorkerResponse {
  taskId: number;
  ok: boolean;
  payload?: WorkerPayload;
  error?: string;
}

function rebuildMaps(shared: WorkerShared): {
  trackSet: Set<string>;
  filesSet: Set<string>;
  workspaceMap: Map<string, WorkspacePackage>;
  exportsMap: Map<string, ModuleExports>;
  bindingsMap: Map<string, Map<string, string>>;
} {
  const trackSet = new Set(shared.trackPackages);
  const filesSet = new Set(shared.files);
  const workspaceMap = new Map<string, WorkspacePackage>(
    shared.workspacePackages.map((pkg) => [
      pkg.name,
      { entry: pkg.entry, subpaths: new Map(pkg.subpaths) },
    ]),
  );
  const exportsMap = new Map<string, ModuleExports>(
    shared.exportsSnapshot.map((entry) => [
      entry.rel,
      { named: new Map(entry.named), defaultPackage: entry.defaultPackage },
    ]),
  );
  const bindingsMap = new Map<string, Map<string, string>>(
    shared.bindingsSnapshot.map((entry) => [entry.rel, new Map(entry.bindings)]),
  );
  return { trackSet, filesSet, workspaceMap, exportsMap, bindingsMap };
}

function parseChunk(
  files: WorkerChunkFile[],
): Array<{ rel: string; source: string; tree: ts.SourceFile }> {
  return files.map(({ rel, source }) => ({
    rel,
    source,
    tree: ts.createSourceFile(rel, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS),
  }));
}

function handle(request: WorkerRequest): WorkerPayload {
  const { trackSet, filesSet, workspaceMap, exportsMap, bindingsMap } = rebuildMaps(request.shared);
  const resolver = makeRelativeResolver(exportsMap, filesSet, workspaceMap);
  const parsed = parseChunk(request.files);

  if (request.mode === "bindings") {
    return {
      kind: "bindings",
      entries: parsed.map(({ rel, tree }) => {
        const bindings = collectBindings(tree, rel, trackSet, resolver);
        return {
          rel,
          bindings: [...bindings].map(
            ([name, binding]) => [name, binding.packageName] as [string, string],
          ),
        };
      }),
    };
  }

  if (request.mode === "exports") {
    return {
      kind: "exports",
      entries: parsed.map(({ rel, tree }) => {
        const result = collectModuleExports(tree, bindingsMap.get(rel) ?? new Map(), resolver);
        return { rel, named: [...result.named], defaultPackage: result.defaultPackage };
      }),
    };
  }

  const usages: AnalyzedUsage[] = [];
  const errors: AnalysisError[] = [];
  const untrackedCounts = new Map<string, number>();
  let untrackedUsages = 0;
  for (const { rel, source, tree } of parsed) {
    try {
      for (const pkg of collectUntrackedImports(tree)) {
        if (!trackSet.has(pkg) && !workspaceMap.has(pkg)) {
          untrackedCounts.set(pkg, (untrackedCounts.get(pkg) ?? 0) + 1);
        }
      }
      const result = analyzeSource(
        source,
        rel,
        trackSet,
        request.shared.envPrefixes,
        resolver,
        tree,
      );
      usages.push(...result.usages);
      untrackedUsages += result.untrackedUsages;
    } catch (error) {
      errors.push({ filePath: rel, message: String(error) });
    }
  }
  usages.sort(
    (a, b) => a.filePath.localeCompare(b.filePath) || a.line - b.line || a.column - b.column,
  );
  return {
    kind: "analyze",
    usages,
    untrackedUsages,
    untrackedCounts: [...untrackedCounts].map(([pkg, count]) => ({ pkg, count })),
    errors,
  };
}

const port = parentPort;
if (!port) {
  throw new Error("analyze-worker must run inside a worker thread");
}

port.on("message", (request: WorkerRequest) => {
  try {
    const payload = handle(request);
    port.postMessage({ taskId: request.taskId, ok: true, payload } satisfies WorkerResponse);
  } catch (error) {
    port.postMessage({
      taskId: request.taskId,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    } satisfies WorkerResponse);
  }
});
