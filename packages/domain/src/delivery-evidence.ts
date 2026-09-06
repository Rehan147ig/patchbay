import { z } from "zod";

/**
 * Standardized PR evidence block (WP9, spec §7.4). Every Patchbay delivery
 * carries the SAME two parts:
 *
 * 1. A machine-readable HTML comment with canonical JSON — downstream
 *    automation (status sync, update-on-advance, audit) parses this, never
 *    the prose.
 * 2. A human-readable summary with policy/validation evidence and rollback
 *    instructions.
 *
 * DB-free and dependency-free (local stable stringify, no cross-package
 * imports) so parsers can run in unit tests and edge handlers.
 */

export const DELIVERY_EVIDENCE_VERSION = 1;
export const DELIVERY_EVIDENCE_MARKER = "patchbay:evidence";

export const deliveryEvidencePayloadSchema = z.object({
  version: z.literal(DELIVERY_EVIDENCE_VERSION),
  caseId: z.string().min(1).nullable(),
  remediationPlanId: z.string().min(1),
  /** 1-based index of this plan among the case's plans (1 when caseless). */
  caseVersion: z.number().int().min(1),
  policyDecision: z.string().min(1),
  policyReasons: z.array(z.string()),
  validationStatus: z.string().min(1),
  validationRunId: z.string().min(1).nullable(),
  validationArtifactHash: z.string().min(1).nullable(),
  commandsExecuted: z.array(z.string()),
  imageDigest: z.string().min(1).nullable(),
  riskTags: z.array(z.string()),
  affectedUsageCount: z.number().int().min(0),
  patchCount: z.number().int().min(1),
  approvalDecision: z.string().min(1).nullable(),
  agentVerdict: z.string().min(1).nullable(),
  correlationId: z.string().min(1),
  createdAt: z.string().min(1),
});
export type DeliveryEvidencePayload = z.infer<typeof deliveryEvidencePayloadSchema>;

/** Deterministic JSON: sorted keys, no whitespace variance. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

export function buildEvidenceMachineComment(payload: DeliveryEvidencePayload): string {
  const parsed = deliveryEvidencePayloadSchema.parse(payload);
  return `<!-- ${DELIVERY_EVIDENCE_MARKER} ${stableStringify(parsed)} -->`;
}

/**
 * Parse the machine block out of a PR body. Returns null when absent or
 * invalid — callers treat that as "not a Patchbay-managed body" and refuse
 * automated updates rather than guessing.
 */
export function parseEvidenceBlock(body: string): DeliveryEvidencePayload | null {
  const match = body.match(new RegExp(`<!-- ${DELIVERY_EVIDENCE_MARKER} (\\{.*?\\}) -->`, "s"));
  if (!match?.[1]) return null;
  try {
    const parsed: unknown = JSON.parse(match[1]);
    const result = deliveryEvidencePayloadSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export interface EvidenceHumanInput {
  repositoryName: string;
  branchName: string;
  baseBranch: string;
  caseVersion: number;
  policyDecision: string;
  policyReasons: string[];
  validationStatus: string;
  validationArtifactHash: string | null;
  approvalDecision: string | null;
  riskTags: string[];
  affectedUsageCount: number;
  patchCount: number;
}

/**
 * Human-readable half of the §7.4 block. Rollback is branch-based because the
 * PR number is unknown at build time (body is written before creation): close
 * unmerged + delete the branch. Nothing has merged, so the base is untouched.
 */
export function buildEvidenceHumanSection(input: EvidenceHumanInput): string {
  const lines = [
    `## Patchbay remediation evidence (case version ${input.caseVersion})`,
    ``,
    `Automated remediation plan for **${input.repositoryName}** — draft PR only, never auto-merged.`,
    ``,
    `| Check | Result |`,
    `| --- | --- |`,
    `| Policy decision | \`${input.policyDecision}\`${input.policyReasons.length > 0 ? ` — ${input.policyReasons.join("; ")}` : ""} |`,
    `| Validation | \`${input.validationStatus}\`${input.validationArtifactHash ? ` (artifact \`${input.validationArtifactHash.slice(0, 12)}\`)` : ""} |`,
    `| Approval | ${input.approvalDecision ?? "none recorded"} |`,
    `| Risk tags | ${input.riskTags.length > 0 ? input.riskTags.join(", ") : "none"} |`,
    `| Scope | ${input.affectedUsageCount} affected usages, ${input.patchCount} patches |`,
    ``,
    `### Rollback`,
    ``,
    `No code has merged — closing this PR unmerged leaves \`${input.baseBranch}\` untouched:`,
    ``,
    `1. Close this pull request without merging (human review required regardless).`,
    `2. Delete the delivery branch: \`git push origin --delete ${input.branchName}\`.`,
    `3. Re-run validation any time: the pinned execution profile is recorded in the machine block below.`,
    ``,
  ];
  return lines.join("\n");
}

/** Full §7.4 body: machine comment first (parsers read top-down), then human evidence. */
export function buildEvidenceBlock(
  payload: DeliveryEvidencePayload,
  human: EvidenceHumanInput,
): string {
  return `${buildEvidenceMachineComment(payload)}\n${buildEvidenceHumanSection(human)}`;
}
