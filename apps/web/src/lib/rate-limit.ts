import { logger } from "@patchbay/domain";
import { checkRateLimitRedis } from "@patchbay/queue";

/**
 * Fixed-window rate limiter shared across all web instances. When REDIS_URL
 * is configured the counter lives in Redis (atomic INCR, global); otherwise
 * a per-process in-memory map is used (single-process dev/local). Redis
 * failures fail open to the in-memory fallback: availability first, the
 * counter still exists, just not shared.
 */

export const DEFAULT_WINDOW_MS = 60_000;
export const DEFAULT_MAX_REQUESTS = 10;
export const GLOBAL_WINDOW_MS = 60_000;
export const GLOBAL_MAX_REQUESTS = 600;

const REDIS_ENABLED = process.env.REDIS_URL !== undefined && process.env.REDIS_URL.trim() !== "";

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

export interface RateLimitOptions {
  limit?: number;
  windowMs?: number;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs: number;
}

export function checkRateLimitMemory(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  const existing = windows.get(key);
  if (!existing || existing.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterMs: 0 };
  }
  existing.count += 1;
  if (existing.count > limit) {
    return { allowed: false, retryAfterMs: existing.resetAt - now };
  }
  return { allowed: true, retryAfterMs: 0 };
}

export async function checkRateLimit(
  key: string,
  options: RateLimitOptions = {},
): Promise<RateLimitResult> {
  const limit = options.limit ?? DEFAULT_MAX_REQUESTS;
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  if (REDIS_ENABLED) {
    try {
      return await checkRateLimitRedis(key, limit, windowMs);
    } catch (error) {
      logger.warn("redis rate limiter unavailable; using in-memory fallback", {
        error: String(error),
      });
    }
  }
  return checkRateLimitMemory(key, limit, windowMs);
}

/**
 * Whole-instance burst cap, applied before per-key checks on public
 * endpoints (login, agent ingest). "unknown"-ish clients that cannot be
 * fingerprinted still share this bucket, so spoofed headers cannot bypass
 * the global ceiling.
 */
export function checkGlobalRateLimit(): Promise<RateLimitResult> {
  return checkRateLimit("global", { limit: GLOBAL_MAX_REQUESTS, windowMs: GLOBAL_WINDOW_MS });
}
