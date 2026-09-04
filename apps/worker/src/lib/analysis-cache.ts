import { createHash } from "node:crypto";
import { logger } from "@patchbay/domain";
import type { RepositoryAnalysis } from "@patchbay/repo-analysis";

/**
 * Cross-job analysis cache (scan -> graph-index handoff).
 *
 * The scan job serializes its RepositoryAnalysis under a key derived from the
 * snapshot commit SHA + sorted track packages; the graph-index job reads it
 * back and passes it to extractGraph, skipping the duplicate analysis pass
 * (~35s on 7k files). Key properties:
 * - Shared Redis (not job payloads: analyses are MB-scale, BullMQ caps at
 *   256KB; not disk: web/worker containers share no volume).
 * - Fail-open everywhere: misses, corrupt entries, oversize payloads, and
 *   Redis outages all fall back to cold extraction. The cache never fails a job.
 * - Snapshot-pinned: the key binds the exact commit SHA, so a newer push
 *   between scan and graph-index misses the cache instead of mixing snapshots.
 */

export const ANALYSIS_CACHE_TTL_SECONDS = 3600;
/** Analyses larger than this are not cached (unbounded growth guard). */
export const ANALYSIS_CACHE_MAX_BYTES = 8 * 1024 * 1024;

export interface AnalysisCacheClient {
  setex(key: string, ttlSeconds: number, value: string): Promise<unknown>;
  get(key: string): Promise<string | null>;
}

export function analysisCacheKey(commitSha: string, trackPackages: string[]): string {
  const trackHash = createHash("sha256")
    .update([...trackPackages].sort().join(","))
    .digest("hex")
    .slice(0, 16);
  return `patchbay:analysis:${commitSha}:${trackHash}`;
}

function isRepositoryAnalysis(value: unknown): value is RepositoryAnalysis {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    Array.isArray(record.usages) &&
    typeof record.commitSha === "string" &&
    Array.isArray(record.manifests) &&
    typeof record.filesScanned === "number"
  );
}

/** Best-effort write; returns false (never throws) when caching is skipped. */
export async function writeAnalysisCache(
  client: AnalysisCacheClient,
  commitSha: string,
  trackPackages: string[],
  analysis: RepositoryAnalysis,
): Promise<boolean> {
  try {
    const payload = JSON.stringify(analysis);
    if (Buffer.byteLength(payload, "utf8") > ANALYSIS_CACHE_MAX_BYTES) {
      logger.info("analysis cache skipped (oversize)", {
        commitSha,
        bytes: Buffer.byteLength(payload, "utf8"),
      });
      return false;
    }
    await client.setex(
      analysisCacheKey(commitSha, trackPackages),
      ANALYSIS_CACHE_TTL_SECONDS,
      payload,
    );
    return true;
  } catch (error) {
    logger.warn("analysis cache write failed", { commitSha, error: String(error) });
    return false;
  }
}

/** Best-effort read; returns null (never throws) on miss or corruption. */
export async function readAnalysisCache(
  client: AnalysisCacheClient,
  commitSha: string,
  trackPackages: string[],
): Promise<RepositoryAnalysis | null> {
  try {
    const payload = await client.get(analysisCacheKey(commitSha, trackPackages));
    if (!payload) return null;
    const parsed: unknown = JSON.parse(payload);
    if (!isRepositoryAnalysis(parsed)) {
      logger.warn("analysis cache entry failed validation", { commitSha });
      return null;
    }
    return parsed;
  } catch (error) {
    logger.warn("analysis cache read failed", { commitSha, error: String(error) });
    return null;
  }
}
