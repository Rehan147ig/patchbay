/**
 * Recoverable task-parameter repository.
 *
 * A task parameter is one run of the activation task-management loop, keyed
 * by (taskId, type). Submission is idempotent: retries overwrite inputs, they
 * never duplicate work. A PROCESSING task older than TASK_STALENESS_MS is
 * considered crashed (worker died mid-run) and may be reclaimed by the next
 * submitter or claimer.
 *
 * Used by the submission endpoint (apps/web), the daemon update task
 * (apps/worker), and the seed script.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "./client";

/** A PROCESSING task older than this is reclaimable as crashed. */
export const TASK_STALENESS_MS = 10 * 60 * 1_000;

export interface SubmitTaskParameterInput {
  taskId: string;
  type: string;
  /** Executor domain, e.g. "NPM". */
  domain: string;
  input?: Prisma.InputJsonValue;
  deadline?: Date | null;
}

export interface SubmitTaskParameterResult {
  taskParameter: Prisma.TaskParameterGetPayload<Record<string, never>>;
  /** First submission created the parameter. */
  created: boolean;
  /** A retry refreshed the inputs (and cleared the error on a failed task). */
  refreshed: boolean;
  /** A crashed PROCESSING run was reset to PENDING so the daemon retries it. */
  reclaimed: boolean;
  /** False when the task already reached a terminal state (COMPLETED). */
  queued: boolean;
}

export async function submitTaskParameter(
  input: SubmitTaskParameterInput,
): Promise<SubmitTaskParameterResult> {
  const staleBefore = new Date(Date.now() - TASK_STALENESS_MS);

  const reclaimedCount = await prisma.taskParameter.updateMany({
    where: {
      taskId: input.taskId,
      type: input.type,
      status: "PROCESSING",
      startedAt: { lt: staleBefore },
    },
    data: { status: "PENDING" },
  });
  const reclaimed = reclaimedCount.count > 0;

  const existing = await prisma.taskParameter.findUnique({
    where: { taskId_type: { taskId: input.taskId, type: input.type } },
  });

  if (!existing) {
    const taskParameter = await prisma.taskParameter.create({
      data: {
        taskId: input.taskId,
        type: input.type,
        domain: input.domain,
        status: "PENDING",
        inputJson: (input.input ?? {}) as Prisma.InputJsonValue,
        deadline: input.deadline ?? null,
      },
    });
    return { taskParameter, created: true, refreshed: false, reclaimed: false, queued: true };
  }

  const freshFailedTask = existing.status === "FAILED";
  const taskParameter = await prisma.taskParameter.update({
    where: { taskId_type: { taskId: existing.taskId, type: existing.type } },
    data: {
      inputJson: (input.input ?? {}) as Prisma.InputJsonValue,
      deadline: input.deadline ?? existing.deadline,
      domain: input.domain,
      ...(freshFailedTask ? { status: "PENDING", error: null } : {}),
    },
  });

  return {
    taskParameter,
    created: false,
    refreshed: existing.status === "FAILED" || existing.status === "PENDING",
    reclaimed,
    queued: taskParameter.status !== "COMPLETED",
  };
}

export interface ClaimTaskParameterResult {
  taskParameter: Prisma.TaskParameterGetPayload<Record<string, never>>;
  /** True when a crashed PROCESSING run was reclaimed, false for a fresh PENDING claim. */
  reclaimed: boolean;
}

/**
 * Atomically claims a task parameter for execution. Claims only PENDING
 * parameters; PROCESSING ones are claimed (reclaimed) only when older than
 * TASK_STALENESS_MS. Returns null when there is nothing to claim.
 */
export async function claimTaskParameter(
  taskId: string,
  type: string,
): Promise<ClaimTaskParameterResult | null> {
  const staleBefore = new Date(Date.now() - TASK_STALENESS_MS);
  const crashedRun = await prisma.taskParameter.findFirst({
    where: { taskId, type, status: "PROCESSING", startedAt: { lt: staleBefore } },
    select: { id: true },
  });
  const update = await prisma.taskParameter.updateMany({
    where: {
      taskId,
      type,
      status: { in: ["PENDING", "PROCESSING"] },
      OR: [{ status: "PENDING" }, { startedAt: { lt: staleBefore } }],
    },
    data: { status: "PROCESSING", startedAt: new Date() },
  });
  if (update.count === 0) return null;

  const taskParameter = await prisma.taskParameter.findUnique({
    where: { taskId_type: { taskId, type } },
  });
  if (!taskParameter) return null;

  return { taskParameter, reclaimed: crashedRun !== null };
}

export async function completeTaskParameter(
  taskId: string,
  type: string,
  output: Prisma.InputJsonValue,
): Promise<void> {
  await prisma.taskParameter.update({
    where: { taskId_type: { taskId, type } },
    data: { status: "COMPLETED", outputJson: output, error: null },
  });
}

export async function failTaskParameter(
  taskId: string,
  type: string,
  error: string,
): Promise<void> {
  await prisma.taskParameter.update({
    where: { taskId_type: { taskId, type } },
    data: { status: "FAILED", error, outputJson: Prisma.JsonNull },
  });
}
