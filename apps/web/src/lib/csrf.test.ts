import { describe, expect, it } from "vitest";
import { assertCsrfToken } from "./csrf-server";
import { createCsrfToken, timingSafeEqual } from "./csrf";

function requestWith(
  cookie: string | undefined,
  header: string | null,
): Parameters<typeof assertCsrfToken>[0] {
  return {
    headers: {
      get: (name: string) => {
        if (name === "x-csrf-token") return header;
        if (name === "cookie" && cookie !== undefined) return `pb_csrf=${cookie}`;
        return null;
      },
    },
  } as never;
}

describe("createCsrfToken / timingSafeEqual", () => {
  it("issues a unique token", () => {
    expect(createCsrfToken().length).toBeGreaterThan(16);
    expect(createCsrfToken()).not.toBe(createCsrfToken());
  });

  it("compares in constant-time semantics", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
    expect(timingSafeEqual("", "")).toBe(true);
  });
});

describe("assertCsrfToken", () => {
  it("accepts a matching cookie and header", () => {
    expect(() => assertCsrfToken(requestWith("tok-1", "tok-1"))).not.toThrow();
  });

  it("rejects a missing header", () => {
    expect(() => assertCsrfToken(requestWith("tok-1", null))).toThrowError(/CSRF/);
  });

  it("rejects a missing cookie", () => {
    expect(() => assertCsrfToken(requestWith(undefined, "tok-1"))).toThrowError(/CSRF/);
  });

  it("rejects a mismatched pair", () => {
    expect(() => assertCsrfToken(requestWith("tok-1", "tok-2"))).toThrowError(/CSRF/);
  });
});
