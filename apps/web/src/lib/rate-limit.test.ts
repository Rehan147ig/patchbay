import { describe, expect, it } from "vitest";
import { checkRateLimit } from "./rate-limit";

describe("rate-limit", () => {
  it("allows requests under the threshold", () => {
    for (let i = 0; i < 10; i++) {
      const result = checkRateLimit("key-ok");
      expect(result.allowed).toBe(true);
      expect(result.retryAfterMs).toBe(0);
    }
  });

  it("blocks requests over the threshold per key", () => {
    for (let i = 0; i < 10; i++) checkRateLimit("key-block");
    const blocked = checkRateLimit("key-block");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
    // A different key is unaffected.
    expect(checkRateLimit("key-other").allowed).toBe(true);
  });
});
