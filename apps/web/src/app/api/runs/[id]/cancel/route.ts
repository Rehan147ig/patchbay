import { prisma } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import { validationFailed } from "@patchbay/domain";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk, writeAuditEvent } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { assertCsrfToken } from "@/lib/csrf-server";

/**
 * POST /api/runs/[id]/cancel
 * Cancels a queued or running agent run; the processor checks the status
 * before each step and stops. Terminal runs are not cancelled.
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
    if (run.status !== "QUEUED" && run.status !== "RUNNING") {
      throw validationFailed(`Agent run cannot be cancelled from ${run.status}`);
    }

    const updated = await prisma.agentRun.update({
      where: { id: run.id },
      data: { status: "CANCELLED", completedAt: new Date() },
    });

    await writeAuditEvent({
      organizationId: user.organizationId,
      actorType: "USER",
      actorId: user.id,
      action: AuditAction.AGENT_RUN_CANCELLED,
      entityType: "agentRun",
      entityId: run.id,
      correlationId,
      after: { releaseRecordId: run.releaseRecordId, repositoryId: run.repositoryId },
    });

    return jsonOk({ agentRunId: updated.id, status: "CANCELLED" }, correlationId);
  } catch (error) {
    return jsonError(error, correlationId);
  }
}
