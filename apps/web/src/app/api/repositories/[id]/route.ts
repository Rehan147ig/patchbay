import { prisma } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import { ActorType, notFound, RepositoryStatus } from "@patchbay/domain";
import { z } from "zod";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk, parseBody, writeAuditEvent } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { assertCsrfToken } from "@/lib/csrf-server";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(request);
  try {
    const user = await requireRole("VIEWER");
    const { id } = await params;

    const repository = await prisma.repository.findFirst({
      where: { id, organizationId: user.organizationId },
      include: {
        scans: { orderBy: { createdAt: "desc" }, take: 5 },
        graphIndexJobs: { orderBy: { startedAt: "desc" }, take: 5 },
        usages: {
          orderBy: [{ filePath: "asc" }, { createdAt: "asc" }],
          include: { vendor: true },
        },
        impactAssessments: {
          include: { changeEvent: true },
          orderBy: { createdAt: "desc" },
          take: 10,
        },
      },
    });

    if (!repository) throw notFound("Repository not found");
    return jsonOk({ repository }, correlationId);
  } catch (error) {
    return jsonError(error, correlationId);
  }
}

const repositoryStatusSchema = z.object({
  status: z.enum([RepositoryStatus.ACTIVE, RepositoryStatus.ARCHIVED]),
});

/**
 * PATCH /api/repositories/[id]
 * Toggles repository monitoring (WP12 onboarding fleet selection): ACTIVE =
 * monitored by Patchbay, ARCHIVED = ignored by scans and sweeps. MEMBER and
 * above; every transition audited (archived vs restored distinctly).
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(request);
  try {
    assertCsrfToken(request);
    const user = await requireRole("MEMBER");
    const { id } = await params;
    const input = await parseBody(request, repositoryStatusSchema);

    const repository = await prisma.repository.findFirst({
      where: { id, organizationId: user.organizationId },
      select: { id: true, status: true, fullName: true },
    });
    if (!repository) throw notFound("Repository not found");
    if (repository.status === input.status) {
      return jsonOk({ repository, unchanged: true }, correlationId);
    }
    const updated = await prisma.repository.update({
      where: { id: repository.id },
      data: { status: input.status },
    });
    await writeAuditEvent({
      organizationId: user.organizationId,
      actorType: ActorType.USER,
      actorId: user.id,
      action:
        input.status === RepositoryStatus.ARCHIVED
          ? AuditAction.REPOSITORY_ARCHIVED
          : AuditAction.REPOSITORY_RESTORED,
      entityType: "repository",
      entityId: repository.id,
      correlationId,
      before: { status: repository.status },
      after: { status: updated.status },
    });
    return jsonOk({ repository: updated, unchanged: false }, correlationId);
  } catch (error) {
    return jsonError(error, correlationId);
  }
}
