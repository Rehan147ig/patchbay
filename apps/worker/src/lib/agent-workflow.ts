import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { prisma, Prisma, packageImpact } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import {
  ActorType,
  AgentRole,
  AgentStepKind,
  logger,
  type PatchPlan,
  type ReviewVerdict,
} from "@patchbay/domain";
import type { AiProvider } from "@patchbay/ai-provider";
import {
  PROMPT_TEMPLATE_VERSION,
  bindSourceHashes,
  defineWorkflow,
  digestJson,
  hashInput,
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
}

export interface StepRecording {
  role: AgentRole;
  kind: AgentStepKind;
  toolName: string | null;
  inputDigest: string;
  outputJson: JsonValue;
  latencyMs: number;
}

export interface AgentWorkflowDeps {
  run: AgentRunWithRelations;
  provider: AiProvider;
  budgetCents: number;
  fixturesDir: string | null;
  recordStep: (recording: StepRecording) => Promise<void>;
  isCancelled: () => Promise<boolean>;
}

export function buildAgentWorkflowInput(
  run: AgentRunWithRelations,
  facts: FactsJson | null,
): AgentWorkflowInput {
  return {
    releaseRecordId: run.releaseRecordId,
    repositoryId: run.repositoryId,
    packageName: run.releaseRecord.product.packageName,
    vendorSlug: run.releaseRecord.product.vendor.slug,
    releaseVersion: run.releaseRecord.version,
    templateVersion: PROMPT_TEMPLATE_VERSION,
    facts,
  };
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
          const plannerInput = {
            releaseRecordId: input.releaseRecordId,
            repositoryId: input.repositoryId,
            expectedCommitSha: deps.run.match?.dependency.commitSha ?? undefined,
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
          const { plan, result, costEstimateCents } = await runPlanner(
            deps.provider,
            plannerInput,
            {
              budgetCents: deps.budgetCents,
            },
          );
          const bound = bindFixtureHashes(plan, deps.fixturesDir);
          await deps.recordStep({
            role: AgentRole.PLANNER,
            kind: AgentStepKind.MODEL_CALL,
            toolName: null,
            inputDigest: hashInput(plannerInput),
            outputJson: {
              plan: bound.plan,
              invalidated: bound.invalidated,
              costEstimateCents,
            } as unknown as JsonValue,
            latencyMs: Date.now() - startedAt,
          });
          return {
            plan: bound.plan,
            invalidated: bound.invalidated,
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
            { budgetCents: deps.budgetCents },
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

function bindFixtureHashes(
  plan: PatchPlan,
  fixtureDir: string | null,
): { plan: PatchPlan; invalidated: Array<{ filePath: string; reason: string }> } {
  const fileHashes = new Map<string, string>();
  for (const edit of plan.edits) {
    const filePath = fixtureDir ? path.join(fixtureDir, edit.filePath) : null;
    if (!filePath) continue;
    try {
      fileHashes.set(
        edit.filePath,
        createHash("sha256").update(readFileSync(filePath)).digest("hex"),
      );
    } catch {
      // file missing -> left unbound, dropped by bindSourceHashes below
    }
  }
  return bindSourceHashes(plan, fileHashes);
}

/** Marks the run RUNNING, persists the workflow input for replay, audits. */
export async function markAgentRunRunning(params: {
  run: AgentRunWithRelations;
  correlationId: string;
  input: AgentWorkflowInput;
  budgetCents: number;
  model: string;
}): Promise<void> {
  const { run, correlationId, input, budgetCents, model } = params;
  await prisma.agentRun.update({
    where: { id: run.id },
    data: {
      status: "RUNNING",
      startedAt: new Date(),
      budgetCents,
      model,
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
    const outputJson = {
      plan: planner?.plan ?? null,
      review: reviewer?.verdict ?? null,
      invalidated: planner?.invalidated ?? [],
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
        completedAt: new Date(),
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
