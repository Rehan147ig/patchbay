import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkGlobalRateLimit,
  checkRateLimit,
  checkRateLimitMemory,
  GLOBAL_MAX_REQUESTS,
} from "./rate-limit";

describe("rate-limit (in-memory fallback)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows requests under the threshold", async () => {
    for (let i = 0; i < 10; i++) {
      const result = await checkRateLimit("key-ok");
      expect(result.allowed).toBe(true);
      expect(result.retryAfterMs).toBe(0);
    }
  });

  it("blocks requests over the threshold per key", async () => {
    for (let i = 0; i < 10; i++) await checkRateLimit("key-block");
    const blocked = await checkRateLimit("key-block");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
    // A different key is unaffected.
    expect((await checkRateLimit("key-other")).allowed).toBe(true);
  });

  it("respects a custom limit and window", async () => {
    const result = await checkRateLimit("key-custom", { limit: 2, windowMs: 5_000 });
    expect(result.allowed).toBe(true);
    const second = await checkRateLimit("key-custom", { limit: 2, windowMs: 5_000 });
    expect(second.allowed).toBe(true);
    const third = await checkRateLimit("key-custom", { limit: 2, windowMs: 5_000 });
    expect(third.allowed).toBe(false);
  });

  it("blocks, then lets the window expire", () => {
    expect(checkRateLimitMemory("key-expire", 1, 10_000).allowed).toBe(true);
    expect(checkRateLimitMemory("key-expire", 1, 10_000).allowed).toBe(false);
    vi.setSystemTime(11_001);
    expect(checkRateLimitMemory("key-expire", 1, 10_000).allowed).toBe(true);
  });
});

describe("global bucket", () => {
  it("caps total requests across all keys", async () => {
    for (let i = 0; i < GLOBAL_MAX_REQUESTS; i++) {
      const result = await checkGlobalRateLimit();
      expect(result.allowed).toBe(true);
    }
    const blocked = await checkGlobalRateLimit();
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });
});
