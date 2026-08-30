import { createHash } from "node:crypto";
import { z } from "zod";
import {
  prisma,
  createNotification,
  NotificationType,
  agentBodySection,
  agentVerdictFromRun,
  type AgentVerdictSummary,
} from "@patchbay/db";
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
import { evaluatePolicy, evaluateFanoutCircuitBreaker } from "@patchbay/policy-engine";
import { rateLimitRedis } from "@patchbay/queue";
import type { Job } from "bullmq";
import { writeAuditEvent } from "../lib/audit";
import { assertInstallationBelongsToOrganization } from "../lib/repository-source";

export const CreatePRJobDataSchema = z.object({
  remediationPlanId: z.string().min(1),
  organizationId: z.string().min(1),
  correlationId: z.string().min(1),
});
export type CreatePRJobData = z.infer<typeof CreatePRJobDataSchema>;

export interface CreatePRResult {
  pullRequestId: string;
  url: string;
  branchName: string
}

/**
 * Deterministic remediation idempotency key format:
 * sha256Hex(`${organizationId}:${repositoryId}:${changeEventId}:${remediationPlanId}:${sourceHash}`)
 *
 * Used to derive a deterministic branch name:
 * `patchbay/remediation-${remediationKey.slice(0, 12)}`
 *
 * Guarantees:
 * 1. Provider-side PR deduplication (queries for existing PR on GitHub before opening a duplicate).
 * 2. Stable branch naming across worker retries.
 * 3. Database atomicity if worker dies between GitHub creation and DB commit.
 */
export function computeRemediationKey(params: {
  organizationId: string;
  repositoryId: string;
  changeEventId: string;
  remediationPlanId: string;
  sourceHash?: string | null;
}): string {
  const payload = [
    params.organizationId,
    params.repositoryId,
    params.changeEventId,
    params.remediationPlanId,
    params.sourceHash || "default",
  ].join(":");
  return createHash("sha256").update(payload).digest("hex");
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
  const startTime = Date.now();
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

  // Atomic PR slot reservation — prevents race conditions where two workers both read
  // the same PR count and both proceed, potentially exceeding the organization's concurrent PR limit.
  // INCR is atomic; TTL auto-releases on worker crash.
  // Redis unavailable is NOT a valid safety fallback — fail closed instead.
  const slotKey = `pr_slot:${organizationId}`;
  let newSlotCount: number;
  try {
    newSlotCount = await rateLimitRedis.incr(slotKey);
  } catch (error) {
    // Redis unavailable — fail closed. Automated PR creation cannot proceed when the
    // concurrency safety mechanism is untrusted. The remediation remains safely blocked
    // and can be retried once Redis recovers.
    await writeAuditEvent({
      organizationId,
      actorType: ActorType.SYSTEM,
      actorId: null,
      action: AuditAction.POLICY_BLOCKED,
      entityType: "remediationPlan",
      entityId: plan.id,
      correlationId,
      after: {
        reason: "Redis safety mechanism unreachable; automated PR creation blocked until recovery",
        safetyState: "UNAVAILABLE",
      },
    });
    logger.warn("PR creation blocked — Redis safety mechanism unreachable", {
      correlationId,
      organizationId,
      remediationPlanId: plan.id,
    });
    throw new Error(
      `PR creation safety unavailable: Redis is unreachable. Automated PR creation blocked until Redis recovers.`,
    );
  }
  if (newSlotCount === 1) {
    // First INCR — set TTL so the slot auto-releases if the worker crashes
    await rateLimitRedis.expire(slotKey, 86_400_000); // 24h TTL
  }
  if (newSlotCount > 5) {
    // Exceeded organization's concurrent PR limit — roll back the slot and block
    await rateLimitRedis.decr(slotKey);
    await writeAuditEvent({
      organizationId,
      actorType: ActorType.SYSTEM,
      actorId: null,
      action: AuditAction.POLICY_BLOCKED,
      entityType: "remediationPlan",
      entityId: plan.id,
      correlationId,
      after: {
        trippedLimit: "maxConcurrentDraftPrsPerOrg",
        observed: newSlotCount,
        threshold: 5,
      },
    });
    logger.warn("circuit breaker throttled PR creation — org PR quota exceeded", {
      correlationId,
      organizationId,
      remediationPlanId: plan.id,
      observedActivePRs: newSlotCount,
    });
    throw new Error(
      `PR creation throttled by circuit breaker: organization has reached its maximum concurrent draft PR limit`,
    );
  }
  // Slot acquired successfully; will be released in finally block after PR creation.

  try {
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
    const installationId = installationIdOf(repository.metadata);
    if (installationId) {
      // Tenant boundary: metadata installation ids are only usable when bound to
      // the repository's own organization (prevents cross-tenant PR creation).
      await assertInstallationBelongsToOrganization(installationId, repository.organizationId);
    }
    const fixtureDir = fixtureName ? resolveFixtureDir(fixtureName) : "";

    // Deterministic branch name derived from the remediation idempotency key
    const remediationKey = computeRemediationKey({
      organizationId,
      repositoryId: repository.id,
      changeEventId: plan.impactAssessment.changeEvent.id,
      remediationPlanId: plan.id,
      sourceHash: plan.patches[0]?.originalHash ?? null,
    });
    const branchName = `patchbay/remediation-${remediationKey.slice(0, 12)}`;

    const title = `[Patch] ${plan.impactAssessment.changeEvent.title}`;
    const agentVerdict = plan.remediationCaseId
      ? await loadSucceededAgentVerdict(organizationId, plan.remediationCaseId)
      : null;
    const body = buildPrBody(
      {
        repositoryName: repository.name,
        score: plan.impactAssessment.score,
        confidence: plan.confidence,
        rationale: plan.impactAssessment.rationale,
      },
      agentVerdict,
    );

    const provider =
      repository.provider === "GITHUB" && installationId
        ? createGitProviderFromEnv({
            installationId,
            repositoryFullName: repository.fullName,
            baseBranch: repository.defaultBranch,
          })
        : createGitProviderFromEnv();
    if (!fixtureName && repository.provider !== "GITHUB") {
      throw new Error(`repository ${repository.id} has no fixture metadata`);
    }

    const gitStartTime = Date.now();
    const prResult = await provider.createDraftPullRequest({
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
    const gitDurationMs = Date.now() - gitStartTime;

    // Idempotent database record creation: check if row was inserted during retry/race
    let pullRequestRecord = await prisma.pullRequest.findFirst({
      where: { remediationPlanId: plan.id },
    });
    if (!pullRequestRecord) {
      pullRequestRecord = await prisma.pullRequest.create({
        data: {
          organizationId,
          remediationPlanId: plan.id,
          provider: prResult.provider,
          branchName: prResult.branchName,
          url: prResult.url,
          externalId: prResult.externalId ?? null,
          status: PullRequestStatus.DRAFT,
        },
      });
    }

    await prisma.remediationPlan.update({
      where: { id: plan.id },
      data: { status: PlanStatus.PR_CREATED },
    });

    if (plan.remediationCaseId) {
      await prisma.$transaction([
        prisma.remediationCase.update({
          where: { id: plan.remediationCaseId },
          data: { status: "DRAFT_PR_CREATED" },
        }),
        prisma.remediationCaseEvent.create({
          data: {
            organizationId,
            remediationCaseId: plan.remediationCaseId,
            status: "DRAFT_PR_CREATED",
            reasonCode: plan.requiresHumanReview ? "approved" : "usage-evidence",
            detailJson: {
              remediationPlanId: plan.id,
              pullRequestId: pullRequestRecord.id,
              url: prResult.url,
              branchName: prResult.branchName,
            },
            correlationId,
          },
        }),
      ]);
    }

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
    await createNotification({
      organizationId,
      type: NotificationType.PR_CREATED,
      title: `Draft PR created: ${repository.name}`,
      body: `Branch ${prResult.branchName} — ${prResult.provider}`,
      correlationId,
    });

    const durationMs = Date.now() - startTime;
    logger.info("job completed", {
      correlationId,
      organizationId,
      repositoryId: repository.id,
      changeEventId: plan.impactAssessment.changeEventId,
      remediationPlanId: plan.id,
      pullRequestId: pullRequestRecord.id,
      jobName: "create-pr",
      durationMs,
      gitDurationMs,
      outcome: "PR_CREATED",
    });

    return {
      pullRequestId: pullRequestRecord.id,
      url: prResult.url,
      branchName: prResult.branchName,
    };
  } finally {
    // Release the atomic PR slot — decrements the Redis counter, making room for other workers
    await rateLimitRedis.decr(slotKey);
  }
}

function fixtureOf(metadata: unknown): string | null {
  if (typeof metadata !== "object" || metadata === null) return null;
  const fixture = (metadata as { fixture?: unknown }).fixture;
  return typeof fixture === "string" && fixture.length > 0 ? fixture : null;
}

function installationIdOf(metadata: unknown): number | null {
  if (typeof metadata !== "object" || metadata === null) return null;
  const value = (metadata as { installationId?: unknown }).installationId;
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function buildPrBody(
  plan: { repositoryName: string; score: number; confidence: number; rationale: string },
  verdict: AgentVerdictSummary | null,
): string {
  const base = `Automated remediation plan for ${plan.repositoryName}.\n\nImpact score: ${plan.score}\nConfidence: ${plan.confidence}\nRationale: ${plan.rationale}`;
  return verdict ? `${base}\n${agentBodySection(verdict)}` : base;
}

/**
 * The agent trail for a case is approval evidence, not a credential holder.
 * If the case has a SUCCEEDED AgentRun we reflect its planner/reviewer
 * verdict in the PR body; otherwise the body is built without the section.
 */
async function loadSucceededAgentVerdict(
  organizationId: string,
  remediationCaseId: string,
): Promise<AgentVerdictSummary | null> {
  const run = await prisma.agentRun.findFirst({
    where: { organizationId, remediationCaseId, status: "SUCCEEDED" },
    select: { outputJson: true },
    orderBy: { createdAt: "desc" },
  });
  if (!run) return null;
  return agentVerdictFromRun(run.outputJson);
}