import { z } from "zod";
import { prisma } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import {
  ActorType,
  PlanStatus,
  PullRequestStatus,
  ValidationStatus,
  logger,
} from "@patchbay/domain";
import { resolveFixtureDir } from "@patchbay/repo-analysis";
import { createGitProviderFromEnv } from "@patchbay/git-provider";
import { evaluatePolicy } from "@patchbay/policy-engine";
import type { Job } from "bullmq";
import { writeAuditEvent } from "../lib/audit";

export const CreatePRJobDataSchema = z.object({
  remediationPlanId: z.string().min(1),
  organizationId: z.string().min(1),
  correlationId: z.string().min(1),
});
export type CreatePRJobData = z.infer<typeof CreatePRJobDataSchema>;

export interface CreatePRResult {
  pullRequestId: string;
  url: string;
  branchName: string;
}

export async function processCreatePR(job: Job): Promise<CreatePRResult> {
  const parsed = CreatePRJobDataSchema.safeParse(job.data);
  if (!parsed.success) {
    throw new Error(`invalid create-pr job data: ${parsed.error.message}`);
  }
  const { remediationPlanId, organizationId, correlationId } = parsed.data;

  try {
    return await createDraftPR(remediationPlanId, organizationId, correlationId);
  } catch (error) {
    await writeAuditEvent({
      organizationId,
      actorType: ActorType.SYSTEM,
      actorId: null,
      action: AuditAction.PR_FAILED,
      entityType: "remediationPlan",
      entityId: remediationPlanId,
      correlationId,
      after: { error: error instanceof Error ? error.message : String(error) },
    });
    throw error;
  }
}

async function createDraftPR(
  remediationPlanId: string,
  organizationId: string,
  correlationId: string,
): Promise<CreatePRResult> {
  const plan = await prisma.remediationPlan.findUnique({
    where: { id: remediationPlanId },
    include: {
      impactAssessment: {
        include: {
          repository: true,
          changeEvent: true,
          affectedUsages: { include: { usage: true } },
        },
      },
      patches: true,
      validations: true,
      approvals: { orderBy: { createdAt: "desc" } },
      pullRequests: true,
    },
  });
  if (!plan) {
    throw new Error(`remediation plan not found: ${remediationPlanId}`);
  }

  // Tenant boundary: a plan may only be acted on by the organization that
  // owns its change event. Both the change event and the repository carry
  // organizationId — verify the plan belongs to the job's org before doing
  // anything (policy evaluation, git operations, audit writes).
  const changeOrgId = plan.impactAssessment.changeEvent.organizationId;
  const repositoryOrgId = plan.impactAssessment.repository.organizationId;
  if (changeOrgId !== organizationId || repositoryOrgId !== organizationId) {
    logger.warn("cross-tenant create-pr attempt blocked", {
      remediationPlanId: plan.id,
      requestedOrganizationId: organizationId,
      changeEventOrganizationId: changeOrgId,
      repositoryOrganizationId: repositoryOrgId,
    });
    throw new Error(
      `remediation plan ${remediationPlanId} does not belong to organization ${organizationId}`,
    );
  }

  // Idempotency check: Return existing PR if already created by a prior attempt
  if (plan.pullRequests && plan.pullRequests.length > 0) {
    const existingPR = plan.pullRequests[0]!;
    logger.info("pull request already exists for plan", {
      remediationPlanId: plan.id,
      pullRequestId: existingPR.id,
    });
    return {
      pullRequestId: existingPR.id,
      url: existingPR.url,
      branchName: existingPR.branchName,
    };
  }

  const latestApproval = plan.approvals[0];
  const hasPassingValidation = plan.validations.some(
    (val) => val.status === ValidationStatus.PASSED,
  );
  const riskTags = Array.from(
    new Set(
      plan.impactAssessment.affectedUsages.flatMap(
        (item) => (item.usage.riskTags as string[]) ?? [],
      ),
    ),
  );

  const policyResult = evaluatePolicy({
    confidence: plan.confidence,
    patchCount: plan.patches.length,
    requiresHumanReview: plan.requiresHumanReview,
    hasPassingValidation,
    approvalDecision: latestApproval?.decision ?? null,
    riskTags,
  });

  if (!policyResult.canCreatePR) {
    await writeAuditEvent({
      organizationId,
      actorType: ActorType.SYSTEM,
      actorId: null,
      action: AuditAction.POLICY_BLOCKED,
      entityType: "remediationPlan",
      entityId: plan.id,
      correlationId,
      after: { policyDecision: policyResult.decision, reasons: policyResult.reasons },
    });
    throw new Error(
      `PR creation blocked by policy decision '${policyResult.decision}': ${policyResult.reasons.join("; ")}`,
    );
  }

  const repository = plan.impactAssessment.repository;
  const fixtureName = fixtureOf(repository.metadata);
  if (!fixtureName) {
    throw new Error(`repository ${repository.id} has no fixture metadata`);
  }
  const fixtureDir = resolveFixtureDir(fixtureName);
  const branchName = `patchbay/remediation-${plan.id.slice(0, 8)}`;
  const title = `[Patchbay] ${plan.impactAssessment.changeEvent.title}`;
  const body = `Automated remediation plan for ${repository.name}.\n\nImpact score: ${plan.impactAssessment.score}\nConfidence: ${plan.confidence}\nRationale: ${plan.impactAssessment.rationale}`;

  const prResult = await createGitProviderFromEnv().createDraftPullRequest({
    repositoryName: repository.name,
    fixtureDir,
    branchName,
    title,
    body,
    patches: plan.patches.map((patch) => ({
      filePath: patch.filePath,
      patchedContent: patch.patchedContent,
    })),
  });

  const pullRequestRecord = await prisma.pullRequest.create({
    data: {
      remediationPlanId: plan.id,
      provider: prResult.provider,
      branchName: prResult.branchName,
      url: prResult.url,
      externalId: prResult.externalId ?? null,
      status: PullRequestStatus.DRAFT,
    },
  });

  await prisma.remediationPlan.update({
    where: { id: plan.id },
    data: { status: PlanStatus.PR_CREATED },
  });

  await writeAuditEvent({
    organizationId,
    actorType: ActorType.SYSTEM,
    actorId: null,
    action: AuditAction.PR_CREATED,
    entityType: "remediationPlan",
    entityId: plan.id,
    correlationId,
    after: {
      pullRequestId: pullRequestRecord.id,
      branchName: prResult.branchName,
      url: prResult.url,
    },
  });

  logger.info("pull request created", {
    remediationPlanId: plan.id,
    pullRequestId: pullRequestRecord.id,
    url: prResult.url,
  });

  return {
    pullRequestId: pullRequestRecord.id,
    url: prResult.url,
    branchName: prResult.branchName,
  };
}

function fixtureOf(metadata: unknown): string | null {
  if (typeof metadata !== "object" || metadata === null) return null;
  const fixture = (metadata as { fixture?: unknown }).fixture;
  return typeof fixture === "string" && fixture.length > 0 ? fixture : null;
}
