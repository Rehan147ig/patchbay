import { describe, expect, it } from "vitest";
import { MAX_JOB_PAYLOAD_BYTES, assertJobPayloadSize, parseRedisUrl, redactRedisUrl } from "./url";

describe("parseRedisUrl", () => {
  it("accepts redis:// with defaults", () => {
    expect(parseRedisUrl("redis://127.0.0.1:6379")).toEqual({
      scheme: "redis",
      host: "127.0.0.1",
      port: 6379,
      hasPassword: false,
    });
  });

  it("accepts rediss:// (TLS) connections", () => {
    expect(parseRedisUrl("rediss://cache.example.com:6380").scheme).toBe("rediss");
  });

  it("defaults the port when omitted", () => {
    expect(parseRedisUrl("redis://cache.example.com")).toEqual({
      scheme: "redis",
      host: "cache.example.com",
      port: 6379,
      hasPassword: false,
    });
  });

  it("detects passwords", () => {
    expect(parseRedisUrl("redis://:s3cret@cache.example.com:6379").hasPassword).toBe(true);
  });

  it("rejects non-redis schemes", () => {
    expect(() => parseRedisUrl("http://cache.example.com")).toThrow(
      "REDIS_URL must use redis:// or rediss://",
    );
  });

  it("rejects unparseable URLs", () => {
    expect(() => parseRedisUrl("not a url at all")).toThrow("REDIS_URL is not a valid URL");
  });

  it("rejects bad ports", () => {
    expect(() => parseRedisUrl("redis://host:0")).toThrow("invalid port");
    expect(() => parseRedisUrl("redis://host:99999")).toThrow("not a valid URL");
    expect(() => parseRedisUrl("redis://host:abc")).toThrow("not a valid URL");
  });

  it("rejects oversized connection strings", () => {
    expect(() => parseRedisUrl(`redis://host/${"x".repeat(600)}`)).toThrow("exceeds");
  });
});

describe("redactRedisUrl", () => {
  it("masks the password", () => {
    const redacted = redactRedisUrl("redis://:super-secret@cache.example.com:6379");
    expect(redacted).not.toContain("super-secret");
    expect(redacted).toContain("[REDACTED]");
  });

  it("leaves passwordless URLs unchanged", () => {
    expect(redactRedisUrl("redis://127.0.0.1:6379")).toBe("redis://127.0.0.1:6379");
  });

  it("never throws on garbage", () => {
    expect(redactRedisUrl("!!!")).toBe("[invalid redis url]");
  });
});

describe("assertJobPayloadSize", () => {
  it("accepts small payloads", () => {
    expect(() => assertJobPayloadSize({ changeEventId: "c-1" })).not.toThrow();
  });

  it("rejects oversized payloads with a clear error", () => {
    expect(() => assertJobPayloadSize({ blob: "x".repeat(MAX_JOB_PAYLOAD_BYTES + 1) })).toThrow(
      "exceeds the 262144 byte limit",
    );
  });

  it("rejects non-serializable payloads", () => {
    const circular: { self?: unknown } = {};
    circular.self = circular;
    expect(() => assertJobPayloadSize(circular)).toThrow("not JSON-serializable");
  });
});
