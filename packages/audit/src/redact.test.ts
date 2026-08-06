import { describe, expect, it } from "vitest";
import { isSensitiveKey, redactSecrets, sanitizeText } from "./redact";

describe("redactSecrets", () => {
  it("redacts values under sensitive keys", () => {
    const out = redactSecrets({ apiKey: "sk-live-123", config: { token: "abc" }, name: "billing" });
    expect(out).toEqual({ apiKey: "[REDACTED]", config: { token: "[REDACTED]" }, name: "billing" });
  });

  it("redacts credential patterns inside arbitrary strings", () => {
    const out = redactSecrets({
      url: "https://x?token=sk-test-abcdefghijklmnopq",
      cmd: "run",
    }) as Record<string, unknown>;
    expect(String(out.url)).not.toContain("sk-test");
    expect(String(out.url)).toContain("[REDACTED]");
  });

  it("keeps benign structure intact", () => {
    const out = redactSecrets({
      list: [1, "two", { three: "three" }],
      nested: { a: { b: { c: "plain" } } },
    });
    expect(out).toEqual({
      list: [1, "two", { three: "three" }],
      nested: { a: { b: { c: "plain" } } },
    });
  });

  it("handles null, arrays of objects, and primitives", () => {
    expect(redactSecrets(null)).toBe(null);
    expect(redactSecrets(42)).toBe(42);
    expect(redactSecrets([{ password: "x" }, { note: "ok" }])).toEqual([
      { password: "[REDACTED]" },
      { note: "ok" },
    ]);
  });

  it("never leaves raw JWT-like material", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    const out = sanitizeText(`header ${jwt} footer`);
    expect(out).not.toContain("SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c");
  });

  it("redacts bearer tokens and private key blocks", () => {
    const text =
      "Authorization: Bearer abc123.def456.ghi789 and BEGIN PRIVATE KEY-----material-----";
    const out = sanitizeText(text);
    expect(out).not.toContain("abc123.def456.ghi789");
    expect(out).toContain("[REDACTED]");
  });
});

describe("isSensitiveKey", () => {
  it("matches common secret key names", () => {
    for (const key of [
      "password",
      "apiKey",
      "API_KEY",
      "authHeader",
      "webhookSecret",
      "private_key",
      "accessToken",
      "Bearer",
    ]) {
      expect(isSensitiveKey(key), key).toBe(true);
    }
  });

  it("ignores benign keys", () => {
    for (const key of ["title", "filePath", "diff", "line", "email"]) {
      expect(isSensitiveKey(key), key).toBe(false);
    }
  });
});
