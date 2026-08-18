import { z } from "zod";
import { prisma } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import { ActorType, evaluateReleaseMatch, logger } from "@patchbay/domain";
import type { Job } from "bullmq";
import { writeAuditEvent } from "../lib/audit";
import {
  evaluateCasePolicies,
  upsertRemediationCase,
  type CasePolicyFacts,
  type CasePolicyRule,
} from "../lib/case-ops";

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
 *
 * WP3: after matches exist, the policy-first funnel reconciles one
 * RemediationCase per match (scopeKey = release:repository:dependency:
 * snapshot). Eligible matches promote to REMEDIATE; held matches stay
 * visible at IMPACT_CONFIRMED with a reasonCode and never enqueue a plan.
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
  casesCreated: number;
  planEligible: number;
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

  let casesCreated = 0;
  let planEligible = 0;
  if (rows.length > 0) {
    const funnel = await reconcileCasesForRelease(
      releaseId,
      release.product.vendorId,
      correlationId,
    );
    casesCreated = funnel.casesCreated;
    planEligible = funnel.planEligible;
  }

  logger.info("release matched", {
    releaseId,
    correlationId,
    version: release.version,
    packageName: release.product.packageName,
    candidates: rows.length,
    exactMatches,
    rangeMatches,
    casesCreated,
    planEligible,
  });

  return {
    releaseId,
    candidates: rows.length,
    exactMatches,
    rangeMatches,
    casesCreated,
    planEligible,
  };
}

/**
 * WP3 funnel: for every match of this release, build case-level evidence
 * (classification, READY snapshot at the dependency commit, usage inventory),
 * evaluate the tenant's enabled policies, and reconcile the RemediationCase.
 * Matches that become plan-eligible promote to REMEDIATE.
 */
async function reconcileCasesForRelease(
  releaseId: string,
  vendorId: string,
  correlationId: string,
): Promise<{ casesCreated: number; planEligible: number }> {
  const release = await prisma.releaseRecord.findUnique({
    where: { id: releaseId },
    include: {
      product: { include: { vendor: true } },
      classifications: true,
    },
  });
  if (!release) return { casesCreated: 0, planEligible: 0 };

  const vendorSlug = release.product.vendor.slug;
  const classification = release.classifications[0];
  const classificationFacts = (classification?.factsJson ?? null) as {
    breaking?: boolean;
  } | null;
  const breaking = Boolean(classificationFacts?.breaking);

  const matches = await prisma.releaseRepositoryMatch.findMany({
    where: { releaseRecordId: releaseId },
    include: { dependency: true, repository: true },
  });

  let casesCreated = 0;
  let planEligible = 0;

  for (const match of matches) {
    const snapshot = await prisma.graphSnapshot.findFirst({
      where: {
        repositoryId: match.repositoryId,
        commitSha: match.dependency.commitSha,
        status: "READY",
      },
      select: { id: true },
    });

    const usages = await prisma.integrationUsage.findMany({
      where: { repositoryId: match.repositoryId, vendorId },
      select: { riskTags: true, ownerHint: true },
    });
    const riskTags = [...new Set(usages.flatMap((usage) => usage.riskTags))];
    const ownerCount = new Set(usages.map((usage) => usage.ownerHint)).size;

    const policies = (await prisma.policy.findMany({
      where: { organizationId: match.organizationId, enabled: true },
      select: { id: true, name: true, enabled: true, definitionJson: true },
    })) as unknown as CasePolicyRule[];

    const policyEvaluation = evaluateCasePolicies(policies, {
      riskTags,
      vendor: vendorSlug,
      validationStatus: "none",
    } satisfies CasePolicyFacts);

    const result = await upsertRemediationCase(
      {
        organizationId: match.organizationId,
        releaseId,
        repositoryId: match.repositoryId,
        dependencyId: match.dependencyId,
        matchId: match.id,
        snapshotId: snapshot?.id ?? null,
        vendorSlug,
        correlationId,
      },
      {
        hasClassification: classification !== null,
        breaking,
        affectedUsageCount: usages.length,
        ownerCount,
        riskTags,
        hasSnapshot: snapshot !== null,
      },
      classification?.requiresHumanReview ?? false,
      policyEvaluation,
      correlationId,
    );

    if (result.created) casesCreated += 1;
    if (result.status === "POLICY_ELIGIBLE") {
      planEligible += 1;
      if (match.status !== "REMEDIATE") {
        await prisma.releaseRepositoryMatch.update({
          where: { id: match.id },
          data: { status: "REMEDIATE" },
        });
      }
    }
  }

  return { casesCreated, planEligible };
}
