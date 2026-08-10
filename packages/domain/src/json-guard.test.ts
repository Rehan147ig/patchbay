import { describe, expect, it } from "vitest";
import {
  MAX_RAW_PAYLOAD_BYTES,
  MAX_STRING_CHARS,
  boundJsonBytes,
  boundJsonDepth,
  boundRawPayload,
} from "./json-guard";

describe("boundJsonDepth", () => {
  it("passes shallow JSON through unchanged", () => {
    const input = { a: 1, b: "two", c: [true, null, { d: "e" }] };
    expect(boundJsonDepth(input)).toEqual(input);
  });

  it("caps nesting depth with a marker", () => {
    const deep = { a: { b: { c: { d: { e: { f: { g: { h: { i: "bottom" } } } } } } } } };
    const bounded = boundJsonDepth(deep, 4) as Record<
      string,
      Record<string, Record<string, Record<string, unknown>>>
    >;
    expect(bounded.a?.b?.c?.d).toBe("<depth limit exceeded>");
  });

  it("caps arrays at the same depth budget", () => {
    const deep = [[[[[["bottom"]]]]]];
    const bounded = boundJsonDepth(deep, 1);
    expect(bounded).toEqual(["<depth limit exceeded>"]);
  });

  it("keeps the result depth bounded by the budget plus one", () => {
    const deep = { a: { b: { c: { d: { e: "x" } } } } };
    const bounded = boundJsonDepth(deep, 3);
    const nesting = Math.max(
      JSON.stringify(bounded).split("[").length - 1,
      JSON.stringify(bounded).split("{").length - 1,
    );
    expect(nesting).toBeLessThanOrEqual(4);
  });

  it("truncates oversized strings", () => {
    const value = { s: "x".repeat(MAX_STRING_CHARS + 500) };
    const bounded = boundJsonDepth(value);
    const s = (bounded as { s: string }).s;
    expect(s.length).toBeLessThanOrEqual(MAX_STRING_CHARS + "[...[truncated]".length);
    expect(s.endsWith("...[truncated]")).toBe(true);
  });

  it("drops non-JSON values (undefined, NaN, functions)", () => {
    const value = { a: undefined, b: Number.NaN, c: () => 1, d: 42 };
    expect(boundJsonDepth(value)).toEqual({ d: 42 });
  });

  it("keeps scalars and null", () => {
    expect(boundJsonDepth(null)).toBeNull();
    expect(boundJsonDepth("plain")).toBe("plain");
    expect(boundJsonDepth(3.14)).toBe(3.14);
    expect(boundJsonDepth(true)).toBe(true);
  });

  it("is JSON-serializable for any input", () => {
    const value = { a: { b: [{ c: [1, 2, { d: undefined }] }] } };
    expect(() => JSON.stringify(boundJsonDepth(value))).not.toThrow();
  });
});

describe("boundJsonBytes", () => {
  it("leaves small payloads untouched", () => {
    const value = { ok: true, n: 7 };
    expect(boundJsonBytes(value, 10_000)).toEqual(value);
  });

  it("truncates the longest string until the payload fits", () => {
    const big = "y".repeat(200_000);
    const value = { first: "short", second: big };
    const bounded = boundJsonBytes(value, 4_096);
    const serialized = JSON.stringify(bounded);
    expect(serialized.length).toBeLessThanOrEqual(4_096);
    expect((bounded as { first: string }).first).toBe("short");
  });

  it("falls back to a marker when the cap cannot be met by shrinking", () => {
    const bounded = boundJsonBytes({ blob: "z".repeat(10_000) }, 32);
    expect((bounded as { __patchbay_trimmed__: string }).__patchbay_trimmed__).toBe(
      "payload exceeds size limit",
    );
  });

  it("still serializes after capping", () => {
    const value = { a: { b: ["c".repeat(300_000)] }, d: { e: ["f".repeat(300_000)] } };
    expect(() => JSON.stringify(boundJsonBytes(value, 16_384))).not.toThrow();
  });
});

describe("boundRawPayload", () => {
  it("returns a JSON-safe value for nested input", () => {
    const input = {
      sdk: "openai",
      latestVersion: "4.100.0",
      packages: [{ name: "openai", notes: "deep ".repeat(20) }],
    };
    const bounded = boundRawPayload(input);
    expect(() => JSON.parse(JSON.stringify(bounded))).not.toThrow();
    expect((bounded as { sdk: string }).sdk).toBe("openai");
  });

  it("caps extreme depth without throwing", () => {
    let value: unknown = "bottom";
    for (let i = 0; i < 2_000; i++) value = { wrapper: value };
    expect(() => boundRawPayload(value)).not.toThrow();
    const bounded = boundRawPayload(value);
    expect(JSON.stringify(bounded).length).toBeLessThan(MAX_RAW_PAYLOAD_BYTES);
  });

  it("caps serialized size to the byte limit", () => {
    const input = { blob: "x".repeat(MAX_RAW_PAYLOAD_BYTES + 50_000) };
    const bounded = boundRawPayload(input);
    expect(JSON.stringify(bounded).length).toBeLessThanOrEqual(MAX_RAW_PAYLOAD_BYTES);
  });

  it("returns null for null input", () => {
    expect(boundRawPayload(null)).toBeNull();
  });
});
