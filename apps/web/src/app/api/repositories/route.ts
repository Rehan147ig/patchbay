import { prisma, type Prisma, withOrgContext } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import { repositoryCreateSchema, validationFailed } from "@patchbay/domain";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk, parseBody, writeAuditEvent } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { assertCsrfToken } from "@/lib/csrf-server";

export async function GET(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  try {
    const user = await requireRole("VIEWER");
    const db = withOrgContext(prisma, user.organizationId);
    const repositories = await db.repository.findMany({
      where: { organizationId: user.organizationId },
      orderBy: { createdAt: "asc" },
      include: {
        scans: { orderBy: { createdAt: "desc" }, take: 1 },
        _count: { select: { usages: true } },
      },
    });
    return jsonOk({ repositories }, correlationId);
  } catch (error) {
    return jsonError(error, correlationId);
  }
}

export async function POST(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  try {
    assertCsrfToken(request);
    const user = await requireRole("MEMBER");
    const input = await parseBody(request, repositoryCreateSchema);

    const existing = await prisma.repository.findUnique({
      where: {
        organizationId_externalId: {
          organizationId: user.organizationId,
          externalId: input.externalId ?? `local:${input.name}`,
        },
      },
    });
    if (existing) {
      throw validationFailed("A repository with this externalId is already registered");
    }

    const repository = await prisma.repository.create({
      data: {
        organizationId: user.organizationId,
        provider: input.provider,
        externalId: input.externalId ?? `local:${input.name}`,
        name: input.name,
        fullName: input.fullName,
        defaultBranch: input.defaultBranch,
        languageProfile: { typescript: true, packageManager: "pnpm" } as Prisma.InputJsonValue,
        status: "ACTIVE",
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });

    await writeAuditEvent({
      organizationId: user.organizationId,
      actorType: "USER",
      actorId: user.id,
      action: AuditAction.REPOSITORY_REGISTERED,
      entityType: "repository",
      entityId: repository.id,
      correlationId,
      after: { name: repository.name, provider: repository.provider },
    });

    return jsonOk({ repository }, correlationId, 201);
  } catch (error) {
    return jsonError(error, correlationId);
  }
}
