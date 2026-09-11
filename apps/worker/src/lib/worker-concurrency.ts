import { logger } from "@patchbay/domain";

/**
 * Fleet scaling knob: BullMQ worker concurrency (parallel in-flight jobs).
 *
 * Single-worker vertical scaling for pilot-to-fleet growth: raise
 * WORKER_CONCURRENCY toward CPU/container limits for validation-heavy
 * bursts, lower it on constrained hosts. Horizontal scaling needs no code
 * change either — extra worker processes compete safely on the same queue
 * (org/global Lua admission keeps fairness; heartbeats already key per
 * worker id). Invalid values fail closed to the default with a warning,
 * never to unbounded or zero concurrency.
 */
export const DEFAULT_WORKER_CONCURRENCY = 4;
export const MAX_WORKER_CONCURRENCY = 64;

export function resolveWorkerConcurrency(env: Record<string, string | undefined>): number {
  const raw = (env.WORKER_CONCURRENCY ?? "").trim();
  if (raw === "") return DEFAULT_WORKER_CONCURRENCY;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_WORKER_CONCURRENCY) {
    logger.warn("invalid WORKER_CONCURRENCY; using default", {
      raw,
      default: DEFAULT_WORKER_CONCURRENCY,
    });
    return DEFAULT_WORKER_CONCURRENCY;
  }
  return parsed;
}
