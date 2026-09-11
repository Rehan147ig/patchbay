import { z } from "zod";
import { prisma, Prisma, packageImpact } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import { ActorType, logger } from "@patchbay/domain";
import { createAiProvider } from "@patchbay/ai-provider";
import { digestJson, type JsonValue } from "@patchbay/ai-harness";
import { getConnector } from "@patchbay/vendor-connectors";
import type { Job } from "bullmq";
import {
  agentTools,
  buildAgentWorkflowInput,
  createAgentWorkflow,
  finishAgentWorkflow,
  isAgentRunCancelled,
  markAgentRunRunning,
  type AgentRunWithRelations,
  type FactsJson,
  type SnapshotBinding,
  type StepRecording,
} from "../lib/agent-workflow";
import { recordRemediationAttempt } from "../lib/case-orchestration";
import {
  SnapshotUnavailableError,
  buildSnapshotForRepository,
  checkoutSnapshotForApply,
  collectSnapshotExcerpts,
} from "../lib/repository-snapshot";
import { writeAuditEvent } from "../lib/audit";

/**
 * agent-plan processor (roadmap Phase H4): the Mastra-contract workflow
 * invoked by this BullMQ job.
 *
 * Steps (typed, recorded AgentStep rows, separate tool allowlists):
 *  release-analyst (getReleaseFacts) and impact-analyst
 *  (getAffectedUsageSubgraph) run in parallel -> planner model call
 *  (no tools) -> reviewer model call (no tools). Two evaluation gates
 *  (plan-gate, review-gate) are recorded on the run before the run can be
 *  used as approval evidence for a draft PR.
 *
 * Failure mapping: adapter failures become BUDGET_EXCEEDED / FAILED /
 * CANCELLED run statuses; the run input and step records are persisted so a
 * later agent-replay job can re-execute from the failure boundary.
 */
export const AgentPlanJobDataSchema = z.object({
  agentRunId: z.string().min(1),
  correlationId: z.string().min(1),
});
export type AgentPlanJobData = z.infer<typeof AgentPlanJobDataSchema>;

const DEFAULT_RUN_BUDGET_CENTS = 100;

function runBudgetCents(): number {
  const raw = process.env.AI_RUN_BUDGET_CENTS;
  const parsed = raw === undefined ? NaN : Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RUN_BUDGET_CENTS;
}

export async function processAgentPlan(job: Job): Promise<void> {
  const parsed = AgentPlanJobDataSchema.safeParse(job.data);
  if (!parsed.success) throw new Error(`invalid agent-plan job data: ${parsed.error.message}`);
  const { agentRunId, correlationId } = parsed.data;

  const loaded = await loadAgentRun(agentRunId);
  if (!loaded) throw new Error(`agent run not found: ${agentRunId}`);
  const run = loaded.run;

  if (run.status === "CANCELLED") {
    logger.info("agent run already cancelled; skipping", { agentRunId, correlationId });
    return;
  }
  if (
    run.status === "RUNNING" ||
    run.status === "SUCCEEDED" ||
    run.status === "FAILED" ||
    run.status === "BUDGET_EXCEEDED"
  ) {
    throw new Error(`agent run not in QUEUED state: ${run.status}`);
  }

  const facts = classificationFacts(run);
  // WP6 pack, resolved from the static registry (uncertified vendors yield
  // null → global caps only). Part of the persisted workflow input, so replay
  // identity covers which budget the plan ran under.
  const rulePack = getConnector(run.releaseRecord.product.vendor.slug)?.rulePack ?? null;
  const input = buildAgentWorkflowInput(run, facts, rulePack);
  // P1: snapshot BEFORE any model spend. A snapshot failure becomes a
  // pre-model PLAN_ONLY/SNAPSHOT_UNAVAILABLE outcome — the planner never runs,
  // zero tokens are spent, and all edits stay invalidated by construction.
  let snapshot: SnapshotBinding;
  try {
    snapshot = await resolveSnapshotBinding(run);
  } catch (error) {
    if (error instanceof SnapshotUnavailableError) {
      await recordSnapshotUnavailable(
        run,
        correlationId,
        input,
        error.message,
        rulePack?.packVersion ?? null,
      );
      return;
    }
    throw error;
  }
  const provider = createAiProvider(process.env);
  await markAgentRunRunning({
    run,
    correlationId,
    input,
    budgetCents: runBudgetCents(),
    model: providerLabel(),
    provider: providerKind(),
  });
  if (await isAgentRunCancelled(run.id)) return;

  const recordStep = makeStepRecorder(run);
  const workflow = createAgentWorkflow({
    run,
    provider,
    budgetCents: runBudgetCents(),
    snapshot,
    recordStep,
    isCancelled: () => isAgentRunCancelled(run.id),
    rulePack,
  });

  const result = await workflow.run(input as never, { tools: agentTools({ run, facts }) });

  const outcome = await finishAgentWorkflow({
    run,
    correlationId,
    input,
    result,
  });
  // WP7 attempt provenance: every executed run records its strategy attempt
  // (best-effort inside — recording never breaks reconciliation). Cancelled
  // and budget-exhausted runs record FAILED with the abort/budget message;
  // runs without a linked case skip honestly.
  await recordRemediationAttempt({
    caseId: run.remediationCaseId ?? null,
    strategyId: "agent-plan",
    rulePackVersion: rulePack?.packVersion ?? null,
    agentRunId: run.id,
    inputHash: digestJson(input as unknown as JsonValue),
    outputHash: result.output ? digestJson(result.output) : undefined,
    status: outcome.status === "SUCCEEDED" ? "SUCCEEDED" : "FAILED",
    failureCode: outcome.failureMessage ? outcome.failureMessage.slice(0, 200) : undefined,
    organizationId: run.organizationId,
    correlationId,
  });
  const planner = result.output?.["planner"] as
    | { plan?: { edits?: unknown[] }; invalidated?: unknown[]; snapshotId?: string | null }
    | undefined;
  // Case timeline first: failures must append their timeline entry even though
  // the job then throws (a FAILED run that skips its timeline lies by omission).
  // A partially invalidated plan NEVER becomes PATCH_PROPOSED: it stays
  // PLAN_ONLY with audit evidence explaining why (fail closed, no partial patch).
  await recordCaseOutcome(
    run,
    outcome,
    correlationId,
    planner?.plan?.edits?.length ?? 0,
    Array.isArray(planner?.invalidated) ? planner.invalidated.length : 0,
  );
  if (outcome.status !== "SUCCEEDED" && outcome.failureMessage) {
    throw new Error(outcome.failureMessage);
  }
}

/**
 * WP3 + snapshot boundary: reflect the plan run on its RemediationCase.
 * - Success with fully bound edits -> PATCH_PROPOSED;
 * - success with zero edits -> PLAN_ONLY;
 * - success with ANY invalidated edits -> PLAN_ONLY (never a partial patch);
 * - failures leave the case at PLANNING (retryable) + timeline event.
 */
async function recordCaseOutcome(
  run: AgentRunWithRelations,
  outcome: { status: string; failureMessage: string | null },
  correlationId: string,
  editCount: number,
  invalidatedCount = 0,
): Promise<void> {
  if (!run.remediationCaseId) return;
  const existing = await prisma.remediationCase.findUnique({
    where: { id: run.remediationCaseId },
    select: { id: true, status: true, reasonCode: true },
  });
  if (!existing) return;

  if (outcome.status === "SUCCEEDED") {
    if (existing.status === "PLANNING" || existing.status === "POLICY_ELIGIBLE") {
      const next = editCount === 0 || invalidatedCount > 0 ? "PLAN_ONLY" : "PATCH_PROPOSED";
      await prisma.$transaction([
        prisma.remediationCase.update({
          where: { id: existing.id },
          data: { status: next },
        }),
        prisma.remediationCaseEvent.create({
          data: {
            organizationId: run.organizationId,
            remediationCaseId: existing.id,
            status: next,
            reasonCode: existing.reasonCode,
            detailJson: {
              agentRunId: run.id,
              editCount,
              invalidatedCount,
              boundOutcome:
                invalidatedCount > 0
                  ? "INVALIDATED"
                  : editCount === 0
                    ? "PLAN_ONLY"
                    : "PATCH_PROPOSED",
            },
            correlationId,
          },
        }),
      ]);
    }
    return;
  }

  await prisma.remediationCaseEvent.create({
    data: {
      organizationId: run.organizationId,
      remediationCaseId: existing.id,
      status: existing.status,
      reasonCode: existing.reasonCode,
      detailJson: {
        agentRunId: run.id,
        failure: outcome.failureMessage,
      },
      correlationId,
    },
  });
}

export async function loadAgentRun(agentRunId: string): Promise<{
  run: AgentRunWithRelations;
} | null> {
  const record = await prisma.agentRun.findUnique({
    where: { id: agentRunId },
    select: {
      id: true,
      organizationId: true,
      releaseRecordId: true,
      repositoryId: true,
      releaseRepositoryMatchId: true,
      remediationCaseId: true,
      status: true,
      inputJson: true,
      outputJson: true,
      budgetCents: true,
      model: true,
      provider: true,
      startedAt: true,
      repository: true,
      match: {
        include: { dependency: true },
      },
      releaseRecord: {
        include: {
          product: { include: { vendor: true } },
          classifications: true,
        },
      },
    },
  });
  if (!record) return null;
  return {
    run: {
      id: record.id,
      organizationId: record.organizationId,
      releaseRecordId: record.releaseRecordId,
      repositoryId: record.repositoryId,
      releaseRepositoryMatchId: record.releaseRepositoryMatchId,
      remediationCaseId: record.remediationCaseId,
      status: record.status,
      repository: record.repository,
      match: record.match,
      inputJson: record.inputJson,
      outputJson: record.outputJson,
      budgetCents: record.budgetCents,
      model: record.model,
      provider: record.provider,
      startedAt: record.startedAt,
      releaseRecord: {
        version: record.releaseRecord.version,
        product: {
          packageName: record.releaseRecord.product.packageName,
          vendor: { slug: record.releaseRecord.product.vendor.slug },
        },
        classifications: record.releaseRecord.classifications,
      },
    },
  };
}

function classificationFacts(run: AgentRunWithRelations): FactsJson | null {
  const classification = run.releaseRecord.classifications[0];
  return (classification?.factsJson ?? null) as FactsJson | null;
}

function makeStepRecorder(run: AgentRunWithRelations): (recording: StepRecording) => Promise<void> {
  return async (recording) => {
    const startedAt = Date.now();
    const step = await prisma.agentStep.create({
      data: {
        organizationId: run.organizationId,
        agentRunId: run.id,
        role: recording.role,
        kind: recording.kind,
        toolName: recording.toolName ?? undefined,
        inputDigest: recording.inputDigest,
      },
    });
    await prisma.agentStep.update({
      where: { id: step.id },
      data: {
        status: "COMPLETED",
        outputJson: recording.outputJson as Prisma.InputJsonValue,
        tokenUsage: recording.tokenUsage as Prisma.InputJsonValue | undefined,
        providerRequestId: recording.providerRequestId ?? undefined,
        latencyMs: Date.now() - startedAt + recording.latencyMs,
        completedAt: new Date(),
      },
    });
  };
}

function isFixtureRepo(run: AgentRunWithRelations): boolean {
  const metadata = (run.repository as { metadata?: unknown }).metadata;
  if (typeof metadata !== "object" || metadata === null) return false;
  const fixture = (metadata as { fixture?: unknown }).fixture;
  return typeof fixture === "string" && fixture.length > 0;
}

/**
 * Derives the exact commit the graph analyzed — never HEAD. Preference:
 * live impact subgraph's snapshot -> latest READY GraphSnapshot -> match
 * dependency commit. Absent all three -> SNAPSHOT_UNAVAILABLE (fail closed,
 * pre-model PLAN_ONLY, zero spend). A branch advancing after analysis can
 * never shift the AI onto newer code than the evidence/policy case.
 */
export async function resolveExpectedCommitSha(
  run: AgentRunWithRelations,
): Promise<{ commitSha: string; graphSnapshotId: string | null }> {
  try {
    const impact = await packageImpact({
      organizationId: run.organizationId,
      repositoryId: run.repositoryId,
      packageName: run.releaseRecord.product.packageName,
    });
    const snapshotId = impact?.snapshotId ?? null;
    if (snapshotId) {
      const graph = await prisma.graphSnapshot.findUnique({
        where: { id: snapshotId },
        select: { commitSha: true, repositoryId: true, organizationId: true },
      });
      if (
        graph &&
        graph.repositoryId === run.repositoryId &&
        graph.organizationId === run.organizationId
      ) {
        return { commitSha: graph.commitSha, graphSnapshotId: snapshotId };
      }
    }
  } catch {
    // Fall through to the READY snapshot / match legs below.
  }
  const ready = await prisma.graphSnapshot.findFirst({
    where: { organizationId: run.organizationId, repositoryId: run.repositoryId, status: "READY" },
    select: { id: true, commitSha: true },
    orderBy: { completedAt: "desc" },
  });
  if (ready) return { commitSha: ready.commitSha, graphSnapshotId: ready.id };
  const matchSha = run.match?.dependency.commitSha ?? null;
  if (matchSha) return { commitSha: matchSha, graphSnapshotId: null };
  throw new SnapshotUnavailableError(
    `no analyzed commit for repository ${run.repositoryId}: no READY graph snapshot and no match commit (refusing HEAD resolution)`,
  );
}

/**
 * Snapshot-backed binding for the agent workflow (replaces fixture-only
 * `fixturesOf`): builds the immutable snapshot through the same contract for
 * fixture and connected repositories, then collects bounded excerpts for the
 * impacted files. Connected repositories pin the EXACT analyzed commit
 * (graph snapshot or match) — never HEAD. Any failure THROWS
 * SnapshotUnavailableError so the caller records pre-model PLAN_ONLY with
 * zero model spend (never an empty binding followed by a paid planner call).
 */
export async function resolveSnapshotBinding(run: AgentRunWithRelations): Promise<SnapshotBinding> {
  const repository = run.repository as {
    id?: string;
    organizationId?: string;
    provider?: string;
    fullName?: string | null;
    defaultBranch?: string | null;
    metadata?: unknown;
  };
  const repoRow = {
    id: run.repositoryId,
    organizationId: run.organizationId,
    provider: String(repository.provider ?? "LOCAL"),
    fullName: (repository.fullName ?? null) as string | null,
    defaultBranch: (repository.defaultBranch ?? null) as string | null,
    metadata: repository.metadata as unknown,
  };
  const fixture = isFixtureRepo(run);
  const expected = fixture ? null : await resolveExpectedCommitSha(run);
  let built: Awaited<ReturnType<typeof buildSnapshotForRepository>>;
  try {
    built = await buildSnapshotForRepository(
      repoRow,
      expected
        ? {
            expectedCommitSha: expected.commitSha,
            graphSnapshotId: expected.graphSnapshotId ?? undefined,
          }
        : {},
    );
  } catch (error) {
    if (error instanceof SnapshotUnavailableError) throw error;
    throw new SnapshotUnavailableError(
      `snapshot build failed for repository ${run.repositoryId}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const manifestMap = new Map(built.manifest.files.map((file) => [file.path, file.sha256]));
  // Impacted files for excerpt ranking (same query the impact analyst uses).
  let topFiles: string[] = [];
  try {
    const impact = await packageImpact({
      organizationId: run.organizationId,
      repositoryId: run.repositoryId,
      packageName: run.releaseRecord.product.packageName,
    });
    topFiles = [...(impact?.modules ?? [])]
      .sort((a, b) => b.evidenceCount - a.evidenceCount || (a.filePath < b.filePath ? -1 : 1))
      .slice(0, 8)
      .map((module) => module.filePath);
  } catch {
    topFiles = [];
  }
  let excerpts: Array<{ filePath: string; excerpt: string }> = [];
  if (topFiles.length > 0) {
    try {
      const checkout = await checkoutSnapshotForApply(built.snapshotId, repoRow);
      try {
        excerpts = collectSnapshotExcerpts(checkout.rootDir, topFiles, {
          maxFiles: 8,
          maxCharsPerFile: 2_000,
        });
      } finally {
        checkout.cleanup();
      }
    } catch {
      excerpts = [];
    }
  }
  return {
    snapshotId: built.snapshotId,
    commitSha: built.commitSha,
    treeHash: built.treeHash,
    manifestHash: built.manifestHash,
    manifest: manifestMap,
    excerpts,
  };
}

/**
 * Pre-model SNAPSHOT_UNAVAILABLE outcome: no planner/reviewer call, zero
 * tokens, zero cost. The run is marked FAILED with a classified error, the
 * attempt records SNAPSHOT_UNAVAILABLE, and the case moves to PLAN_ONLY (not
 * retryable PLANNING) with audit evidence explaining why.
 */
async function recordSnapshotUnavailable(
  run: AgentRunWithRelations,
  correlationId: string,
  input: ReturnType<typeof buildAgentWorkflowInput>,
  reason: string,
  rulePackVersion: string | null,
): Promise<void> {
  await prisma.agentRun.update({
    where: { id: run.id },
    data: {
      status: "FAILED",
      error: `SNAPSHOT_UNAVAILABLE: ${reason}`.slice(0, 2000),
      inputJson: input as never,
      costEstimateCents: 0,
      completedAt: new Date(),
    },
  });
  await recordRemediationAttempt({
    caseId: run.remediationCaseId ?? null,
    strategyId: "agent-plan",
    rulePackVersion,
    agentRunId: run.id,
    inputHash: digestJson(input as unknown as JsonValue),
    status: "SKIPPED",
    failureCode: "SNAPSHOT_UNAVAILABLE",
    organizationId: run.organizationId,
    correlationId,
  });
  if (run.remediationCaseId) {
    const existing = await prisma.remediationCase.findUnique({
      where: { id: run.remediationCaseId },
      select: { id: true, status: true, reasonCode: true },
    });
    if (existing && (existing.status === "PLANNING" || existing.status === "POLICY_ELIGIBLE")) {
      await prisma.$transaction([
        prisma.remediationCase.update({
          where: { id: existing.id },
          data: { status: "PLAN_ONLY" },
        }),
        prisma.remediationCaseEvent.create({
          data: {
            organizationId: run.organizationId,
            remediationCaseId: existing.id,
            status: "PLAN_ONLY",
            reasonCode: existing.reasonCode,
            detailJson: {
              agentRunId: run.id,
              boundOutcome: "PLAN_ONLY",
              reason: `SNAPSHOT_UNAVAILABLE: ${reason}`.slice(0, 1000),
            },
            correlationId,
          },
        }),
      ]);
    } else if (existing) {
      await prisma.remediationCaseEvent.create({
        data: {
          organizationId: run.organizationId,
          remediationCaseId: existing.id,
          status: existing.status,
          reasonCode: existing.reasonCode,
          detailJson: {
            agentRunId: run.id,
            failure: `SNAPSHOT_UNAVAILABLE: ${reason}`.slice(0, 1000),
          },
          correlationId,
        },
      });
    }
  }
  await writeAuditEvent({
    organizationId: run.organizationId,
    actorType: ActorType.SYSTEM,
    actorId: null,
    action: AuditAction.AGENT_RUN_FAILED,
    entityType: "agentRun",
    entityId: run.id,
    correlationId,
    after: {
      releaseRecordId: run.releaseRecordId,
      repositoryId: run.repositoryId,
      error: `SNAPSHOT_UNAVAILABLE: ${reason}`.slice(0, 1000),
      failureKind: "SNAPSHOT_UNAVAILABLE",
      modelSpendCents: 0,
    },
  });
  logger.warn("agent plan skipped: snapshot unavailable (pre-model PLAN_ONLY, zero spend)", {
    agentRunId: run.id,
    correlationId,
    reason: reason.slice(0, 500),
  });
}

function providerLabel(): string {
  const mode = process.env.AI_PROVIDER;
  if (mode === "openai" || mode === "openai-compatible" || mode === "ai-sdk") {
    return `${mode}:${process.env.OPENAI_MODEL ?? "gpt-4o-mini"}`;
  }
  return "mock";
}

function providerKind(): string {
  const mode = process.env.AI_PROVIDER;
  if (mode === "ai-sdk" || mode === "openai" || mode === "openai-compatible") {
    return mode;
  }
  return "mock";
}
