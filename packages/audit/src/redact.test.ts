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

  it("redacts basic auth, stripe live keys, google api keys, and npm tokens", () => {
    const text =
      "Basic dXNlcjpwYXNzMTIzNA== sk_live_51Habc123def456ghi jwtauth ya29.abcdefghijklmnopqrstuvwxyz " +
      "AIzaSyD-dGIVEVW4P9c6kIkOdH8jxM0x1FbRCA npm_AbCdEfGhIjKlMnOpQrStUvWxYz1234567 whsec_9f8a7b6c5d4e3f2a";
    const out = sanitizeText(text);
    expect(out).not.toContain("dXNlcjpwYXNzMTIzNA==");
    expect(out).not.toContain("sk_live_51Habc123def456ghi");
    expect(out).not.toContain("ya29.abcdefghijklmnopqrstuvwxyz");
    expect(out).not.toContain("AIzaSyD-dGIVEVW4P9c6kIkOdH8jxM0x1FbRCA");
    expect(out).not.toContain("npm_AbCdEfGhIjKlMnOpQrStUvWxYz1234567");
    expect(out).not.toContain("whsec_9f8a7b6c5d4e3f2a");
    expect(out).toContain("[REDACTED]");
  });

  it("completes quickly on adversarial free text (ReDoS guard)", () => {
    const adversarial = `sk-${"a".repeat(500_000)} -----BEGIN ${"A".repeat(200_000)} ${"Bearer ".repeat(10_000)}`;
    const started = performance.now();
    const out = sanitizeText(adversarial);
    const elapsed = performance.now() - started;
    expect(typeof out).toBe("string");
    expect(elapsed).toBeLessThan(2_000);
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
      "jwtToken",
      "sessionId",
      "sid",
      "clientSecret",
      "otpCode",
      "verificationCode",
    ]) {
      expect(isSensitiveKey(key), key).toBe(true);
    }
  });

  it("ignores benign keys", () => {
    for (const key of [
      "title",
      "filePath",
      "diff",
      "line",
      "email",
      "userId",
      "side",
      "top",
      "opt",
    ]) {
      expect(isSensitiveKey(key), key).toBe(false);
    }
  });
});
