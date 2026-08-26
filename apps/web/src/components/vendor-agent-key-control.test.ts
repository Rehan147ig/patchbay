import { describe, expect, it } from "vitest";
import { parseAgentKeyIssue, parseAgentKeyRevoke } from "./vendor-agent-key-control";

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

describe("parseAgentKeyRevoke", () => {
  it("parses both revoke outcomes", () => {
    expect(parseAgentKeyRevoke({ data: { vendorSlug: "openai", status: "REVOKED" } })).toEqual({
      vendorSlug: "openai",
      status: "REVOKED",
    });
    expect(
      parseAgentKeyRevoke({ data: { vendorSlug: "openai", status: "ALREADY_DISABLED" } }),
    ).toEqual({ vendorSlug: "openai", status: "ALREADY_DISABLED" });
  });

  it("rejects malformed responses", () => {
    expect(parseAgentKeyRevoke({ data: { vendorSlug: "openai", status: "EXPLODED" } })).toBeNull();
    expect(parseAgentKeyRevoke({ data: { status: "REVOKED" } })).toBeNull();
    expect(parseAgentKeyRevoke({ data: {} })).toBeNull();
    expect(parseAgentKeyRevoke(null)).toBeNull();
  });
});
