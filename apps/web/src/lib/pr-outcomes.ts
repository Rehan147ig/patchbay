/**
 * Outcome recording (WP10). One writer for PrOutcome rows used by the GitHub
 * webhook (source GITHUB_WEBHOOK) and the feedback API (source USER_FEEDBACK).
 *
 * Each outcome is linked to the exact versions and evidence that produced the
 * PR: rule-pack / extractor version from the capability registry, model +
 * prompt template from the latest agent run of the case, the graph snapshot
 * and the validation run that backed the plan. A PR merged through the
 * webhook also moves its remediation case to the MERGED terminal state.
 */
import { AuditAction } from "@patchbay/audit";
import {
  ActorType,
  CaseStatus,
  OutcomeSource,
  PrOutcomeClassification,
  PrOutcomeStatus,
  logger,
} from "@patchbay/domain";
import { getCapability } from "@patchbay/vendor-connectors";
import { enqueue, JobType } from "@patchbay/queue";
import { prisma, Prisma } from "@patchbay/db";
import { writeAuditEvent } from "@/lib/api";

export interface RecordPrOutcomeInput {
  organizationId: string;
  pullRequestId: string;
  status: PrOutcomeStatus;
  source: OutcomeSource;
  classification?: PrOutcomeClassification;
  note?: string | null;
  recordedBy?: string | null;
  planId?: string | null;
  caseId?: string | null;
  vendorSlug?: string | null;
  policyDecision?: Prisma.InputJsonValue | null;
  correlationId: string;
}

export interface RecordPrOutcomeResult {
  outcomeId: string;
  changed: boolean;
  caseStatusChanged: boolean;
}

export async function recordPrOutcome(input: RecordPrOutcomeInput): Promise<RecordPrOutcomeResult> {
  const capability = input.vendorSlug ? getCapability(input.vendorSlug) : null;

  let graphSnapshotId: string | null = null;
  let modelVersion: string | null = null;
  let promptTemplateVersion: string | null = null;
  if (input.caseId) {
    const [latestRun, caseRow] = await Promise.all([
      prisma.agentRun.findFirst({
        where: { remediationCaseId: input.caseId },
        orderBy: { createdAt: "desc" },
        select: { model: true, promptTemplateVersion: true },
      }),
      prisma.remediationCase.findUnique({
        where: { id: input.caseId },
        select: { snapshotId: true },
      }),
    ]);
    modelVersion = latestRun?.model ?? null;
    promptTemplateVersion = latestRun?.promptTemplateVersion ?? null;
    graphSnapshotId = caseRow?.snapshotId ?? null;
  }

  let validationRunId: string | null = null;
  if (input.planId) {
    const latestValidation = await prisma.validationRun.findFirst({
      where: { remediationPlanId: input.planId },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    validationRunId = latestValidation?.id ?? null;
  }

  const classification = input.classification ?? PrOutcomeClassification.UNCLASSIFIED;

  const baseData = {
    organizationId: input.organizationId,
    pullRequestId: input.pullRequestId,
    caseId: input.caseId ?? null,
    status: input.status,
    classification,
    source: input.source,
    note: input.note ?? null,
    rulePackVersion: capability?.rulePackVersion ?? null,
    extractorVersion: capability?.extractorVersion ?? null,
    modelVersion,
    promptTemplateVersion,
    graphSnapshotId,
    validationRunId,
    policyDecision: input.policyDecision ?? Prisma.DbNull,
    recordedBy: input.recordedBy ?? null,
  } satisfies Prisma.PrOutcomeUncheckedCreateInput;

  const existing = await prisma.prOutcome.findUnique({
    where: { pullRequestId: input.pullRequestId },
    select: { id: true, status: true, classification: true },
  });

  const outcome = await prisma.prOutcome.upsert({
    where: { pullRequestId: input.pullRequestId },
    create: baseData,
    update: baseData,
    select: { id: true },
  });

  const changed =
    !existing || existing.status !== input.status || existing.classification !== classification;

  let caseStatusChanged = false;
  if (input.status === PrOutcomeStatus.MERGED && input.caseId && changed) {
    caseStatusChanged = await closeCaseOnMerge(input.caseId, input.correlationId);
  }

  await writeAuditEvent({
    organizationId: input.organizationId,
    actorType: input.source === OutcomeSource.USER_FEEDBACK ? ActorType.USER : ActorType.SYSTEM,
    actorId: input.recordedBy ?? null,
    action:
      input.source === OutcomeSource.USER_FEEDBACK
        ? AuditAction.PR_OUTCOME_CLASSIFIED
        : AuditAction.PR_OUTCOME_RECORDED,
    entityType: "prOutcome",
    entityId: outcome.id,
    correlationId: input.correlationId,
    after: {
      pullRequestId: input.pullRequestId,
      status: input.status,
      classification,
      source: input.source,
      vendorSlug: input.vendorSlug ?? null,
      rulePackVersion: baseData.rulePackVersion,
      extractorVersion: baseData.extractorVersion,
      modelVersion,
      graphSnapshotId,
    },
  });

  if (
    input.vendorSlug &&
    (input.status === PrOutcomeStatus.MERGED || input.status === PrOutcomeStatus.CLOSED)
  ) {
    await enqueue(JobType.EVALUATE_CAPABILITY_HEALTH, {
      organizationId: input.organizationId,
      vendorSlug: input.vendorSlug,
      correlationId: input.correlationId,
    });
  }

  logger.info("pr outcome recorded", {
    correlationId: input.correlationId,
    outcomeId: outcome.id,
    pullRequestId: input.pullRequestId,
    status: input.status,
    classification,
    source: input.source,
  });

  return { outcomeId: outcome.id, changed, caseStatusChanged };
}

/** Moves a case to the MERGED terminal state exactly once. */
async function closeCaseOnMerge(caseId: string, correlationId: string): Promise<boolean> {
  const caseRow = await prisma.remediationCase.findUnique({
    where: { id: caseId },
    select: { id: true, organizationId: true, status: true },
  });
  if (!caseRow || caseRow.status === CaseStatus.MERGED) return false;

  await prisma.remediationCase.update({
    where: { id: caseId },
    data: {
      status: CaseStatus.MERGED,
      terminalOutcome: "PR_MERGED",
      terminalAt: new Date(),
    },
  });
  await prisma.remediationCaseEvent.create({
    data: {
      organizationId: caseRow.organizationId,
      remediationCaseId: caseId,
      status: CaseStatus.MERGED,
      reasonCode: "PR_MERGED",
      detailJson: { terminalOutcome: "PR_MERGED" },
      correlationId,
    },
  });
  return true;
}
