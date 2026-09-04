import { describe, expect, it } from "vitest";
import {
  generateScimToken,
  hashScimToken,
  scimTokenLookupPrefix,
  verifyScimToken,
} from "./scim-tokens";

describe("scim-tokens", () => {
  it("generates prefixed tokens with a stable lookup prefix", () => {
    const token = generateScimToken();
    expect(token.startsWith("pb_scim_")).toBe(true);
    expect(scimTokenLookupPrefix(token)).toBe(token.slice(0, "pb_scim_".length + 12));
    expect(generateScimToken()).not.toBe(token);
  });

  it("hashes with argon2id and verifies the current hash", async () => {
    const token = generateScimToken();
    const hash = await hashScimToken(token);
    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(await verifyScimToken(token, hash, null)).toBe("current");
    expect(await verifyScimToken("pb_scim_wrong", hash, null)).toBeNull();
  });

  it("falls back to the previous-rotation hash", async () => {
    const current = generateScimToken();
    const previous = generateScimToken();
    const currentHash = await hashScimToken(current);
    const previousHash = await hashScimToken(previous);
    expect(await verifyScimToken(previous, currentHash, previousHash)).toBe("previous");
    expect(await verifyScimToken(current, currentHash, previousHash)).toBe("current");
  });

  it("rejects non-argon2id stored hashes", async () => {
    const token = generateScimToken();
    expect(await verifyScimToken(token, "deadbeef", null)).toBeNull();
    expect(await verifyScimToken(token, null, null)).toBeNull();
  });
});
