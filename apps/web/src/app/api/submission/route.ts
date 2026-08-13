import { submitTaskParameter } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import { submissionSchema } from "@patchbay/domain";
import { enqueue, JobType } from "@patchbay/queue";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk, parseBodyBounded, writeAuditEvent } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { assertCsrfToken } from "@/lib/csrf-server";

const MAX_SUBMISSION_BODY_BYTES = 64 * 1024;

/**
 * POST /api/submission
 *
 * Uniform submission endpoint for the activation task-management loop. A
 * submission creates or refreshes a task parameter; it is idempotent per
 * (taskId, type), so retries and webhook replays never duplicate work. Runs
 * in PENDING are handed to the daemon update task; completed runs are
 * returned as-is without re-enqueueing.
 */
export async function POST(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  try {
    assertCsrfToken(request);
    const user = await requireRole("MEMBER");

    const input = await parseBodyBounded(request, submissionSchema, MAX_SUBMISSION_BODY_BYTES);
    const deadline = input.deadline ? new Date(input.deadline) : undefined;

    const result = await submitTaskParameter({
      taskId: input.taskId,
      type: input.type,
      domain: input.domain,
      input: input.input as never,
      deadline,
    });

    if (result.queued) {
      await enqueue(JobType.UPDATE_TASK_PARAMETER, {
        taskId: input.taskId,
        type: input.type,
        domain: input.domain,
        organizationId: user.organizationId,
        correlationId,
      });
    }

    const duplicate = !result.created && !result.refreshed && !result.reclaimed;
    await writeAuditEvent({
      organizationId: user.organizationId,
      actorType: "USER",
      actorId: user.id,
      action: duplicate ? AuditAction.SUBMISSION_DEDUPLICATED : AuditAction.SUBMISSION_RECEIVED,
      entityType: "taskParameter",
      entityId: result.taskParameter.id,
      correlationId,
      after: {
        taskId: input.taskId,
        type: input.type,
        domain: input.domain,
        status: result.taskParameter.status,
        created: result.created,
        reclaimed: result.reclaimed,
        queued: result.queued,
      },
    });

    return jsonOk(
      {
        taskId: input.taskId,
        type: input.type,
        status: result.taskParameter.status,
        queued: result.queued,
        deduplicated: duplicate,
        reclaimed: result.reclaimed,
      },
      correlationId,
      result.created ? 201 : 200,
    );
  } catch (error) {
    return jsonError(error, correlationId);
  }
}
