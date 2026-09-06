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
  buildEvidenceBlock,
  buildEvidenceHumanSection,
  checkRunDeliveryKey,
  commentDeliveryKey,
  createDeliveryKey,
  PlanStatus,
  PullRequestStatus,
  updateDeliveryKey,
  ValidationStatus,
  logger,
  type DeliveryEvidencePayload,
  type EvidenceHumanInput,
} from "@patchbay/domain";
import { resolveFixtureDir } from "@patchbay/repo-analysis";
import {
  createGitProviderFromEnv,
  type CheckRunConclusion,
  type GitProvider,
} from "@patchbay/git-provider";
import { approvalCoversPatches, evaluatePolicy, evaluateQuorum } from "@patchbay/policy-engine";
import { rateLimitRedis } from "@patchbay/queue";
import { requireCertified } from "@patchbay/vendor-connectors";
import { UnrecoverableError, type Job } from "bullmq";
import { checkDeliveryQuota, quotaBlockedMessage } from "@patchbay/operations";
import { writeAuditEvent } from "../lib/audit";
import { assertWorkerCapabilityGateOpen } from "../lib/capability-gates";
import { assertInstallationBelongsToOrganization } from "../lib/repository-source";
import {
  claimDeliveryAttempt,
  classifyDeliveryError,
  completeDeliveryAttempt,
  recordBestEffortAttempt,
} from "../lib/delivery-attempts";
import { ACQUIRE_LUA, RELEASE_LUA } from "@patchbay/queue";

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
  /** True when a case-advance refreshed an existing PR instead of opening one. */
  updated: boolean;
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
          changeEvent: { include: { vendor: { select: { slug: true } } } },
          affectedUsages: { include: { usage: true } },
        },
      },
      patches: true,
      validations: { include: { artifact: true }, orderBy: { createdAt: "desc" } },
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
  // anything (policy evaluation, git operations, audit writes). Contract-flow
  // assessments carry no change event (WP4): PR creation requires a release
  // change event, so such plans fail closed here until WP6 planning exists.
  const changeEvent = plan.impactAssessment.changeEvent;
  if (!changeEvent) {
    throw new Error(
      `remediation plan ${plan.id} has no change event: draft PRs require release-funnel evidence`,
    );
  }
  const changeOrgId = changeEvent.organizationId;
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

  // Gate parity with the web PR vectors (WP5): certification kit + kill-switch
  // gate, enforced identically here. A suspended or uncertified vendor fails
  // loudly into the job DLQ path (alert + audit) instead of opening a PR the
  // web routes would refuse.
  const vendorSlug = changeEvent.vendor.slug;
  const certification = requireCertified(vendorSlug, "DRAFT_PR");
  if (!certification.ok) {
    await writeAuditEvent({
      organizationId,
      actorType: ActorType.SYSTEM,
      actorId: null,
      action: AuditAction.POLICY_BLOCKED,
      entityType: "remediationPlan",
      entityId: plan.id,
      correlationId,
      after: {
        reason: `connector ${vendorSlug} is not certified for DRAFT_PR`,
        certificationReasons: certification.reasons,
      },
    });
    throw new Error(
      `PR creation blocked: connector ${vendorSlug} is not certified for DRAFT_PR: ${certification.reasons.join("; ")}`,
    );
  }
  await assertWorkerCapabilityGateOpen(organizationId, vendorSlug, "DRAFT_PR");

  // Server-side delivery quota (WP11, spec §16): the monthly draft-PR budget
  // is enforced here — not just at registration — so direct enqueues and
  // retry storms cannot overshoot it. Unrecoverable: retrying inside the same
  // month is futile, so the job fails terminally with audits (never silent,
  // never retried blindly).
  const quota = await checkDeliveryQuota(prisma, { organizationId, kind: "DRAFT_PR" });
  if (!quota.allowed) {
    const message = quotaBlockedMessage(quota);
    await writeAuditEvent({
      organizationId,
      actorType: ActorType.SYSTEM,
      actorId: null,
      action: AuditAction.POLICY_BLOCKED,
      entityType: "remediationPlan",
      entityId: plan.id,
      correlationId,
      after: {
        reason: "delivery quota exceeded",
        tier: quota.tier,
        quota: quota.quota,
        used: quota.used,
        periodStart: quota.periodStart.toISOString(),
      },
    });
    throw new UnrecoverableError(message);
  }

  const repository = plan.impactAssessment.repository;

  // Deterministic branch name derived from the remediation idempotency key.
  // Computed before the early return so pre-WP9 PR rows can be backfilled
  // into the ledger with the same key a retry would claim.
  const remediationKey = computeRemediationKey({
    organizationId,
    repositoryId: repository.id,
    changeEventId: changeEvent.id,
    remediationPlanId: plan.id,
    sourceHash: plan.patches[0]?.originalHash ?? null,
  });
  const branchName = `patchbay/remediation-${remediationKey.slice(0, 12)}`;

  // Idempotency check: return the existing PR when a prior attempt already
  // delivered this plan. Pre-WP9 rows predate the ledger: backfill a
  // SUCCEEDED CREATE attempt so the ledger is complete (a key conflict means
  // an earlier retry already backfilled — skip silently, still no duplicate).
  if (plan.pullRequests && plan.pullRequests.length > 0) {
    const existingPR = plan.pullRequests[0]!;
    logger.info("pull request already exists for plan", {
      remediationPlanId: plan.id,
      pullRequestId: existingPR.id,
    });
    await recordBestEffortAttempt({
      organizationId,
      remediationPlanId: plan.id,
      pullRequestId: existingPR.id,
      idempotencyKey: createDeliveryKey("CREATE", remediationKey),
      action: "CREATE",
      status: "SUCCEEDED",
      externalId: existingPR.externalId ?? null,
      url: existingPR.url,
    });
    return {
      pullRequestId: existingPR.id,
      url: existingPR.url,
      branchName: existingPR.branchName,
      updated: false,
    };
  }

  // Case-version advance (WP9): when the case already carries a PR from a
  // prior plan, refresh THAT PR (same branch, new commit, current evidence
  // body) instead of orphaning it with a second PR. The newest sibling wins;
  // pre-WP9 duplicate orphans converge onto the latest row from here on.
  const siblingPR = plan.remediationCaseId
    ? await prisma.pullRequest.findFirst({
        where: { remediationPlan: { remediationCaseId: plan.remediationCaseId } },
        orderBy: { createdAt: "desc" },
      })
    : null;
  const isUpdate = siblingPR !== null;
  const idempotencyKey = isUpdate
    ? updateDeliveryKey(plan.id)
    : createDeliveryKey("CREATE", remediationKey);
  const claim = await claimDeliveryAttempt({
    organizationId,
    remediationPlanId: plan.id,
    idempotencyKey,
    action: isUpdate ? "UPDATE" : "CREATE",
  });
  if (claim.duplicate) {
    // A prior attempt (this retry's predecessor or a concurrent worker)
    // already delivered: return its PR, never deliver twice.
    const winnerPR = claim.attempt.pullRequestId
      ? await prisma.pullRequest.findUnique({ where: { id: claim.attempt.pullRequestId } })
      : null;
    const row =
      winnerPR ?? (await prisma.pullRequest.findFirst({ where: { remediationPlanId: plan.id } }));
    if (!row) {
      throw new Error(
        `delivery ledger reports success for ${idempotencyKey} but no pull request row exists; retrying`,
      );
    }
    return { pullRequestId: row.id, url: row.url, branchName: row.branchName, updated: isUpdate };
  }
  const attemptId = claim.attemptId;
  const markAttemptFailed = async (error: unknown): Promise<void> => {
    const message = error instanceof Error ? error.message : String(error);
    await completeDeliveryAttempt(attemptId, {
      status: "FAILED",
      errorCode: classifyDeliveryError(error),
      errorMessage: message,
    });
  };

  // Atomic PR slot reservation — INCR + limit check + TTL in one Lua op.
  // Imported from @patchbay/queue: ACQUIRE_LUA, RELEASE_LUA
  const PR_SLOT_TTL_SECONDS = 86400;
  let evalResult: [number, number];
  const slotKey = `pr_slot:${organizationId}`;
  try {
    evalResult = (await rateLimitRedis.eval(
      ACQUIRE_LUA,
      1,
      slotKey,
      "5",
      String(PR_SLOT_TTL_SECONDS),
    )) as [number, number];
  } catch {
    const error = new Error(
      `PR creation safety unavailable: Redis is unreachable. Automated PR creation blocked until Redis recovers.`,
    );
    await markAttemptFailed(error);
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
  const allowed = evalResult[0] === 1;
  const newSlotCount = evalResult[1];
  if (!allowed) {
    const error = new Error(
      `PR creation throttled by circuit breaker: organization has reached its maximum concurrent draft PR limit`,
    );
    await markAttemptFailed(error);
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
    const patchedContents = plan.patches.map((patch) => patch.patchedContent);
    const coverage = approvalCoversPatches(
      latestApproval
        ? {
            decision: latestApproval.decision,
            patchedHash: latestApproval.patchedHash,
            expiresAt: latestApproval.expiresAt,
          }
        : null,
      patchedContents,
    );
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
      approvalDecision: coverage.covered ? (latestApproval?.decision ?? null) : null,
      riskTags,
      // Defense in depth with the draft-pr route: quorum-tagged plans need
      // two distinct covering approvers even if they reach this worker.
      quorum: evaluateQuorum(
        plan.approvals.map((approval) => ({
          userId: approval.userId,
          decision: approval.decision,
          patchedHash: approval.patchedHash,
          expiresAt: approval.expiresAt,
        })),
        patchedContents,
        riskTags,
      ),
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

    const fixtureName = fixtureOf(repository.metadata);
    const installationId = installationIdOf(repository.metadata);
    if (installationId) {
      // Tenant boundary: metadata installation ids are only usable when bound to
      // the repository's own organization (prevents cross-tenant PR creation).
      await assertInstallationBelongsToOrganization(installationId, repository.organizationId);
    }
    const fixtureDir = fixtureName ? resolveFixtureDir(fixtureName) : "";

    const title = `[Patch] ${changeEvent.title}`;
    const agentVerdict = plan.remediationCaseId
      ? await loadSucceededAgentVerdict(organizationId, plan.remediationCaseId)
      : null;
    const passingValidation = plan.validations.find(
      (val) => val.status === ValidationStatus.PASSED,
    );
    const latestValidation = passingValidation ?? plan.validations[0] ?? null;
    const validationStatus = latestValidation?.status ?? "NO_RUNS";
    const validationArtifact = passingValidation?.artifact ?? null;
    // Case version = 1-based index of this plan among the case's plans. No
    // schema counter needed: ordering by creation is deterministic and the
    // evidence block pins the number it was delivered as.
    const caseVersion = plan.remediationCaseId
      ? await prisma.remediationPlan.count({
          where: { remediationCaseId: plan.remediationCaseId, createdAt: { lte: plan.createdAt } },
        })
      : 1;

    const evidencePayload: DeliveryEvidencePayload = {
      version: 1,
      // Normalize to null: Prisma returns null for the unset FK, but a
      // missing property (undefined) must never reach the evidence schema.
      caseId: plan.remediationCaseId ?? null,
      remediationPlanId: plan.id,
      caseVersion,
      policyDecision: policyResult.decision,
      policyReasons: policyResult.reasons,
      validationStatus,
      validationRunId: latestValidation?.id ?? null,
      validationArtifactHash: validationArtifact?.artifactHash ?? null,
      commandsExecuted: validationArtifact?.commandsExecuted ?? [],
      imageDigest: validationArtifact?.imageDigest ?? null,
      riskTags,
      affectedUsageCount: plan.impactAssessment.affectedUsages.length,
      patchCount: plan.patches.length,
      approvalDecision: latestApproval?.decision ?? null,
      agentVerdict: agentVerdict?.reviewSummary ?? null,
      correlationId,
      createdAt: new Date().toISOString(),
    };
    const evidenceHuman: EvidenceHumanInput = {
      repositoryName: repository.name,
      branchName: siblingPR ? siblingPR.branchName : branchName,
      baseBranch: repository.defaultBranch,
      caseVersion,
      policyDecision: policyResult.decision,
      policyReasons: policyResult.reasons,
      validationStatus,
      validationArtifactHash: validationArtifact?.artifactHash ?? null,
      approvalDecision: latestApproval?.decision ?? null,
      riskTags,
      affectedUsageCount: plan.impactAssessment.affectedUsages.length,
      patchCount: plan.patches.length,
    };
    const body = buildPrBody(evidencePayload, evidenceHuman, agentVerdict);

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
    const patchInputs = plan.patches.map((patch) => ({
      filePath: patch.filePath,
      patchedContent: patch.patchedContent,
    }));
    let pullRequestRecord: {
      id: string;
      url: string;
      branchName: string;
      externalId: string | null;
    };
    let headSha: string | undefined;
    let gitDurationMs = 0;

    if (siblingPR) {
      // UPDATE: same branch, new commit, refreshed evidence — no orphan PR.
      if (typeof provider.syncBranchWithPatches === "function") {
        const synced = await provider.syncBranchWithPatches({
          branchName: siblingPR.branchName,
          base: repository.defaultBranch,
          title,
          patches: patchInputs,
        });
        headSha = synced.commitSha;
      }
      // Local/demo rows carry no remote number: repoint only, no remote call.
      const prNumber = parseExternalId(siblingPR.externalId);
      if (prNumber !== null) {
        if (typeof provider.updatePullRequest !== "function") {
          throw new Error(
            `delivery provider cannot update PR #${prNumber} on ${repository.fullName}; ` +
              "refusing to repoint the row without refreshing the remote",
          );
        }
        await provider.updatePullRequest({ number: prNumber, title, body });
      }
      gitDurationMs = Date.now() - gitStartTime;
      pullRequestRecord = await prisma.pullRequest.update({
        where: { id: siblingPR.id },
        data: { remediationPlanId: plan.id, status: PullRequestStatus.DRAFT },
      });
      await writeAuditEvent({
        organizationId,
        actorType: ActorType.SYSTEM,
        actorId: null,
        action: AuditAction.PR_UPDATED,
        entityType: "remediationPlan",
        entityId: plan.id,
        correlationId,
        after: {
          pullRequestId: pullRequestRecord.id,
          branchName: pullRequestRecord.branchName,
          url: pullRequestRecord.url,
          caseVersion,
          supersedesPlanId: siblingPR.remediationPlanId,
        },
      });
    } else {
      const prResult = await provider.createDraftPullRequest({
        repositoryName: repository.name,
        fixtureDir,
        branchName,
        title,
        body,
        patches: patchInputs,
      });
      headSha = prResult.headSha;
      gitDurationMs = Date.now() - gitStartTime;

      // Idempotent database record creation: check if row was inserted during retry/race
      const existingRow = await prisma.pullRequest.findFirst({
        where: { remediationPlanId: plan.id },
      });
      pullRequestRecord =
        existingRow ??
        (await prisma.pullRequest.create({
          data: {
            organizationId,
            remediationPlanId: plan.id,
            provider: prResult.provider,
            branchName: prResult.branchName,
            url: prResult.url,
            externalId: prResult.externalId ?? null,
            status: PullRequestStatus.DRAFT,
          },
        }));
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
            reasonCode: isUpdate
              ? "case-version-advance"
              : plan.requiresHumanReview
                ? "approved"
                : "usage-evidence",
            detailJson: {
              remediationPlanId: plan.id,
              pullRequestId: pullRequestRecord.id,
              url: pullRequestRecord.url,
              branchName: pullRequestRecord.branchName,
            },
            correlationId,
          },
        }),
      ]);
    }

    await completeDeliveryAttempt(attemptId, {
      status: "SUCCEEDED",
      pullRequestId: pullRequestRecord.id,
      externalId: pullRequestRecord.externalId,
      url: pullRequestRecord.url,
    });
    await createNotification({
      organizationId,
      type: NotificationType.PR_CREATED,
      title: isUpdate
        ? `Draft PR updated: ${repository.name}`
        : `Draft PR created: ${repository.name}`,
      body: `Branch ${pullRequestRecord.branchName} — case version ${caseVersion}`,
      correlationId,
    });

    // Best-effort validation reporting: the PR is delivered either way, so a
    // check-run failure degrades to a status comment and never fails delivery.
    await reportCheckRunBestEffort({
      provider,
      organizationId,
      remediationPlanId: plan.id,
      pullRequestId: pullRequestRecord.id,
      headSha,
      prNumber: parseExternalId(pullRequestRecord.externalId),
      conclusion:
        validationStatus === ValidationStatus.PASSED
          ? "success"
          : validationStatus === ValidationStatus.FAILED
            ? "failure"
            : "neutral",
      summary:
        `Patchbay validation ${validationStatus} — policy ${policyResult.decision}` +
        (validationArtifact?.artifactHash
          ? ` — artifact ${validationArtifact.artifactHash.slice(0, 12)}`
          : ""),
      text: buildEvidenceHumanSection(evidenceHuman),
      commentFallbackBody:
        `Patchbay delivery ${isUpdate ? "update" : "report"} (case version ${caseVersion}): ` +
        `validation ${validationStatus}, policy ${policyResult.decision}. ` +
        `Full evidence is in the PR body machine block.`,
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
      outcome: isUpdate ? "PR_UPDATED" : "PR_CREATED",
    });

    return {
      pullRequestId: pullRequestRecord.id,
      url: pullRequestRecord.url,
      branchName: pullRequestRecord.branchName,
      updated: isUpdate,
    };
  } catch (error) {
    await markAttemptFailed(error);
    throw error;
  } finally {
    try {
      await rateLimitRedis.eval(RELEASE_LUA, 1, slotKey);
    } catch {
      try {
        await rateLimitRedis.decr(slotKey);
      } catch {
        // ignore
      }
    }
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

/**
 * Full §7.4 body: machine evidence block + human summary, with the agent
 * verdict section appended when one exists (unchanged format).
 */
function buildPrBody(
  payload: DeliveryEvidencePayload,
  human: EvidenceHumanInput,
  verdict: AgentVerdictSummary | null,
): string {
  const block = buildEvidenceBlock(payload, human);
  return verdict ? `${block}\n${agentBodySection(verdict)}` : block;
}

/** Numeric GitHub PR numbers only; local/demo rows carry null externalIds. */
function parseExternalId(externalId: string | null | undefined): number | null {
  if (!externalId || !/^\d+$/.test(externalId)) return null;
  const parsed = Number.parseInt(externalId, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Best-effort validation reporting (WP9). Skipped without a head SHA or a
 * check-run-capable provider (local/demo, roadmap stubs). A check-run
 * failure degrades to a status comment; a comment failure degrades to a
 * ledger row + warning. Delivery itself NEVER fails here — the PR is real
 * and the evidence block is already on it.
 */
async function reportCheckRunBestEffort(input: {
  provider: GitProvider;
  organizationId: string;
  remediationPlanId: string;
  pullRequestId: string;
  headSha?: string;
  prNumber: number | null;
  conclusion: CheckRunConclusion;
  summary: string;
  text: string;
  commentFallbackBody: string;
}): Promise<void> {
  const { provider } = input;
  if (!input.headSha || typeof provider.createCheckRun !== "function") return;
  const idempotencyKey = checkRunDeliveryKey(input.remediationPlanId, input.headSha);
  let attemptId: string;
  try {
    const created = await prisma.deliveryAttempt.create({
      data: {
        organizationId: input.organizationId,
        remediationPlanId: input.remediationPlanId,
        pullRequestId: input.pullRequestId,
        idempotencyKey,
        action: "CHECK_RUN",
        status: "IN_PROGRESS",
        attemptCount: 1,
      },
    });
    attemptId = created.id;
  } catch (error) {
    // An identical report already landed on retry — skip, don't re-post.
    if ((error as { code?: unknown }).code === "P2002") return;
    throw error;
  }
  try {
    const run = await provider.createCheckRun({
      headSha: input.headSha,
      name: "patchbay-validation",
      conclusion: input.conclusion,
      summary: input.summary,
      text: input.text,
    });
    await completeDeliveryAttempt(attemptId, {
      status: "SUCCEEDED",
      pullRequestId: input.pullRequestId,
      externalId: String(run.id),
      url: run.htmlUrl,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (input.prNumber !== null && typeof provider.createIssueComment === "function") {
      try {
        const comment = await provider.createIssueComment({
          number: input.prNumber,
          body: input.commentFallbackBody,
        });
        await recordBestEffortAttempt({
          organizationId: input.organizationId,
          remediationPlanId: input.remediationPlanId,
          pullRequestId: input.pullRequestId,
          idempotencyKey: commentDeliveryKey(input.remediationPlanId, "checkrun-fallback"),
          action: "COMMENT",
          status: "SUCCEEDED",
          externalId: String(comment.id),
          url: comment.htmlUrl,
        });
        await completeDeliveryAttempt(attemptId, {
          status: "FAILED",
          pullRequestId: input.pullRequestId,
          errorCode: classifyDeliveryError(error),
          errorMessage: `check run failed, fell back to status comment: ${message}`,
        });
        return;
      } catch {
        // Comment fallback failed too — record below and move on.
      }
    }
    await completeDeliveryAttempt(attemptId, {
      status: "FAILED",
      pullRequestId: input.pullRequestId,
      errorCode: classifyDeliveryError(error),
      errorMessage: message,
    });
    logger.warn("validation check run reporting failed; delivery stands", {
      remediationPlanId: input.remediationPlanId,
      pullRequestId: input.pullRequestId,
      error: message.slice(0, 500),
    });
  }
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
