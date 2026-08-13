import { prisma } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import { validationFailed } from "@patchbay/domain";
import { enqueue, JobType } from "@patchbay/queue";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk, writeAuditEvent } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { assertCsrfToken } from "@/lib/csrf-server";

/**
 * POST /api/repositories/[id]/scan
 * Enqueues a scan-repository job. The RepositoryScan row is created here
 * (QUEUED) and driven RUNNING -> COMPLETED / FAILED by the worker, which
 * replaces the repository's usage inventory with fresh analyzer output.
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

    const scan = await prisma.repositoryScan.create({
      data: {
        organizationId: user.organizationId,
        repositoryId: repository.id,
        commitSha: "pending",
        status: "QUEUED",
      },
    });

    await enqueue(JobType.SCAN_REPOSITORY, {
      repositoryId: repository.id,
      scanId: scan.id,
      correlationId,
    });

    await writeAuditEvent({
      organizationId: user.organizationId,
      actorType: "USER",
      actorId: user.id,
      action: AuditAction.SCAN_QUEUED,
      entityType: "repository",
      entityId: repository.id,
      correlationId,
      after: { scanId: scan.id, fixture: repository.metadata },
    });

    return jsonOk(
      { scanId: scan.id, repositoryId: repository.id, status: "QUEUED" },
      correlationId,
      202,
    );
  } catch (error) {
    return jsonError(error, correlationId);
  }
}
