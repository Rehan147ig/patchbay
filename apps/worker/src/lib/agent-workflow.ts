import { prisma, Prisma, packageImpact } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import {
  ActorType,
  AgentRole,
  AgentStepKind,
  logger,
  type PatchPlan,
  type ReviewVerdict,
  type RulePack,
} from "@patchbay/domain";
import type { AiProvider } from "@patchbay/ai-provider";
import {
  PROMPT_TEMPLATE_VERSION,
  PackBudgetExceededError,
  assertRemainingBudget,
  bindSnapshotHashes,
  buildEvidencePacket,
  classifyBoundPlan,
  defineWorkflow,
  digestJson,
  hashInput,
  remainingBudgetCents,
  runPlanner,
  runReviewer,
  WorkflowAbortedError,
  type JsonObject,
  type JsonValue,
  type StepRecord,
  type WorkflowHandle,
  type WorkflowRunResult,
} from "@patchbay/ai-harness";
import { writeAuditEvent } from "./audit";

/**
 * Phase H4 agent workflow: the Mastra-contract adapter wired to the
 * deterministic provider. Four steps with separate tool allowlists, two
 * independent analysts parallelized, then planner -> reviewer, then two
 * evaluation gates. BullMQ/Postgres remain the durable workflow authority;
 * replay re-executes from the failure boundary inside a new BullMQ job.
 */
export const AGENT_WORKFLOW_ID = "agent-plan";
export const AGENT_WORKFLOW_VERSION = "h4-v1";

export interface FactsJson {
  fromVersion: string | null;
  toVersion: string;
  breaking: boolean;
  changeDrafts: Array<{
    changeType: string;
    oldValue: string | null;
    newValue: string | null;
    description: string | null;
    breaking: boolean;
    affectedSymbols: string[];
    rule: string | null;
  }>;
}

export interface AgentWorkflowInput {
  releaseRecordId: string;
  repositoryId: string;
  packageName: string;
  vendorSlug: string;
  releaseVersion: string;
  templateVersion: string;
  facts: FactsJson | null;
  /**
   * WP6 certified rule pack (WP7): persisted into the run input (replay
   * identity covers it) and enforced on the planner's edits. Null for
   * uncertified connectors — global breaker caps still apply downstream.
   */
  rulePack: RulePack | null;
}

export interface FactsOutput {
  fromVersion: string | null;
  toVersion: string;
  breaking: boolean;
  drafts: FactsJson["changeDrafts"];
}

export interface ImpactOutput {
  modules: Array<{ filePath: string; edgeKinds: string[]; evidenceCount: number }>;
  resolvedVersion: string | null;
  declaredRange: string | null;
  snapshotId: string | null;
}

export interface PlannerOutput {
  plan: PatchPlan;
  invalidated: Array<{ filePath: string; reason: string }>;
  boundOutcome: string;
  boundReason: string;
  snapshotId: string | null;
  commitSha: string | null;
  costEstimateCents: number;
  tokenUsage: JsonObject;
}

export interface ReviewerOutput {
  verdict: ReviewVerdict;
  costEstimateCents: number;
  tokenUsage: JsonObject;
}

export interface AgentRunWithRelations {
  id: string;
  organizationId: string;
  releaseRecordId: string;
  repositoryId: string;
  releaseRepositoryMatchId: string | null;
  remediationCaseId: string | null;
  status: string;
  repository: { metadata: unknown };
  match: {
    dependency: {
      commitSha: string | null;
      resolvedVersion: string | null;
      declaredRange: string | null;
    };
  } | null;
  releaseRecord: {
    version: string;
    product: { packageName: string; vendor: { slug: string } };
    classifications: Array<{ factsJson: unknown }>;
  };
  inputJson: unknown;
  outputJson: unknown;
  budgetCents: number | null;
  model: string | null;
  provider: string | null;
  startedAt: Date | null;
}

export interface StepRecording {
  role: AgentRole;
  kind: AgentStepKind;
  toolName: string | null;
  inputDigest: string;
  outputJson: JsonValue;
  latencyMs: number;
  /** Provider kind label ("mock" | "ai-sdk" | "openai-compatible"). */
  provider?: string | null;
  /** Provider-side request id for model-call steps. */
  providerRequestId?: string | null;
  /** Token usage for model-call steps. */
  tokenUsage?: JsonValue | null;
}

export interface SnapshotBinding {
  /** Immutable snapshot the planner analyzes (exact commit, never a branch). */
  snapshotId: string | null;
  commitSha: string | null;
  treeHash: string | null;
  manifestHash: string | null;
  /** Manifest map (path -> sha256) for binding; empty map invalidates everything. */
  manifest: ReadonlyMap<string, string>;
  /** Ranked source excerpts from impacted files only (untrusted, bounded). */
  excerpts: Array<{ filePath: string; excerpt: string }>;
}

export interface AgentWorkflowDeps {
  run: AgentRunWithRelations;
  provider: AiProvider;
  /** ONE total AgentRun budget across planner + reviewer (AI_RUN_BUDGET_CENTS). */
  budgetCents: number;
  /** Snapshot-backed binding (replaces the fixture-only path). */
  snapshot: SnapshotBinding | null;
  recordStep: (recording: StepRecording) => Promise<void>;
  isCancelled: () => Promise<boolean>;
  /** WP6 pack enforced on planner edits (absent = globals only). */
  rulePack?: RulePack | null;
}

export function buildAgentWorkflowInput(
  run: AgentRunWithRelations,
  facts: FactsJson | null,
  rulePack: RulePack | null = null,
): AgentWorkflowInput {
  return {
    releaseRecordId: run.releaseRecordId,
    repositoryId: run.repositoryId,
    packageName: run.releaseRecord.product.packageName,
    vendorSlug: run.releaseRecord.product.vendor.slug,
    releaseVersion: run.releaseRecord.version,
    templateVersion: PROMPT_TEMPLATE_VERSION,
    facts,
    rulePack,
  };
}

/**
 * WP7 pack-budget gate (pure): counts the planner's proposed edits against
 * the certified pack. Returns human-readable violations, empty when the plan
 * fits. Bytes are the JSON encoding of the edit list — a conservative proxy
 * for patch volume, documented as such.
 */
export function checkPackBudget(
  edits: ReadonlyArray<{ filePath: string }>,
  pack: RulePack,
): string[] {
  const violations: string[] = [];
  const files = new Set(edits.map((edit) => edit.filePath));
  const perFile = new Map<string, number>();
  for (const edit of edits) perFile.set(edit.filePath, (perFile.get(edit.filePath) ?? 0) + 1);
  const maxInFile = Math.max(0, ...perFile.values());
  const bytes = Buffer.byteLength(JSON.stringify(edits), "utf8");
  if (files.size > pack.editBudget.maxFiles) {
    violations.push(`${files.size} files > pack max ${pack.editBudget.maxFiles}`);
  }
  if (maxInFile > pack.editBudget.maxEditsPerFile) {
    violations.push(`${maxInFile} edits in one file > pack max ${pack.editBudget.maxEditsPerFile}`);
  }
  if (bytes > pack.editBudget.maxTotalBytes) {
    violations.push(`${bytes} edit bytes > pack max ${pack.editBudget.maxTotalBytes}`);
  }
  return violations;
}

/** Mastra-contract agent workflow; separate allowlists per role. */
export function createAgentWorkflow(deps: AgentWorkflowDeps): WorkflowHandle {
  return defineWorkflow({
    workflowId: AGENT_WORKFLOW_ID,
    description: AGENT_WORKFLOW_VERSION,
    steps: [
      {
        stepId: "release-analyst",
        description: "release facts analyst",
        toolAllowlist: ["getReleaseFacts"],
        run: async (ctx) => {
          const input = ctx.input as unknown as AgentWorkflowInput;
          await guardAborted(deps);
          const startedAt = Date.now();
          const output = (await ctx.callTool("getReleaseFacts", {
            releaseRecordId: input.releaseRecordId,
          })) as unknown as FactsOutput;
          await deps.recordStep({
            role: AgentRole.ANALYST,
            kind: AgentStepKind.TOOL_CALL,
            toolName: "getReleaseFacts",
            inputDigest: digestJson({ releaseRecordId: input.releaseRecordId }),
            outputJson: output as unknown as JsonValue,
            latencyMs: Date.now() - startedAt,
          });
          return output as unknown as JsonValue;
        },
      },
      {
        stepId: "impact-analyst",
        description: "impact analyst over the repository graph",
        toolAllowlist: ["getAffectedUsageSubgraph"],
        run: async (ctx) => {
          const input = ctx.input as unknown as AgentWorkflowInput;
          await guardAborted(deps);
          const startedAt = Date.now();
          const output = (await ctx.callTool("getAffectedUsageSubgraph", {
            repositoryId: input.repositoryId,
            packageName: input.packageName,
          })) as unknown as ImpactOutput;
          await deps.recordStep({
            role: AgentRole.ANALYST,
            kind: AgentStepKind.TOOL_CALL,
            toolName: "getAffectedUsageSubgraph",
            inputDigest: digestJson({
              repositoryId: input.repositoryId,
              packageName: input.packageName,
            }),
            outputJson: output as unknown as JsonValue,
            latencyMs: Date.now() - startedAt,
          });
          return output as unknown as JsonValue;
        },
      },
      {
        stepId: "planner",
        description: "planner model call (no tools)",
        toolAllowlist: [],
        dependsOn: ["release-analyst", "impact-analyst"],
        run: async (ctx) => {
          const input = ctx.input as unknown as AgentWorkflowInput;
          await guardAborted(deps);
          const facts = ctx.state["release-analyst"] as unknown as FactsOutput;
          const impact = ctx.state["impact-analyst"] as unknown as ImpactOutput;
          const snapshot = deps.snapshot;
          const commitSha =
            snapshot?.commitSha ?? deps.run.match?.dependency.commitSha ?? undefined;
          // Bounded deterministic evidence packet: ranked excerpts from
          // impacted files only, snapshot identity, rule-pack metadata. The
          // model never sees a shell, filesystem, credentials, branch access,
          // command selection, or network — only this packet.
          const packet = buildEvidencePacket({
            vendorSlug: input.vendorSlug,
            packageName: input.packageName,
            fromVersion: facts.fromVersion,
            toVersion: facts.toVersion,
            breaking: facts.breaking,
            drafts: facts.drafts,
            modules: impact.modules,
            snapshot: {
              commitSha: commitSha ?? "unknown",
              treeHash: snapshot?.treeHash ?? "unknown",
              manifestHash: snapshot?.manifestHash ?? "unknown",
            },
            excerpts: snapshot?.excerpts ?? [],
            rulePack: deps.rulePack
              ? {
                  packVersion: deps.rulePack.packVersion,
                  vendorSlug: deps.rulePack.vendorSlug,
                  contractKind: deps.rulePack.contractKind,
                  validationProfile: deps.rulePack.validationProfile,
                  riskTags: deps.rulePack.riskTags,
                }
              : null,
          });
          const plannerInput = {
            releaseRecordId: input.releaseRecordId,
            repositoryId: input.repositoryId,
            expectedCommitSha: commitSha,
            ...(snapshot?.snapshotId ? { snapshotId: snapshot.snapshotId } : {}),
            ...(snapshot?.treeHash ? { snapshotTreeHash: snapshot.treeHash } : {}),
            ...(snapshot?.manifestHash ? { snapshotManifestHash: snapshot.manifestHash } : {}),
            excerpts: packet.excerpts,
            ...(deps.rulePack ? { rulePackVersion: deps.rulePack.packVersion } : {}),
            vendorSlug: input.vendorSlug,
            packageName: input.packageName,
            fromVersion: facts.fromVersion,
            toVersion: facts.toVersion,
            breaking: facts.breaking,
            resolvedVersion: impact.resolvedVersion,
            declaredRange: impact.declaredRange,
            drafts: facts.drafts,
            modules: impact.modules,
          };
          const startedAt = Date.now();
          // Total budget: reserve before the planner call (spent=0 here).
          assertRemainingBudget(deps.budgetCents, 0);
          const { plan, result, costEstimateCents } = await runPlanner(
            deps.provider,
            plannerInput,
            {
              budgetCents: deps.budgetCents,
            },
          );
          // Snapshot-backed binding: exact snapshot -> evidence packet -> AI
          // PatchPlan -> bind every edit to manifest hashes. Missing, unsafe,
          // or stale targets invalidate (never silently repaired).
          const bound = bindSnapshotHashes(plan, snapshot?.manifest ?? new Map());
          // Conservative autonomy: AI-generated connected-repository patches
          // are ALWAYS approval-required (deterministic certified packs keep
          // their draft-PR eligibility via the rule-based path, never here).
          // No auto-merge, ever.
          bound.plan.requiresHumanReview = true;
          const classification = classifyBoundPlan(
            bound.plan.edits.length,
            bound.invalidated.length,
          );
          // WP7 pack gate: enforced on the BOUND plan, so edits already
          // dropped as invalidated never count against the budget. A violation
          // fails here (BUDGET_EXCEEDED → case stays PLANNING + timeline),
          // never advances silently, and is never truncated behind the agent.
          if (deps.rulePack) {
            const violations = checkPackBudget(bound.plan.edits, deps.rulePack);
            if (violations.length > 0) {
              throw new PackBudgetExceededError(deps.rulePack.packVersion, violations);
            }
          }
          await deps.recordStep({
            role: AgentRole.PLANNER,
            kind: AgentStepKind.MODEL_CALL,
            toolName: null,
            inputDigest: hashInput(plannerInput),
            outputJson: {
              plan: bound.plan,
              invalidated: bound.invalidated,
              boundOutcome: classification.outcome,
              boundReason: classification.reason,
              snapshotId: snapshot?.snapshotId ?? null,
              commitSha: commitSha ?? null,
              costEstimateCents,
            } as unknown as JsonValue,
            latencyMs: Date.now() - startedAt,
            provider: result.provider ?? null,
            providerRequestId: result.requestId ?? null,
            tokenUsage: (result.usage ?? {}) as JsonValue,
          });
          return {
            plan: bound.plan,
            invalidated: bound.invalidated,
            boundOutcome: classification.outcome,
            boundReason: classification.reason,
            snapshotId: snapshot?.snapshotId ?? null,
            commitSha: commitSha ?? null,
            costEstimateCents,
            tokenUsage: (result.usage ?? {}) as JsonObject,
          } as unknown as JsonValue;
        },
      },
      {
        stepId: "reviewer",
        description: "independent reviewer model call (no tools)",
        toolAllowlist: [],
        dependsOn: ["planner", "impact-analyst", "release-analyst"],
        run: async (ctx) => {
          const input = ctx.input as unknown as AgentWorkflowInput;
          await guardAborted(deps);
          const planner = ctx.state["planner"] as unknown as PlannerOutput;
          const facts = ctx.state["release-analyst"] as unknown as FactsOutput;
          const impact = ctx.state["impact-analyst"] as unknown as ImpactOutput;
          const startedAt = Date.now();
          // Total budget: the reviewer spends what the planner left. Planner
          // + reviewer can never exceed the single AgentRun budget.
          const spentAfterPlanner = planner.costEstimateCents ?? 0;
          const reviewerBudget = remainingBudgetCents(deps.budgetCents, spentAfterPlanner);
          assertRemainingBudget(deps.budgetCents, spentAfterPlanner);
          const { verdict, result, costEstimateCents } = await runReviewer(
            deps.provider,
            planner.plan,
            { modules: impact.modules },
            {
              packageName: input.packageName,
              fromVersion: facts.fromVersion,
              toVersion: facts.toVersion,
              breaking: facts.breaking,
            },
            { budgetCents: reviewerBudget },
          );
          await deps.recordStep({
            role: AgentRole.REVIEWER,
            kind: AgentStepKind.MODEL_CALL,
            toolName: null,
            inputDigest: digestJson({
              release: input.releaseVersion,
              edits: planner.plan.edits.length,
            }),
            outputJson: { verdict, costEstimateCents } as unknown as JsonValue,
            latencyMs: Date.now() - startedAt,
            provider: result.provider ?? null,
            providerRequestId: result.requestId ?? null,
            tokenUsage: (result.usage ?? {}) as JsonValue,
          });
          return {
            verdict,
            costEstimateCents,
            tokenUsage: (result.usage ?? {}) as JsonObject,
          } as unknown as JsonValue;
        },
      },
    ],
    gates: [
      {
        gateId: "plan-gate",
        description: "breaking changes must produce at least one edit proposal",
        check: ({ state }) => {
          const planner = state["planner"] as PlannerOutput | undefined;
          const facts = state["release-analyst"] as FactsOutput | undefined;
          if (!planner || !facts) {
            return { passed: false, detail: "planner step did not complete" };
          }
          if (facts.breaking && planner.plan.edits.length === 0) {
            return { passed: false, detail: "no edits proposed for a breaking change" };
          }
          return { passed: true, detail: `${planner.plan.edits.length} edit(s) proposed` };
        },
      },
      {
        gateId: "review-gate",
        description: "independent reviewer must approve the plan",
        check: ({ state }) => {
          const reviewer = state["reviewer"] as ReviewerOutput | undefined;
          if (!reviewer) {
            return { passed: false, detail: "review step did not complete" };
          }
          return reviewer.verdict.approved
            ? {
                passed: true,
                detail: `approved by independent review (${reviewer.verdict.confidence}% confidence)`,
              }
            : { passed: false, detail: reviewer.verdict.summary };
        },
      },
    ],
  });
}

export type AgentTools = Record<string, (payload: JsonValue) => Promise<JsonValue>>;

/** Deterministic, bounded tool implementations registered for the run. */
export function agentTools(deps: {
  run: AgentRunWithRelations;
  facts: FactsJson | null;
}): AgentTools {
  return {
    getReleaseFacts: async () =>
      ({
        fromVersion: deps.facts?.fromVersion ?? null,
        toVersion: deps.facts?.toVersion ?? deps.run.releaseRecord.version,
        breaking: deps.facts?.breaking ?? false,
        drafts: deps.facts?.changeDrafts ?? [],
      }) as unknown as JsonValue,
    getAffectedUsageSubgraph: async (payload) => {
      const { repositoryId, packageName } = payload as {
        repositoryId: string;
        packageName: string;
      };
      const impact = await packageImpact({
        organizationId: deps.run.organizationId,
        repositoryId,
        packageName,
      });
      return {
        modules:
          impact?.modules.map((module) => ({
            filePath: module.filePath,
            edgeKinds: module.edgeKinds,
            evidenceCount: module.evidenceCount,
          })) ?? [],
        resolvedVersion:
          impact?.resolvedVersion ?? deps.run.match?.dependency.resolvedVersion ?? null,
        declaredRange: impact?.declaredRanges ?? deps.run.match?.dependency.declaredRange ?? null,
        snapshotId: impact?.snapshotId ?? null,
      } as unknown as JsonValue;
    },
  };
}

async function guardAborted(deps: AgentWorkflowDeps): Promise<void> {
  if (await deps.isCancelled()) {
    throw new WorkflowAbortedError("agent run cancelled before step execution");
  }
}

/** Marks the run RUNNING, persists the workflow input for replay, audits. */
export async function markAgentRunRunning(params: {
  run: AgentRunWithRelations;
  correlationId: string;
  input: AgentWorkflowInput;
  budgetCents: number;
  model: string;
  provider: string;
}): Promise<void> {
  const { run, correlationId, input, budgetCents, model, provider } = params;
  await prisma.agentRun.update({
    where: { id: run.id },
    data: {
      status: "RUNNING",
      startedAt: new Date(),
      budgetCents,
      model,
      provider,
      promptTemplateVersion: input.templateVersion,
    },
  });
  await writeAuditEvent({
    organizationId: run.organizationId,
    actorType: ActorType.SYSTEM,
    actorId: null,
    action: AuditAction.AGENT_RUN_STARTED,
    entityType: "agentRun",
    entityId: run.id,
    correlationId,
    after: {
      releaseRecordId: run.releaseRecordId,
      repositoryId: run.repositoryId,
      packageName: input.packageName,
      version: input.releaseVersion,
      matchId: run.releaseRepositoryMatchId ?? null,
    },
  });
}

export interface WorkflowOutcome {
  status: "SUCCEEDED" | "FAILED" | "BUDGET_EXCEEDED" | "CANCELLED";
  failureMessage: string | null;
}

/** Persists the run result + audit; maps adapter failures to run statuses. */
export async function finishAgentWorkflow(params: {
  run: AgentRunWithRelations;
  correlationId: string;
  input: AgentWorkflowInput;
  result: WorkflowRunResult;
}): Promise<WorkflowOutcome> {
  const { run, correlationId, input, result } = params;
  const planner = result.output?.["planner"] as PlannerOutput | undefined;
  const reviewer = result.output?.["reviewer"] as ReviewerOutput | undefined;
  const costEstimateCents = (planner?.costEstimateCents ?? 0) + (reviewer?.costEstimateCents ?? 0);
  const inputAsJson = input as unknown as JsonValue;
  const latencyMs = runLatencyMs(run);

  const workflowArtifact = {
    workflowId: result.workflowId,
    version: AGENT_WORKFLOW_VERSION,
    templateVersion: input.templateVersion,
    replayedFromStepId: result.replayedFromStepId,
    steps: result.steps,
    gates: result.gates,
    failure: result.failure,
  };

  if (result.status === "SUCCEEDED") {
    const boundOutcome =
      (planner as { boundOutcome?: string } | undefined)?.boundOutcome ??
      classifyBoundPlan(planner?.plan.edits.length ?? 0, planner?.invalidated.length ?? 0).outcome;
    const outputJson = {
      plan: planner?.plan ?? null,
      review: reviewer?.verdict ?? null,
      invalidated: planner?.invalidated ?? [],
      boundOutcome,
      boundReason: (planner as { boundReason?: string } | undefined)?.boundReason ?? null,
      snapshotId: (planner as { snapshotId?: string | null } | undefined)?.snapshotId ?? null,
      commitSha: (planner as { commitSha?: string | null } | undefined)?.commitSha ?? null,
      gates: result.gates,
      workflow: workflowArtifact,
    };
    await prisma.agentRun.update({
      where: { id: run.id },
      data: {
        status: "SUCCEEDED",
        outputJson: outputJson as unknown as Prisma.InputJsonValue,
        inputJson: input as never,
        redactedInputDigest: digestJson(inputAsJson),
        tokenUsage: {
          planner: planner?.tokenUsage ?? {},
          reviewer: reviewer?.tokenUsage ?? {},
        } as Prisma.InputJsonValue,
        costEstimateCents,
        latencyMs,
        completedAt: new Date(),
        ...(outputJson.snapshotId ? { repositorySnapshotId: outputJson.snapshotId as string } : {}),
      },
    });
    await writeAuditEvent({
      organizationId: run.organizationId,
      actorType: ActorType.SYSTEM,
      actorId: null,
      action: AuditAction.AGENT_RUN_COMPLETED,
      entityType: "agentRun",
      entityId: run.id,
      correlationId,
      after: {
        releaseRecordId: run.releaseRecordId,
        repositoryId: run.repositoryId,
        packageName: input.packageName,
        version: input.releaseVersion,
        reviewApproved: reviewer?.verdict.approved ?? false,
        editCount: planner?.plan.edits.length ?? 0,
        invalidatedCount: planner?.invalidated.length ?? 0,
        boundOutcome,
        snapshotId: outputJson.snapshotId,
        commitSha: outputJson.commitSha,
        rulePackVersion: input.rulePack?.packVersion ?? null,
        costEstimateCents,
        gates: result.gates.map((gate) => ({ gateId: gate.gateId, passed: gate.passed })),
      },
    });
    logger.info("agent run completed", {
      agentRunId: run.id,
      correlationId,
      packageName: input.packageName,
      version: input.releaseVersion,
      reviewApproved: reviewer?.verdict.approved ?? false,
      edits: planner?.plan.edits.length ?? 0,
    });
    return { status: "SUCCEEDED", failureMessage: null };
  }

  const failure = result.failure;
  const failureMessage = failure ? `${failure.kind}: ${failure.message}` : "workflow failed";
  const isBudget = failure?.kind === "BUDGET_EXCEEDED";
  const isAborted = failure?.kind === "ABORTED";
  const status =
    isAborted || (await isAgentRunCancelled(run.id))
      ? "CANCELLED"
      : isBudget
        ? "BUDGET_EXCEEDED"
        : "FAILED";

  await prisma.agentRun.update({
    where: { id: run.id },
    data: {
      status,
      error: failureMessage,
      outputJson: { workflow: workflowArtifact } as unknown as Prisma.InputJsonValue,
      inputJson: input as never,
      redactedInputDigest: digestJson(inputAsJson),
      latencyMs,
      completedAt: new Date(),
    },
  });

  if (isAborted) {
    logger.info("agent run cancelled during execution", { agentRunId: run.id, correlationId });
    return { status: "CANCELLED", failureMessage: null };
  }

  const action = isBudget ? AuditAction.AGENT_RUN_BUDGET_EXCEEDED : AuditAction.AGENT_RUN_FAILED;
  await writeAuditEvent({
    organizationId: run.organizationId,
    actorType: ActorType.SYSTEM,
    actorId: null,
    action,
    entityType: "agentRun",
    entityId: run.id,
    correlationId,
    after: {
      releaseRecordId: run.releaseRecordId,
      repositoryId: run.repositoryId,
      error: failureMessage,
      failureKind: failure?.kind ?? null,
      failedStepId: failure?.stepId ?? null,
    },
  });
  logger.error("agent run failed", {
    agentRunId: run.id,
    correlationId,
    error: failureMessage,
    failureKind: failure?.kind,
  });
  return { status, failureMessage };
}

export async function isAgentRunCancelled(agentRunId: string): Promise<boolean> {
  const current = await prisma.agentRun.findUnique({
    where: { id: agentRunId },
    select: { status: true },
  });
  return current?.status === "CANCELLED";
}

/** First step in the persisted records that did not complete: the replay boundary. */
export function firstNonCompletedStepId(steps: StepRecord[]): string | null {
  return steps.find((step) => step.status !== "COMPLETED")?.stepId ?? null;
}

function runLatencyMs(run: AgentRunWithRelations): number | null {
  if (!run.startedAt) return null;
  return Date.now() - run.startedAt.getTime();
}
