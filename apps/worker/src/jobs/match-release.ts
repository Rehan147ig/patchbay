import { z } from "zod";
import { prisma } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import { ActorType, evaluateReleaseMatch, logger } from "@patchbay/domain";
import type { Job } from "bullmq";
import { writeAuditEvent } from "../lib/audit";

/**
 * match-release processor (Phase E: deterministic impact matching).
 *
 * Given a ReleaseRecord, finds every repository dependency row for the
 * product's package and records a ReleaseRepositoryMatch when the repository
 * either resolved exactly to this release's version, or its declared range
 * still admits it. Matches are CANDIDATE by default — impact triage decides
 * whether they become MONITOR / REVIEW / REMEDIATE. Idempotent: the unique
 * (releaseRecordId, repositoryId, dependencyId) plus skipDuplicates makes
 * retries and re-runs safe.
 */
export const MatchReleaseJobDataSchema = z.object({
  releaseId: z.string().min(1),
  correlationId: z.string().min(1),
});
export type MatchReleaseJobData = z.infer<typeof MatchReleaseJobDataSchema>;

export interface MatchReleaseResult {
  releaseId: string;
  candidates: number;
  exactMatches: number;
  rangeMatches: number;
}

export async function processMatchRelease(job: Job): Promise<MatchReleaseResult> {
  const parsed = MatchReleaseJobDataSchema.safeParse(job.data);
  if (!parsed.success) {
    throw new Error(`invalid match-release job data: ${parsed.error.message}`);
  }
  const { releaseId, correlationId } = parsed.data;

  const release = await prisma.releaseRecord.findUnique({
    where: { id: releaseId },
    include: { product: true },
  });
  if (!release) {
    throw new Error(`release not found: ${releaseId}`);
  }

  const dependencies = await prisma.repositoryDependency.findMany({
    where: { packageName: release.product.packageName },
    select: {
      id: true,
      organizationId: true,
      repositoryId: true,
      packageName: true,
      declaredRange: true,
      resolvedVersion: true,
    },
  });

  let exactMatches = 0;
  let rangeMatches = 0;
  const rows: Array<{
    releaseRecordId: string;
    organizationId: string;
    repositoryId: string;
    dependencyId: string;
    matchReason: string;
    affectedVersionRange: string;
  }> = [];

  for (const dependency of dependencies) {
    const outcome = evaluateReleaseMatch(release.version, dependency, release.product.packageName);
    if (!outcome.matched) continue;
    if (outcome.exact) exactMatches += 1;
    else rangeMatches += 1;
    rows.push({
      releaseRecordId: releaseId,
      organizationId: dependency.organizationId,
      repositoryId: dependency.repositoryId,
      dependencyId: dependency.id,
      matchReason: outcome.reason,
      affectedVersionRange: release.version,
    });
  }

  if (rows.length > 0) {
    for (let i = 0; i < rows.length; i += 1_000) {
      await prisma.releaseRepositoryMatch.createMany({
        data: rows.slice(i, i + 1_000),
        skipDuplicates: true,
      });
    }
  }

  const organizationIds = [...new Set(rows.map((row) => row.organizationId))];
  for (const organizationId of organizationIds) {
    const orgRows = rows.filter((row) => row.organizationId === organizationId).length;
    await writeAuditEvent({
      organizationId,
      actorType: ActorType.SYSTEM,
      actorId: null,
      action: AuditAction.RELEASE_MATCHED,
      correlationId,
      entityType: "releaseRecord",
      entityId: releaseId,
      after: {
        version: release.version,
        candidates: orgRows,
        packageName: release.product.packageName,
      },
    });
  }

  logger.info("release matched", {
    releaseId,
    correlationId,
    version: release.version,
    packageName: release.product.packageName,
    candidates: rows.length,
    exactMatches,
    rangeMatches,
  });

  return { releaseId, candidates: rows.length, exactMatches, rangeMatches };
}
