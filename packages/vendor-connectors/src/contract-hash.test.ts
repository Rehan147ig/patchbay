import { describe, expect, it } from "vitest";
import { canonicalJson, sha256Hex } from "./contract-hash";

describe("canonicalJson", () => {
  it("is invariant to object key order at any depth", () => {
    const a = { version: "4.8.1", meta: { url: "x", tags: ["a"] }, count: 3 };
    const b = { count: 3, meta: { tags: ["a"], url: "x" }, version: "4.8.1" };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  it("treats array order as significant (reordered contracts differ)", () => {
    expect(canonicalJson({ params: ["a", "b"] })).not.toBe(canonicalJson({ params: ["b", "a"] }));
  });

  it("handles nesting, unicode, empty objects, and null deterministically", () => {
    expect(canonicalJson({})).toBe("{}");
    expect(canonicalJson({ emoji: "🔌", nested: { list: [1, null, "x"] } })).toBe(
      '{"emoji":"🔌","nested":{"list":[1,null,"x"]}}',
    );
    expect(canonicalJson({ a: 1 })).toBe(canonicalJson({ a: 1 }));
  });

  it("fails closed on ambiguous values instead of hashing silently-dropped forms", () => {
    expect(() => canonicalJson(undefined)).toThrow();
    expect(() => canonicalJson({ fn: () => 1 })).toThrow();
    expect(() => canonicalJson({ big: 10n })).toThrow();
  });
});

describe("sha256Hex", () => {
  it("produces stable 64-hex digests and separates distinct inputs", () => {
    expect(sha256Hex("patchbay")).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex("patchbay")).toBe(sha256Hex("patchbay"));
    expect(sha256Hex("patchbay")).not.toBe(sha256Hex("patchbaY"));
    expect(sha256Hex("")).not.toBe(sha256Hex(" "));
  });
});
