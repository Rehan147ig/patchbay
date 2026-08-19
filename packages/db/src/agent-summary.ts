/**
 * Read-only helpers that turn persisted agent-run artifacts into short,
 * human-readable summaries. Shared by the case UI (per-step summaries) and
 * the CREATE_PR job (planner/reviewer verdict in the draft PR body). Pure —
 * no database access, no provider calls.
 */

export interface AgentVerdictSummary {
  editCount: number | null;
  approved: boolean | null;
  confidence: number | null;
  reviewSummary: string | null;
}

export interface AgentStepLike {
  role: string;
  kind: string;
  status: string;
  toolName: string | null;
}

export function agentStepSummary(step: AgentStepLike): string {
  if (step.kind === "TOOL_CALL") {
    if (step.toolName === "getReleaseFacts") return "Analyzed release facts";
    if (step.toolName === "getAffectedUsageSubgraph") return "Mapped affected usages";
    return step.toolName ? `Ran ${step.toolName}` : "Ran a tool step";
  }
  if (step.role === "PLANNER") return "Proposed a remediation plan";
  if (step.role === "REVIEWER") return "Independently reviewed the plan";
  if (step.role === "ANALYST") return "Analyzed evidence";
  return "Executed workflow step";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function agentVerdictFromRun(outputJson: unknown): AgentVerdictSummary | null {
  if (!isRecord(outputJson)) return null;
  const plan = isRecord(outputJson.plan) ? outputJson.plan : null;
  const review = isRecord(outputJson.review) ? outputJson.review : null;
  const editCount = Array.isArray(plan?.edits) ? plan.edits.length : null;
  const approved = typeof review?.approved === "boolean" ? review.approved : null;
  const confidence = typeof review?.confidence === "number" ? review.confidence : null;
  const reviewSummary =
    typeof review?.summary === "string" && review.summary.trim().length > 0
      ? review.summary.trim()
      : null;
  if (editCount === null && approved === null) return null;
  return { editCount, approved, confidence, reviewSummary };
}

/** Markdown block appended to a draft PR body when an agent verdict exists. */
export function agentBodySection(verdict: AgentVerdictSummary): string {
  const lines: string[] = ["", "## Agent review"];
  if (verdict.editCount !== null) {
    lines.push(`- The agent planner proposed ${verdict.editCount} patch edit(s).`);
  }
  if (verdict.approved !== null) {
    const confidence = verdict.confidence !== null ? ` (${verdict.confidence}% confidence)` : "";
    lines.push(
      `- Independent agent review ${verdict.approved ? "approved" : "did not approve"}${confidence}.`,
    );
  }
  if (verdict.reviewSummary !== null) lines.push(`- ${verdict.reviewSummary}`);
  return lines.join("\n");
}
