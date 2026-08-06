import { describe, expect, it } from "vitest";
import { generateAgentKey, hashAgentKey, verifyAgentKey } from "./agent-keys";

describe("agent-keys", () => {
  it("generates a prefixed, unique key", () => {
    const key = generateAgentKey();
    expect(key.startsWith("pb_agent_")).toBe(true);
    expect(key).not.toBe(generateAgentKey());
  });

  it("hashes and verifies keys in constant time", () => {
    const key = generateAgentKey();
    const hash = hashAgentKey(key);
    expect(hash).not.toContain(key);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyAgentKey(key, hash)).toBe(true);
    expect(verifyAgentKey("wrong-key", hash)).toBe(false);
    expect(verifyAgentKey(key, hashAgentKey("another-key"))).toBe(false);
  });
});
