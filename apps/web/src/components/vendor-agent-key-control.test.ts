import { describe, expect, it } from "vitest";
import { parseAgentKeyIssue } from "./vendor-agent-key-control";

describe("parseAgentKeyIssue", () => {
  it("parses a well-formed issue response", () => {
    expect(
      parseAgentKeyIssue({
        data: {
          vendorSlug: "openai",
          agentKey: "pb_agent_abc123",
          note: "Store this key now; it will never be shown again.",
        },
      }),
    ).toEqual({
      agentKey: "pb_agent_abc123",
      note: "Store this key now; it will never be shown again.",
    });
  });

  it("rejects responses without a pb_agent_ key", () => {
    expect(parseAgentKeyIssue({ data: { agentKey: "not-a-key" } })).toBeNull();
    expect(parseAgentKeyIssue({ data: {} })).toBeNull();
    expect(parseAgentKeyIssue({})).toBeNull();
    expect(parseAgentKeyIssue(null)).toBeNull();
  });

  it("tolerates a missing note", () => {
    expect(parseAgentKeyIssue({ data: { agentKey: "pb_agent_x" } })).toEqual({
      agentKey: "pb_agent_x",
      note: "",
    });
  });
});
