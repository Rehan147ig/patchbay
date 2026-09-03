import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";
import type {
  WorkerChunkFile,
  WorkerMode,
  WorkerPayload,
  WorkerRequest,
  WorkerResponse,
  WorkerShared,
} from "./analyze-worker";

/**
 * Worker-thread pool for per-file analysis passes.
 *
 * The 3 binding/export passes stay sequential (fixed-point convergence), but
 * files within a pass run across threads. Results merge in chunk order, so
 * output is deterministic regardless of thread scheduling.
 *
 * Gating: parallel only when the file count reaches the threshold (default
 * 200) unless `REPO_ANALYSIS_PARALLEL=1` forces it on or `=0` forces it off.
 * Any spawn or task failure falls back to the serial path — a scan must never
 * fail because threads are unavailable (vitest pools, constrained hosts).
 */

export interface ParallelConfig {
  /** Force on ("1"), force off ("0"), or auto ("" / unset). */
  force?: string;
  /** Minimum files before threads are worth the spawn cost. */
  minFiles?: number;
  /** Max worker threads per dispatch. */
  maxWorkers?: number;
  /** Per-dispatch timeout before falling back to serial. */
  taskTimeoutMs?: number;
}

export interface ParallelStats {
  usedWorkers: boolean;
  workerCount: number;
  chunks: number;
}

let lastStats: ParallelStats | null = null;

/** Observability for tests/benchmarks: did the last dispatch use threads? */
export function getLastParallelStats(): ParallelStats | null {
  return lastStats;
}

export function resolveParallelConfig(
  env: NodeJS.ProcessEnv = process.env,
): Required<ParallelConfig> {
  const cpus = (() => {
    try {
      return availableParallelism();
    } catch {
      return 2;
    }
  })();
  const minFiles = Number(env.REPO_ANALYSIS_MIN_FILES ?? "200");
  return {
    force: env.REPO_ANALYSIS_PARALLEL ?? "",
    minFiles: Number.isFinite(minFiles) && minFiles > 0 ? minFiles : 200,
    maxWorkers: Math.max(1, Math.min(8, cpus)),
    taskTimeoutMs: 180_000,
  };
}

export function shouldParallelize(
  fileCount: number,
  config: Required<ParallelConfig> = resolveParallelConfig(),
): boolean {
  if (config.force === "0") return false;
  if (config.force === "1") return fileCount > 0;
  return fileCount >= config.minFiles;
}

export function splitChunks<T>(items: T[], count: number): T[][] {
  if (items.length === 0) return [];
  if (count <= 1 || items.length <= count) return [items];
  const size = Math.ceil(items.length / count);
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

interface PendingTask {
  resolve: (payload: WorkerPayload) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface DispatchPhaseOptions {
  /** Called with the taskId each time a chunk result arrives (arrival order). */
  onChunkDone?: (taskId: number) => void;
}

/**
 * Dispatches one phase (bindings/exports/analyze) across a disposable pool.
 * Resolves payloads in chunk order. Rejects on any task failure or timeout so
 * the caller can fall back to the serial implementation.
 */
export async function dispatchPhase(
  mode: WorkerMode,
  chunks: WorkerChunkFile[][],
  shared: WorkerShared,
  config: Required<ParallelConfig> = resolveParallelConfig(),
  options: DispatchPhaseOptions = {},
): Promise<WorkerPayload[]> {
  if (chunks.length === 0) {
    lastStats = { usedWorkers: false, workerCount: 0, chunks: 0 };
    return [];
  }
  const workerCount = Math.min(config.maxWorkers, chunks.length);
  const entry = new URL("./analyze-worker.ts", import.meta.url);
  const workers: Worker[] = [];
  try {
    for (let i = 0; i < workerCount; i += 1) {
      workers.push(new Worker(entry));
    }
  } catch (error) {
    throw new Error(
      `worker spawn failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const results: WorkerPayload[] = new Array(chunks.length);
  let nextChunk = workerCount;
  let failed: Error | null = null;

  const terminate = async (): Promise<void> => {
    await Promise.all(workers.map(async (worker) => worker.terminate()));
  };

  try {
    await new Promise<void>((resolveAll, rejectAll) => {
      const pending = new Map<number, PendingTask>();
      let completed = 0;

      const assign = (worker: Worker): void => {
        if (failed) return;
        if (nextChunk >= chunks.length) {
          if (completed === chunks.length) resolveAll();
          return;
        }
        const taskId = nextChunk;
        nextChunk += 1;
        const timer = setTimeout(() => {
          pending.delete(taskId);
          failed = new Error(`worker task ${taskId} timed out`);
          rejectAll(failed);
        }, config.taskTimeoutMs);
        pending.set(taskId, {
          resolve: (payload) => {
            clearTimeout(timer);
            pending.delete(taskId);
            results[taskId] = payload;
            completed += 1;
            try {
              options.onChunkDone?.(taskId);
            } catch {
              // Progress must never fail a dispatch.
            }
            assign(worker);
          },
          reject: (error) => {
            clearTimeout(timer);
            pending.delete(taskId);
            if (!failed) {
              failed = error;
              rejectAll(error);
            }
          },
          timer,
        });
        const request: WorkerRequest = {
          taskId,
          mode,
          files: chunks[taskId]!,
          shared,
        };
        worker.postMessage(request);
      };

      for (const worker of workers) {
        worker.on("message", (response: WorkerResponse) => {
          const task = pending.get(response.taskId);
          if (!task) return;
          if (response.ok && response.payload) {
            task.resolve(response.payload);
          } else {
            task.reject(new Error(response.error ?? `worker task ${response.taskId} failed`));
          }
        });
        worker.on("error", (error: Error) => {
          if (!failed) {
            failed = error;
            rejectAll(error);
          }
        });
        worker.on("exit", (code: number) => {
          if (code !== 0 && !failed && completed < chunks.length) {
            failed = new Error(`worker exited with code ${code}`);
            rejectAll(failed);
          }
        });
        assign(worker);
      }
      if (chunks.length === 0) resolveAll();
    });
  } finally {
    await terminate();
  }

  if (failed) throw failed;
  lastStats = { usedWorkers: true, workerCount, chunks: chunks.length };
  return results;
}
