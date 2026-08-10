import { z } from "zod";
import { prisma } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import { ActorType, ImpactStatus, VendorChangeStatus, logger } from "@patchbay/domain";
import { assessImpact, getConnector } from "@patchbay/vendor-connectors";
import type { NormalizedChangeDraft } from "@patchbay/vendor-connectors";
import type { Job } from "bullmq";
import { writeAuditEvent } from "../lib/audit";

/**
 * analyze-change processor.
 *
 * The web API enqueues the job (changeEventId + correlationId). This processor:
 * 1. loads the VendorChangeEvent + vendor, resolves the vendor connector
 * 2. normalizes the raw payload into NormalizedChange rows (idempotent replace)
 * 3. scores impact per repository that has tracked usages for the vendor
 *    and upserts ImpactAssessment (+ affected usage links)
 * 4. marks the event TRIAGED and writes change.normalized / impact.assessed /
 *    change.triaged audit events
 *
 * Vendors without a connector are still triaged (event marked TRIAGED, noted in
 * audit) so no event ends in a silently ignored state.
 */
export const AnalyzeChangeJobDataSchema = z.object({
  changeEventId: z.string().min(1),
  /** Audit ownership; the event must belong to this org (multi-tenant scoping). */
  organizationId: z.string().min(1),
  correlationId: z.string().min(1),
});
export type AnalyzeChangeJobData = z.infer<typeof AnalyzeChangeJobDataSchema>;

export interface AnalyzeChangeResult {
  changeEventId: string;
  normalizedCount: number;
  repositoriesAssessed: number;
  affectedRepositoryIds: string[];
}

export async function processAnalyzeChange(job: Job): Promise<AnalyzeChangeResult> {
  const parsed = AnalyzeChangeJobDataSchema.safeParse(job.data);
  if (!parsed.success) {
    throw new Error(`invalid analyze-change job data: ${parsed.error.message}`);
  }
  const { changeEventId, organizationId, correlationId } = parsed.data;

  const event = await prisma.vendorChangeEvent.findFirst({
    where: { id: changeEventId, organizationId },
    include: { vendor: true },
  });
  if (!event) {
    throw new Error(`vendor change event not found: ${changeEventId}`);
  }

  const entity = { entityType: "vendorChangeEvent", entityId: changeEventId };
  const connector = getConnector(event.vendor.slug);

  if (!connector) {
    await prisma.vendorChangeEvent.update({
      where: { id: changeEventId },
      data: { status: VendorChangeStatus.TRIAGED },
    });
    await writeAuditEvent({
      organizationId,
      actorType: ActorType.SYSTEM,
      actorId: null,
      action: AuditAction.CHANGE_TRIAGED,
      correlationId,
      ...entity,
      after: {
        vendorSlug: event.vendor.slug,
        note: `No connector for vendor "${event.vendor.slug}"; event triaged without normalization.`,
      },
    });
    logger.warn("analyze-change: no connector, event triaged", {
      changeEventId,
      vendorSlug: event.vendor.slug,
      correlationId,
    });
    return {
      changeEventId,
      normalizedCount: 0,
      repositoriesAssessed: 0,
      affectedRepositoryIds: [],
    };
  }

  const drafts = connector.normalizeChange({
    rawPayload: event.rawPayload,
    sourceType: event.sourceType,
  });

  const normalized = await replaceNormalizations(changeEventId, drafts);
  await writeAuditEvent({
    organizationId,
    actorType: ActorType.SYSTEM,
    actorId: null,
    action: AuditAction.CHANGE_NORMALIZED,
    correlationId,
    ...entity,
    after: { vendorSlug: event.vendor.slug, normalizedCount: normalized.length },
  });
  logger.info("change normalized", {
    changeEventId,
    vendorSlug: event.vendor.slug,
    normalizedCount: normalized.length,
    correlationId,
  });

  const usages = await prisma.integrationUsage.findMany({
    where: { vendorId: event.vendorId },
    include: { repository: true },
  });

  const byRepository = new Map<string, typeof usages>();
  for (const usage of usages) {
    const list = byRepository.get(usage.repositoryId) ?? [];
    list.push(usage);
    byRepository.set(usage.repositoryId, list);
  }

  const affectedRepositoryIds: string[] = [];
  for (const [repositoryId, repositoryUsages] of byRepository) {
    const firstUsage = repositoryUsages[0];
    if (!firstUsage) continue;
    const repository = firstUsage.repository;
    const draft = assessImpact({
      vendorSlug: event.vendor.slug,
      repositoryName: repository.name,
      severity: event.severity,
      normalizations: drafts,
      usages: repositoryUsages.map((usage) => ({
        id: usage.id,
        symbol: usage.symbol,
        usageType: usage.usageType,
        riskTags: usage.riskTags,
      })),
    });

    await upsertAssessment(organizationId, changeEventId, repositoryId, draft, repositoryUsages);
    if (draft.status === ImpactStatus.AFFECTED || draft.status === ImpactStatus.POSSIBLY_AFFECTED) {
      affectedRepositoryIds.push(repositoryId);
    }
  }

  await prisma.vendorChangeEvent.update({
    where: { id: changeEventId },
    data: { status: VendorChangeStatus.TRIAGED },
  });

  await writeAuditEvent({
    organizationId,
    actorType: ActorType.SYSTEM,
    actorId: null,
    action: AuditAction.IMPACT_ASSESSED,
    correlationId,
    ...entity,
    after: {
      vendorSlug: event.vendor.slug,
      repositoriesAssessed: byRepository.size,
      affectedRepositoryIds,
      affectedRepositoryCount: affectedRepositoryIds.length,
    },
  });
  await writeAuditEvent({
    organizationId,
    actorType: ActorType.SYSTEM,
    actorId: null,
    action: AuditAction.CHANGE_TRIAGED,
    correlationId,
    ...entity,
    after: { vendorSlug: event.vendor.slug, status: VendorChangeStatus.TRIAGED },
  });

  logger.info("change analyzed", {
    changeEventId,
    vendorSlug: event.vendor.slug,
    normalizedCount: normalized.length,
    repositoriesAssessed: byRepository.size,
    affectedRepositoryCount: affectedRepositoryIds.length,
    correlationId,
  });

  return {
    changeEventId,
    normalizedCount: normalized.length,
    repositoriesAssessed: byRepository.size,
    affectedRepositoryIds,
  };
}

async function replaceNormalizations(
  changeEventId: string,
  drafts: NormalizedChangeDraft[],
): Promise<NormalizedChangeDraft[]> {
  if (drafts.length === 0) {
    await prisma.normalizedChange.deleteMany({ where: { changeEventId } });
    return [];
  }
  await prisma.$transaction([
    prisma.normalizedChange.deleteMany({ where: { changeEventId } }),
    prisma.normalizedChange.createMany({
      data: drafts.map((draft) => ({
        changeEventId,
        changeType: draft.changeType,
        oldValue: draft.oldValue ?? null,
        newValue: draft.newValue ?? null,
        description: draft.description ?? null,
        breaking: draft.breaking,
        evidence: {
          ...(draft.evidence ?? {}),
          affectedSymbols: draft.affectedSymbols,
        } as never,
      })),
    }),
  ]);
  return drafts;
}

async function upsertAssessment(
  organizationId: string,
  changeEventId: string,
  repositoryId: string,
  draft: ReturnType<typeof assessImpact>,
  repositoryUsages: Array<{ id: string }>,
): Promise<void> {
  const assessment = await prisma.impactAssessment.upsert({
    where: {
      changeEventId_repositoryId: { changeEventId, repositoryId },
    },
    update: {
      organizationId,
      score: draft.score,
      confidence: draft.confidence,
      affectedUsageCount: draft.affectedUsageIds.length,
      riskLevel: draft.riskLevel,
      rationale: draft.rationale,
      status: draft.status,
    },
    create: {
      organizationId,
      changeEventId,
      repositoryId,
      score: draft.score,
      confidence: draft.confidence,
      affectedUsageCount: draft.affectedUsageIds.length,
      riskLevel: draft.riskLevel,
      rationale: draft.rationale,
      status: draft.status,
    },
  });

  const affectedUsageIds = new Set(draft.affectedUsageIds);
  const unaffectedLinks = repositoryUsages.filter((usage) => !affectedUsageIds.has(usage.id));

  const linkData = [
    ...draft.affectedUsageIds.map((usageId) => ({
      organizationId,
      impactAssessmentId: assessment.id,
      usageId,
    })),
    ...unaffectedLinks.map((usage) => ({
      organizationId,
      impactAssessmentId: assessment.id,
      usageId: usage.id,
    })),
  ];

  await prisma.$transaction([
    prisma.impactAssessmentUsage.deleteMany({ where: { impactAssessmentId: assessment.id } }),
    ...(linkData.length > 0 ? [prisma.impactAssessmentUsage.createMany({ data: linkData })] : []),
  ]);
}
