import { prisma } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import { validationFailed } from "@patchbay/domain";
import { enqueue, JobType } from "@patchbay/queue";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk, writeAuditEvent } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { assertCsrfToken } from "@/lib/csrf-server";

/**
 * POST /api/repositories/[id]/graph-index
 * Enqueues a graph-index job (baseline). The GraphIndexJob row is created
 * here (INDEXING) and driven READY / FAILED by the worker, which persists a
 * content-addressed GraphSnapshot (reused when the commit SHA is unchanged).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(request);
  try {
    assertCsrfToken(request);
    const user = await requireRole("MEMBER");
    const { id } = await params;

    const repository = await prisma.repository.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!repository) {
      throw validationFailed("Repository not found");
    }

    const indexJob = await prisma.graphIndexJob.create({
      data: {
        organizationId: user.organizationId,
        repositoryId: repository.id,
        mode: "BASELINE",
        status: "INDEXING",
        correlationId,
      },
    });

    await enqueue(JobType.GRAPH_INDEX, {
      jobId: indexJob.id,
      repositoryId: repository.id,
      correlationId,
      mode: "BASELINE",
    });

    await writeAuditEvent({
      organizationId: user.organizationId,
      actorType: "USER",
      actorId: user.id,
      action: AuditAction.GRAPH_INDEX_QUEUED,
      entityType: "repository",
      entityId: repository.id,
      correlationId,
      after: { jobId: indexJob.id, mode: "BASELINE", fixture: repository.metadata },
    });

    return jsonOk(
      { jobId: indexJob.id, repositoryId: repository.id, status: "INDEXING" },
      correlationId,
      202,
    );
  } catch (error) {
    return jsonError(error, correlationId);
  }
}
