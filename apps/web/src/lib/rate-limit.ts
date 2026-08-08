/**
 * Minimal in-memory fixed-window rate limiter for login brute-force
 * protection. Single-process (Next.js dev/local MVP) only; a shared
 * Redis-backed limiter replaces this when auth goes multi-instance.
 */

const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 10;

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

export function checkRateLimit(key: string): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();
  const existing = windows.get(key);
  if (!existing || existing.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, retryAfterMs: 0 };
  }
  existing.count += 1;
  if (existing.count > MAX_ATTEMPTS) {
    return { allowed: false, retryAfterMs: existing.resetAt - now };
  }
  return { allowed: true, retryAfterMs: 0 };
}
