/**
 * Remediation case persistence + tenant policy evaluation (WP3).
 *
 * `evaluateCasePolicies` is pure and mirrors the seeded Policy rule shape:
 * { when: { riskTags?, vendor?, validationStatus? }, then: "DENY" |
 * "REQUIRE_APPROVAL" | "ALLOW_PLAN_ONLY" | "ALLOW_VALIDATE" }. A DENY at case
 * level stops the funnel (POLICY_DENIED) and never spends model budget.
 *
 * `upsertRemediationCase` is the only writer: deterministic scopeKey makes
 * retries idempotent, terminal cases are never re-opened, and every state
 * change appends a RemediationCaseEvent row plus an audit event.
 */
import { prisma, Prisma } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import { ActorType, CASE_TERMINAL_STATUSES, CaseStatus, logger } from "@patchbay/domain";
import { getCapability } from "@patchbay/vendor-connectors";
import type { FunnelDecision, FunnelEvidence } from "./case-funnel";
import { decideFunnel } from "./case-funnel";
import { writeAuditEvent } from "./audit";

export interface CasePolicyRule {
  id: string;
  name: string;
  enabled: boolean;
  definitionJson: {
    when?: {
      riskTags?: string[];
      vendor?: string;
      validationStatus?: string;
    };
    then?: string;
    reason?: string;
  };
}

export interface CasePolicyFacts {
  riskTags: readonly string[];
  vendor: string | null;
  validationStatus: string;
}

export interface CasePolicyEvaluation {
  decision: "ALLOW" | "REQUIRE_APPROVAL" | "ALLOW_PLAN_ONLY" | "ALLOW_VALIDATE" | "DENY";
  reasons: string[];
  matchedPolicyIds: string[];
}

const POLICY_ACTION_PRIORITY: Record<CasePolicyEvaluation["decision"], number> = {
  DENY: 4,
  REQUIRE_APPROVAL: 3,
  ALLOW_PLAN_ONLY: 2,
  ALLOW_VALIDATE: 1,
  ALLOW: 0,
};

export function evaluateCasePolicies(
  policies: readonly CasePolicyRule[],
  facts: CasePolicyFacts,
): CasePolicyEvaluation {
  const reasons: string[] = [];
  const matchedPolicyIds: string[] = [];
  let strongest: CasePolicyEvaluation["decision"] = "ALLOW";

  for (const policy of policies) {
    if (!policy.enabled) continue;
    const rule = policy.definitionJson;
    const when = rule.when ?? {};
    if (!rule.then) continue;

    if (when.riskTags && !when.riskTags.some((tag) => facts.riskTags.includes(tag))) continue;
    if (when.vendor && when.vendor !== facts.vendor) continue;
    if (when.validationStatus && when.validationStatus !== facts.validationStatus) continue;

    const decision = rule.then as CasePolicyEvaluation["decision"];
    matchedPolicyIds.push(policy.id);
    reasons.push(rule.reason ?? policy.name);
    if (POLICY_ACTION_PRIORITY[decision] > POLICY_ACTION_PRIORITY[strongest]) {
      strongest = decision;
    }
  }

  return { decision: strongest, reasons, matchedPolicyIds };
}

export function scopeKeyOf(
  releaseId: string,
  repositoryId: string,
  dependencyId: string,
  snapshotId: string | null,
): string {
  return `${releaseId}:${repositoryId}:${dependencyId}:${snapshotId ?? "no-snapshot"}`;
}

export interface CaseContext {
  organizationId: string;
  releaseId: string;
  repositoryId: string;
  dependencyId: string;
  matchId: string | null;
  snapshotId: string | null;
  vendorSlug: string;
  correlationId: string;
}

export interface CaseUpsertResult {
  caseId: string;
  status: CaseStatus;
  created: boolean;
  changed: boolean;
}

export async function upsertRemediationCase(
  context: CaseContext,
  evidence: FunnelEvidence,
  humanReviewRequired: boolean,
  policyEvaluation: CasePolicyEvaluation,
  correlationId: string,
): Promise<CaseUpsertResult> {
  const capability = getCapability(context.vendorSlug);
  const capabilityLevel = capability?.level ?? "DETECT";

  const decision = decideFunnel({
    evidence,
    capabilityLevel,
    validationProfile: capability?.validationProfile ?? null,
    policy: {
      deniedByPolicy:
        policyEvaluation.decision === "DENY"
          ? (policyEvaluation.matchedPolicyIds[0] ?? "policy")
          : null,
    },
    humanReviewRequired,
  });

  const scopeKey = scopeKeyOf(
    context.releaseId,
    context.repositoryId,
    context.dependencyId,
    context.snapshotId,
  );

  const existing = await prisma.remediationCase.findUnique({ where: { scopeKey } });
  if (existing && CASE_TERMINAL_STATUSES.has(existing.status as CaseStatus)) {
    return {
      caseId: existing.id,
      status: existing.status as CaseStatus,
      created: false,
      changed: false,
    };
  }

  const policyDecisionJson = {
    decision: decision.policyDecision.decision,
    requiresHumanReview: humanReviewRequired,
    deniedByPolicy:
      policyEvaluation.decision === "DENY" ? (policyEvaluation.matchedPolicyIds[0] ?? null) : null,
    reasons: policyEvaluation.reasons,
    matchedPolicyIds: policyEvaluation.matchedPolicyIds,
  } as Prisma.InputJsonValue;

  const blastRadiusJson = {
    score: decision.blastRadius.score,
    severity: decision.blastRadius.severity,
    factors: decision.blastRadius.factors,
  } as Prisma.InputJsonValue;

  const baseData = {
    organizationId: context.organizationId,
    scopeKey,
    status: decision.status,
    reasonCode: decision.reasonCode,
    blastRadius: blastRadiusJson,
    policyDecision: policyDecisionJson,
    capabilityLevel,
    validationProfile: capability?.validationProfile ?? null,
    snapshotId: context.snapshotId,
    releaseId: context.releaseId,
    repositoryId: context.repositoryId,
    dependencyId: context.dependencyId,
    releaseRepositoryMatchId: context.matchId,
    correlationId,
  };

  const created = existing === null;
  const saved = await prisma.remediationCase.upsert({
    where: { scopeKey },
    create: baseData,
    update: {
      status: decision.status,
      reasonCode: decision.reasonCode,
      blastRadius: blastRadiusJson,
      policyDecision: policyDecisionJson,
      capabilityLevel,
      validationProfile: capability?.validationProfile ?? null,
      snapshotId: context.snapshotId,
      releaseRepositoryMatchId: context.matchId,
      correlationId,
    },
  });

  const changed = !existing || existing.status !== saved.status;
  if (created || changed) {
    await appendCaseEvent(saved.id, context.organizationId, decision, correlationId);
    await writeAuditEvent({
      organizationId: context.organizationId,
      actorType: ActorType.SYSTEM,
      actorId: null,
      action: created ? AuditAction.CASE_CREATED : AuditAction.CASE_STATUS_CHANGED,
      correlationId,
      entityType: "remediationCase",
      entityId: saved.id,
      after: {
        status: saved.status,
        reasonCode: saved.reasonCode,
        planEligible: decision.planEligible,
        scopeKey,
      },
    });
  }

  logger.info("remediation case reconciled", {
    caseId: saved.id,
    correlationId,
    status: saved.status,
    reasonCode: saved.reasonCode,
    planEligible: decision.planEligible,
    created,
  });

  return { caseId: saved.id, status: saved.status as CaseStatus, created, changed };
}

export async function appendCaseEvent(
  caseId: string,
  organizationId: string,
  decision: FunnelDecision,
  correlationId: string,
): Promise<void> {
  await prisma.remediationCaseEvent.create({
    data: {
      organizationId,
      remediationCaseId: caseId,
      status: decision.status,
      reasonCode: decision.reasonCode,
      detailJson: {
        planEligible: decision.planEligible,
        blastRadius: decision.blastRadius,
      } as Prisma.InputJsonValue,
      correlationId,
    },
  });
}
