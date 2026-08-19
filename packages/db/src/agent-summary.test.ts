import { describe, expect, it } from "vitest";
import { agentBodySection, agentStepSummary, agentVerdictFromRun } from "./agent-summary";

describe("agentStepSummary", () => {
  it("summarizes tool-call steps by tool name", () => {
    expect(
      agentStepSummary({
        role: "ANALYST",
        kind: "TOOL_CALL",
        status: "COMPLETED",
        toolName: "getReleaseFacts",
      }),
    ).toBe("Analyzed release facts");
    expect(
      agentStepSummary({
        role: "ANALYST",
        kind: "TOOL_CALL",
        status: "COMPLETED",
        toolName: "getAffectedUsageSubgraph",
      }),
    ).toBe("Mapped affected usages");
  });

  it("summarizes planner and reviewer model-call steps", () => {
    expect(
      agentStepSummary({
        role: "PLANNER",
        kind: "MODEL_CALL",
        status: "COMPLETED",
        toolName: null,
      }),
    ).toBe("Proposed a remediation plan");
    expect(
      agentStepSummary({
        role: "REVIEWER",
        kind: "MODEL_CALL",
        status: "COMPLETED",
        toolName: null,
      }),
    ).toBe("Independently reviewed the plan");
  });

  it("falls back for unknown shapes", () => {
    expect(
      agentStepSummary({ role: "ANALYST", kind: "TOOL_CALL", status: "FAILED", toolName: "other" }),
    ).toBe("Ran other");
    expect(
      agentStepSummary({ role: "ANALYST", kind: "WORKFLOW", status: "STARTED", toolName: null }),
    ).toBe("Analyzed evidence");
  });
});

describe("agentVerdictFromRun", () => {
  it("extracts planner edit count and reviewer verdict", () => {
    const verdict = agentVerdictFromRun({
      plan: { edits: [{}, {}, {}] },
      review: { approved: true, confidence: 92, summary: "Clean migration" },
    });
    expect(verdict).toEqual({
      editCount: 3,
      approved: true,
      confidence: 92,
      reviewSummary: "Clean migration",
    });
  });

  it("returns null when there is neither a plan nor a review", () => {
    expect(agentVerdictFromRun(null)).toBeNull();
    expect(agentVerdictFromRun({ workflow: {} })).toBeNull();
    expect(agentVerdictFromRun({ plan: null, review: null })).toBeNull();
  });

  it("omits a blank review summary", () => {
    const verdict = agentVerdictFromRun({
      plan: { edits: [] },
      review: { approved: false, confidence: 40, summary: "   " },
    });
    expect(verdict).toEqual({
      editCount: 0,
      approved: false,
      confidence: 40,
      reviewSummary: null,
    });
  });
});

describe("agentBodySection", () => {
  it("renders a markdown block with planner and reviewer lines", () => {
    const section = agentBodySection({
      editCount: 5,
      approved: true,
      confidence: 87,
      reviewSummary: "Safe migration",
    });
    expect(section).toContain("## Agent review");
    expect(section).toContain("The agent planner proposed 5 patch edit(s).");
    expect(section).toContain("Independent agent review approved (87% confidence).");
    expect(section).toContain("- Safe migration");
  });

  it("does not invent a review when the run had no review", () => {
    const section = agentBodySection({
      editCount: 2,
      approved: null,
      confidence: null,
      reviewSummary: null,
    });
    expect(section).not.toContain("Independent agent review");
  });
});
