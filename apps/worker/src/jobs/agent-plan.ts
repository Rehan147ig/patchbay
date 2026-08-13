import { z } from "zod";
import { prisma, Prisma } from "@patchbay/db";
import { logger } from "@patchbay/domain";
import { createAiProvider } from "@patchbay/ai-provider";
import { resolveFixtureDir } from "@patchbay/repo-analysis";
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
  type StepRecording,
} from "../lib/agent-workflow";

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
  const input = buildAgentWorkflowInput(run, facts);
  const provider = createAiProvider(process.env);
  await markAgentRunRunning({
    run,
    correlationId,
    input,
    budgetCents: runBudgetCents(),
    model: providerLabel(),
  });
  if (await isAgentRunCancelled(run.id)) return;

  const recordStep = makeStepRecorder(run);
  const workflow = createAgentWorkflow({
    run,
    provider,
    budgetCents: runBudgetCents(),
    fixturesDir: fixturesOf(run),
    recordStep,
    isCancelled: () => isAgentRunCancelled(run.id),
  });

  const result = await workflow.run(input as never, { tools: agentTools({ run, facts }) });

  const outcome = await finishAgentWorkflow({
    run,
    correlationId,
    input,
    result,
  });
  if (outcome.status !== "SUCCEEDED" && outcome.failureMessage) {
    throw new Error(outcome.failureMessage);
  }
}

export async function loadAgentRun(agentRunId: string): Promise<{
  run: AgentRunWithRelations;
} | null> {
  const record = await prisma.agentRun.findUnique({
    where: { id: agentRunId },
    include: {
      releaseRecord: {
        include: {
          product: { include: { vendor: true } },
          classifications: true,
        },
      },
      repository: true,
      match: { include: { dependency: true } },
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
      status: record.status,
      repository: record.repository,
      match: record.match,
      inputJson: record.inputJson,
      outputJson: record.outputJson,
      budgetCents: record.budgetCents,
      model: record.model,
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
        latencyMs: Date.now() - startedAt + recording.latencyMs,
        completedAt: new Date(),
      },
    });
  };
}

function fixturesOf(run: AgentRunWithRelations): string | null {
  const metadata = run.repository.metadata;
  if (typeof metadata !== "object" || metadata === null) return null;
  const fixture = (metadata as { fixture?: unknown }).fixture;
  return typeof fixture === "string" && fixture.length > 0 ? resolveFixtureDir(fixture) : null;
}

function providerLabel(): string {
  const mode = process.env.AI_PROVIDER;
  if (mode === "openai" || mode === "openai-compatible") {
    return `${mode}:${process.env.OPENAI_MODEL ?? "gpt-4o-mini"}`;
  }
  return "mock";
}
