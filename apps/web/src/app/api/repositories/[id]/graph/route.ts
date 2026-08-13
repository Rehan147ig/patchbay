import { z } from "zod";
import { prisma, latestSnapshot, packageImpact } from "@patchbay/db";
import { validationFailed } from "@patchbay/domain";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk } from "@/lib/api";
import { requireRole } from "@/lib/auth";

const QuerySchema = z.object({
  package: z.string().min(1).optional(),
});

/**
 * GET /api/repositories/[id]/graph
 * Latest READY graph snapshot plus evidence for that repository. With
 * ?package=<name> it returns why-affected evidence: the resolved version the
 * repository pins, every module using the package, and evidence density per
 * module — all derived from graph edges.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(request);
  try {
    const user = await requireRole("MEMBER");
    const { id } = await params;
    const query = QuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));

    const repository = await prisma.repository.findFirst({
      where: { id, organizationId: user.organizationId },
      select: { id: true, name: true, fullName: true },
    });
    if (!repository) {
      throw validationFailed("Repository not found");
    }

    const snapshot = await latestSnapshot({
      organizationId: user.organizationId,
      repositoryId: repository.id,
    });
    if (!snapshot) {
      return jsonOk(
        {
          repository,
          snapshot: null,
          evidence: null,
          jobs: await prisma.graphIndexJob.findMany({
            where: { organizationId: user.organizationId, repositoryId: repository.id },
            orderBy: { startedAt: "desc" },
            take: 10,
            select: {
              id: true,
              mode: true,
              status: true,
              changedPaths: true,
              error: true,
              startedAt: true,
              completedAt: true,
            },
          }),
        },
        correlationId,
      );
    }

    const impact = query.package
      ? await packageImpact({
          organizationId: user.organizationId,
          repositoryId: repository.id,
          packageName: query.package,
        })
      : null;

    return jsonOk(
      {
        repository,
        snapshot,
        evidence: impact,
        jobs: await prisma.graphIndexJob.findMany({
          where: { organizationId: user.organizationId, repositoryId: repository.id },
          orderBy: { startedAt: "desc" },
          take: 10,
          select: {
            id: true,
            mode: true,
            status: true,
            changedPaths: true,
            error: true,
            startedAt: true,
            completedAt: true,
          },
        }),
      },
      correlationId,
    );
  } catch (error) {
    return jsonError(error, correlationId);
  }
}
