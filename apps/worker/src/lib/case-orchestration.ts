import { prisma, createNotification, NotificationType } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import {
  ActorType,
  CaseReasonCode,
  CaseStatus,
  CASE_TERMINAL_STATUSES,
  logger,
  RiskLevel,
} from "@patchbay/domain";
import { sha256Hex } from "@patchbay/vendor-connectors";
import { appendCaseEvent } from "./case-ops";
import type { FunnelDecision } from "./case-funnel";
import { writeAuditEvent } from "./audit";

/**
 * Maintenance case orchestration (Production Spec WP4).
 *
 * Turns a persisted ContractChange into per-repository maintenance cases:
 * contract change → consumer impact matching → impact assessment → case
 * creation/update. The release funnel (scopeKey, ReleaseRecord linkage) is
 * untouched; the contract funnel keys on dedupeKey with the same lifecycle
 * enum, timeline events, terminal-state protection, and audit discipline.
 *
 * Idempotency (the WP4 guarantee): a duplicate change event for the same
 * (organization, source, change identity, repository) converges on the
 * existing case — receipt metadata (correlationId/updatedAt) refreshes, but
 * no duplicate case, assessment, or timeline event is ever written. Races
 * converge on the partial unique key like every other writer in this repo.
 */

export interface OrchestrateContractChangeInput {
  contractChangeId: string;
  organizationId: string;
  /** Narrow to one repository; otherwise every consumer repository is reconciled. */
  repositoryId?: string;
  correlationId: string;
}

export interface OrchestratedCase {
  caseId: string;
  repositoryId: string;
  created: boolean;
  status: CaseStatus;
}

export interface OrchestrationResult {
  affected: boolean;
  consumerCount: number;
  cases: OrchestratedCase[];
}

export function contractDedupeKey(
  organizationId: string,
  sourceId: string,
  changeIdentity: string,
  repositoryId: string,
): string {
  return sha256Hex(`${organizationId}|${sourceId}|${changeIdentity}|${repositoryId}`);
}

function riskLevelOf(severity: string): RiskLevel {
  const normalized = severity.trim().toUpperCase();
  if (
    normalized === RiskLevel.CRITICAL ||
    normalized === RiskLevel.HIGH ||
    normalized === RiskLevel.MEDIUM ||
    normalized === RiskLevel.LOW
  ) {
    return normalized;
  }
  return RiskLevel.MEDIUM;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "P2002"
  );
}

export async function orchestrateContractChange(
  input: OrchestrateContractChangeInput,
): Promise<OrchestrationResult> {
  const change = await prisma.contractChange.findUnique({
    where: { id: input.contractChangeId },
    include: { source: true },
  });
  if (!change) throw new Error(`contract change not found: ${input.contractChangeId}`);
  const sourceOrg = change.source.organizationId;
  if (sourceOrg !== null && sourceOrg !== input.organizationId) {
    throw new Error(`contract source ${change.source.id} belongs to another organization`);
  }

  const consumers = await prisma.contractConsumer.findMany({
    where: {
      organizationId: input.organizationId,
      contractSourceId: change.sourceId,
      ...(input.repositoryId ? { repositoryId: input.repositoryId } : {}),
    },
    orderBy: { repositoryId: "asc" },
  });
  if (consumers.length === 0) {
    logger.info("contract change affects no known consumers; no case created", {
      contractChangeId: change.id,
      organizationId: input.organizationId,
      correlationId: input.correlationId,
    });
    return { affected: false, consumerCount: 0, cases: [] };
  }

  const byRepository = new Map<string, typeof consumers>();
  for (const consumer of consumers) {
    const list = byRepository.get(consumer.repositoryId) ?? [];
    list.push(consumer);
    byRepository.set(consumer.repositoryId, list);
  }

  const cases: OrchestratedCase[] = [];
  for (const [repositoryId, repoConsumers] of byRepository) {
    cases.push(await reconcileRepoCase(change, repoConsumers, repositoryId, input));
  }
  return { affected: true, consumerCount: consumers.length, cases };
}

interface LoadedChange {
  id: string;
  sourceId: string;
  identity: string;
  severity: string;
  description: string;
  source: { id: string; vendorSlug: string };
}

interface LoadedConsumer {
  repositoryId: string;
  identifier: string;
  versionRange: string | null;
  confidence: number;
  evidenceJson: unknown;
}

async function reconcileRepoCase(
  change: LoadedChange,
  consumers: LoadedConsumer[],
  repositoryId: string,
  input: OrchestrateContractChangeInput,
): Promise<OrchestratedCase> {
  const dedupeKey = contractDedupeKey(
    input.organizationId,
    change.sourceId,
    change.identity,
    repositoryId,
  );
  const existing = await prisma.remediationCase.findUnique({
    where: { organizationId_dedupeKey: { organizationId: input.organizationId, dedupeKey } },
    select: { id: true, status: true },
  });
  if (existing) {
    if (CASE_TERMINAL_STATUSES.has(existing.status as CaseStatus)) {
      return {
        caseId: existing.id,
        repositoryId,
        created: false,
        status: existing.status as CaseStatus,
      };
    }
    // Duplicate observation: refresh receipt metadata only. No new timeline
    // event, no new assessment — the spec forbids duplicate timeline spam.
    const refreshed = await prisma.remediationCase.update({
      where: { id: existing.id },
      data: { correlationId: input.correlationId },
      select: { id: true, status: true },
    });
    // A re-observed non-terminal case may still lack assessments (earlier run
    // died mid-reconcile): resume it instead of leaving it half-built.
    await ensureAssessments(change, consumers, repositoryId, refreshed.id, input);
    const advanced = await advanceToImpactConfirmed(refreshed.id, input, consumers.length);
    return {
      caseId: refreshed.id,
      repositoryId,
      created: false,
      status: advanced ?? (refreshed.status as CaseStatus),
    };
  }

  const caseKey = `contract-change:${change.id}:${repositoryId}`;
  const scopeKey = `contract:${change.sourceId}:${repositoryId}:${change.identity}`;
  let created: { id: string };
  try {
    created = await prisma.remediationCase.create({
      data: {
        organizationId: input.organizationId,
        scopeKey,
        status: CaseStatus.OBSERVED,
        reasonCode: CaseReasonCode.CONTRACT_CHANGE,
        contractChangeId: change.id,
        caseKey,
        triggerType: "CONTRACT_CHANGE",
        dedupeKey,
        capabilityLevel: "ASSESS",
        repositoryId,
        correlationId: input.correlationId,
      },
      select: { id: true },
    });
  } catch (error: unknown) {
    // Race: a concurrent orchestration won the dedupe key first. Converge on
    // the winner like every other idempotent writer in this repo.
    if (!isUniqueViolation(error)) throw error;
    const winner = await prisma.remediationCase.findUnique({
      where: { organizationId_dedupeKey: { organizationId: input.organizationId, dedupeKey } },
      select: { id: true, status: true },
    });
    if (!winner) throw error;
    await ensureAssessments(change, consumers, repositoryId, winner.id, input);
    const advanced = await advanceToImpactConfirmed(winner.id, input, consumers.length);
    return {
      caseId: winner.id,
      repositoryId,
      created: false,
      status: advanced ?? (winner.status as CaseStatus),
    };
  }

  const observed: FunnelDecision = {
    status: CaseStatus.OBSERVED,
    reasonCode: CaseReasonCode.CONTRACT_CHANGE,
    planEligible: false,
    blastRadius: {
      score: 0,
      severity: "LOW",
      factors: [`contract change observed for ${consumers.length} consumer(s)`],
    },
    // Policy is not evaluated in the contract funnel until WP5: record the
    // pending posture explicitly rather than inventing a decision.
    policyDecision: { decision: "PENDING", requiresHumanReview: true, deniedByPolicy: null },
  };
  await appendCaseEvent(created.id, input.organizationId, observed, input.correlationId);
  await createNotification({
    organizationId: input.organizationId,
    type: NotificationType.CASE_CREATED,
    title: `New contract case: ${change.source.vendorSlug} ${change.identity}`,
    body: `Status OBSERVED (${CaseReasonCode.CONTRACT_CHANGE}) — ${consumers.length} consumer(s) with evidence`,
    correlationId: input.correlationId,
  });
  await writeAuditEvent({
    organizationId: input.organizationId,
    actorType: ActorType.SYSTEM,
    actorId: null,
    action: AuditAction.CASE_CREATED,
    entityType: "remediationCase",
    entityId: created.id,
    correlationId: input.correlationId,
    after: {
      caseKey,
      dedupeKey,
      triggerType: "CONTRACT_CHANGE",
      contractChangeId: change.id,
      consumerCount: consumers.length,
    },
  });

  await ensureAssessments(change, consumers, repositoryId, created.id, input);
  const advanced =
    (await advanceToImpactConfirmed(created.id, input, consumers.length)) ?? CaseStatus.OBSERVED;
  return { caseId: created.id, repositoryId, created: true, status: advanced };
}

async function ensureAssessments(
  change: LoadedChange,
  consumers: LoadedConsumer[],
  repositoryId: string,
  caseId: string,
  input: OrchestrateContractChangeInput,
): Promise<void> {
  const topConfidence = Math.max(...consumers.map((consumer) => consumer.confidence));
  const commitShas = consumers
    .map((consumer) => (consumer.evidenceJson as { commitSha?: unknown } | null)?.commitSha)
    .filter((sha): sha is string => typeof sha === "string");
  const graphSnapshot = commitShas[0]
    ? await prisma.graphSnapshot.findFirst({
        where: {
          organizationId: input.organizationId,
          repositoryId,
          commitSha: commitShas[0],
          status: "READY",
        },
        select: { id: true },
        orderBy: { createdAt: "desc" },
      })
    : null;

  const existing = await prisma.impactAssessment.findUnique({
    where: { caseId_repositoryId: { caseId, repositoryId } },
    select: { id: true },
  });
  const data = {
    organizationId: input.organizationId,
    repositoryId,
    caseId,
    graphSnapshotId: graphSnapshot?.id ?? null,
    score: topConfidence,
    confidence: topConfidence,
    affectedUsageCount: consumers.length,
    affected: true,
    riskLevel: riskLevelOf(change.severity),
    rationale:
      `${consumers.length} contract consumer(s) matched for ${change.source.vendorSlug} ` +
      `change ${change.identity}`,
    blastRadiusJson: {
      consumerCount: consumers.length,
      topConfidence,
      identifiers: consumers.map((consumer) => consumer.identifier),
    } as never,
    evidenceJson: {
      contractChangeId: change.id,
      changeIdentity: change.identity,
      changeDescription: change.description,
      consumers: consumers.map((consumer) => ({
        identifier: consumer.identifier,
        versionRange: consumer.versionRange,
        confidence: consumer.confidence,
        evidence: consumer.evidenceJson,
      })),
    } as never,
    reasonCode: CaseReasonCode.CONTRACT_CHANGE,
    status: "AFFECTED" as const,
  };
  if (existing) {
    await prisma.impactAssessment.update({ where: { id: existing.id }, data });
  } else {
    await prisma.impactAssessment.create({ data: { ...data, changeEventId: null } });
  }
}

/** Advances a case OBSERVED → IMPACT_CONFIRMED with timeline + audit; null when already past. */
async function advanceToImpactConfirmed(
  caseId: string,
  input: OrchestrateContractChangeInput,
  consumerCount: number,
): Promise<CaseStatus | null> {
  const current = await prisma.remediationCase.findUnique({
    where: { id: caseId },
    select: { status: true },
  });
  if (!current || current.status !== CaseStatus.OBSERVED) return null;
  const updated = await prisma.remediationCase.update({
    where: { id: caseId },
    data: { status: CaseStatus.IMPACT_CONFIRMED, correlationId: input.correlationId },
    select: { status: true },
  });
  const decision: FunnelDecision = {
    status: CaseStatus.IMPACT_CONFIRMED,
    reasonCode: CaseReasonCode.CONTRACT_CHANGE,
    planEligible: false,
    blastRadius: {
      score: consumerCount,
      severity: "LOW",
      factors: [`${consumerCount} contract consumer(s) with evidence`],
    },
    policyDecision: { decision: "PENDING", requiresHumanReview: true, deniedByPolicy: null },
  };
  await appendCaseEvent(caseId, input.organizationId, decision, input.correlationId);
  await writeAuditEvent({
    organizationId: input.organizationId,
    actorType: ActorType.SYSTEM,
    actorId: null,
    action: AuditAction.CASE_STATUS_CHANGED,
    entityType: "remediationCase",
    entityId: caseId,
    correlationId: input.correlationId,
    before: { status: CaseStatus.OBSERVED },
    after: { status: updated.status },
  });
  return updated.status as CaseStatus;
}

export type AttemptStatus = "SUCCEEDED" | "FAILED" | "SKIPPED";

export interface RecordAttemptInput {
  caseId: string | null;
  strategyId: string;
  rulePackVersion?: string | null;
  agentRunId?: string;
  inputHash: string;
  outputHash?: string;
  status: AttemptStatus;
  patchArtifactId?: string;
  failureCode?: string;
  correlationId?: string;
  organizationId: string;
}

/**
 * Records one remediation strategy attempt. Best-effort by contract: a
 * recording failure is logged loudly but never breaks the remediation it
 * observes (the job-level DLQ path owns hard failures). Returns null when
 * there is no case to attach to (legacy plans predate case linkage).
 */
export async function recordRemediationAttempt(
  input: RecordAttemptInput,
): Promise<{ attemptId: string } | null> {
  if (!input.caseId) {
    logger.info("remediation attempt skipped (no linked case)", {
      strategyId: input.strategyId,
      status: input.status,
    });
    return null;
  }
  try {
    const attempt = await prisma.remediationAttempt.create({
      data: {
        organizationId: input.organizationId,
        caseId: input.caseId,
        strategyId: input.strategyId,
        rulePackVersion: input.rulePackVersion ?? null,
        agentRunId: input.agentRunId ?? null,
        inputHash: input.inputHash,
        outputHash: input.outputHash ?? null,
        status: input.status,
        patchArtifactId: input.patchArtifactId ?? null,
        failureCode: input.failureCode ?? null,
        correlationId: input.correlationId ?? null,
      },
      select: { id: true },
    });
    return { attemptId: attempt.id };
  } catch (error) {
    logger.error("remediation attempt recording failed (remediation continues)", {
      caseId: input.caseId,
      strategyId: input.strategyId,
      error: String(error),
    });
    return null;
  }
}
