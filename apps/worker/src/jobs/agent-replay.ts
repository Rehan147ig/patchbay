import { z } from "zod";
import { prisma, Prisma } from "@patchbay/db";
import { logger } from "@patchbay/domain";
import { createAiProvider } from "@patchbay/ai-provider";
import { resolveFixtureDir } from "@patchbay/repo-analysis";
import { planReplay, type StepRecord } from "@patchbay/ai-harness";
import type { Job } from "bullmq";
import {
  agentTools,
  buildAgentWorkflowInput,
  createAgentWorkflow,
  finishAgentWorkflow,
  firstNonCompletedStepId,
  isAgentRunCancelled,
  markAgentRunRunning,
  type AgentRunWithRelations,
  type AgentWorkflowInput,
  type FactsJson,
  type StepRecording,
} from "../lib/agent-workflow";
import { loadAgentRun } from "./agent-plan";

/**
 * agent-replay processor (roadmap Phase H4: manual replay).
 *
 * Re-executes a FAILED or BUDGET_EXCEEDED agent run from its failure
 * boundary: completed workflow steps are carried forward (input digests
 * verified against the stored run input), the non-completed steps re-run
 * with the same definition and input inside the Mastra-contract workflow.
 * Each replayed step records its own AgentStep row for the audit trail.
 */
export const AgentReplayJobDataSchema = z.object({
  agentRunId: z.string().min(1),
  correlationId: z.string().min(1),
});
export type AgentReplayJobData = z.infer<typeof AgentReplayJobDataSchema>;

export async function processAgentReplay(job: Job): Promise<void> {
  const parsed = AgentReplayJobDataSchema.safeParse(job.data);
  if (!parsed.success) throw new Error(`invalid agent-replay job data: ${parsed.error.message}`);
  const { agentRunId, correlationId } = parsed.data;

  const loaded = await loadAgentRun(agentRunId);
  if (!loaded) throw new Error(`agent run not found: ${agentRunId}`);
  const run = loaded.run;

  if (run.status !== "FAILED" && run.status !== "BUDGET_EXCEEDED") {
    throw new Error(`agent run cannot be replayed from ${run.status}`);
  }

  const storedInput = runInputOf(run, agentRunId);
  const storedSteps = workflowStepsOf(run, agentRunId);
  const fromStepId = firstNonCompletedStepId(storedSteps);
  if (!fromStepId) {
    throw new Error(`agent run ${agentRunId} has no failed step to replay from`);
  }
  planReplay(storedSteps, fromStepId);

  const input = buildAgentWorkflowInput(run, storedInput.facts);
  const provider = createAiProvider(process.env);
  await markAgentRunRunning({
    run,
    correlationId,
    input,
    budgetCents: storedInput.budgetCents,
    model: storedInput.model,
    provider: run.provider ?? "mock",
  });
  if (await isAgentRunCancelled(run.id)) return;

  const recordStep = makeReplayStepRecorder(run);
  const workflow = createAgentWorkflow({
    run,
    provider,
    budgetCents: storedInput.budgetCents,
    fixturesDir: fixturesOf(run),
    recordStep,
    isCancelled: () => isAgentRunCancelled(run.id),
  });

  const result = await workflow.replay(storedSteps, fromStepId, input as never, {
    tools: agentTools({ run, facts: storedInput.facts }),
  });

  const outcome = await finishAgentWorkflow({
    run,
    correlationId,
    input,
    result,
  });
  logger.info("agent run replay finished", {
    agentRunId: run.id,
    correlationId,
    fromStepId,
    status: outcome.status,
    replayedSteps: result.steps.length,
  });
  if (outcome.status !== "SUCCEEDED" && outcome.failureMessage) {
    throw new Error(outcome.failureMessage);
  }
}

interface StoredAgentRunContext {
  input: AgentWorkflowInput;
  facts: FactsJson | null;
  budgetCents: number;
  model: string;
}

function runInputOf(run: AgentRunWithRelations, agentRunId: string): StoredAgentRunContext {
  const input = run.inputJson as AgentWorkflowInput | null;
  if (!input || typeof input !== "object") {
    throw new Error(`agent run ${agentRunId} has no stored input to replay`);
  }
  return {
    input,
    facts: input.facts ?? null,
    budgetCents: run.budgetCents ?? 100,
    model: run.model ?? "mock",
  };
}

function workflowStepsOf(run: AgentRunWithRelations, agentRunId: string): StepRecord[] {
  const output = run.outputJson as { workflow?: { steps?: StepRecord[] } } | null | undefined;
  const steps = output?.workflow?.steps;
  if (!steps || steps.length === 0) {
    throw new Error(`agent run ${agentRunId} has no stored workflow steps to replay`);
  }
  return steps;
}

function makeReplayStepRecorder(
  run: AgentRunWithRelations,
): (recording: StepRecording) => Promise<void> {
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

function fixturesOf(run: AgentRunWithRelations): string | null {
  const metadata = run.repository.metadata;
  if (typeof metadata !== "object" || metadata === null) return null;
  const fixture = (metadata as { fixture?: unknown }).fixture;
  return typeof fixture === "string" && fixture.length > 0 ? resolveFixtureDir(fixture) : null;
}
