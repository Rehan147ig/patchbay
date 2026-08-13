import { prisma } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import { validationFailed } from "@patchbay/domain";
import { enqueue, JobType } from "@patchbay/queue";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk, writeAuditEvent } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { assertCsrfToken } from "@/lib/csrf-server";

/**
 * POST /api/runs/[id]/replay
 * Manually replays a failed (FAILED or BUDGET_EXCEEDED) agent run from its
 * failure boundary via the agent-replay BullMQ job. Completed workflow steps
 * are carried forward with verified input digests; replayed steps record new
 * AgentStep rows. Runs in other statuses are not replayable.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(request);
  try {
    assertCsrfToken(request);
    const user = await requireRole("MEMBER");
    const { id } = await params;

    const run = await prisma.agentRun.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!run) {
      throw validationFailed("Agent run not found");
    }
    if (run.status !== "FAILED" && run.status !== "BUDGET_EXCEEDED") {
      throw validationFailed(`Agent run cannot be replayed from ${run.status}`);
    }

    await enqueue(JobType.AGENT_REPLAY, {
      agentRunId: run.id,
      correlationId,
    });

    await writeAuditEvent({
      organizationId: user.organizationId,
      actorType: "USER",
      actorId: user.id,
      action: AuditAction.AGENT_RUN_REPLAYED,
      entityType: "agentRun",
      entityId: run.id,
      correlationId,
      after: {
        releaseRecordId: run.releaseRecordId,
        repositoryId: run.repositoryId,
        replayFromStatus: run.status,
      },
    });

    return jsonOk({ agentRunId: run.id, status: "QUEUED" }, correlationId, 202);
  } catch (error) {
    return jsonError(error, correlationId);
  }
}
