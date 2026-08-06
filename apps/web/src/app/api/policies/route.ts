import { prisma, type Prisma } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import { conflict, policyCreateSchema } from "@patchbay/domain";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk, parseBody, writeAuditEvent } from "@/lib/api";
import { requireRole } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  try {
    const user = await requireRole("VIEWER");
    const policies = await prisma.policy.findMany({
      where: { organizationId: user.organizationId },
      orderBy: { createdAt: "asc" },
    });
    return jsonOk({ policies }, correlationId);
  } catch (error) {
    return jsonError(error, correlationId);
  }
}

export async function POST(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  try {
    const user = await requireRole("ADMIN");
    const input = await parseBody(request, policyCreateSchema);

    const existing = await prisma.policy.findUnique({
      where: { organizationId_name: { organizationId: user.organizationId, name: input.name } },
    });
    if (existing) throw conflict("A policy with this name already exists");

    const policy = await prisma.policy.create({
      data: {
        organizationId: user.organizationId,
        name: input.name,
        enabled: input.enabled,
        definitionJson: input.definitionJson as Prisma.InputJsonValue,
      },
    });

    await writeAuditEvent({
      organizationId: user.organizationId,
      actorType: "USER",
      actorId: user.id,
      action: AuditAction.POLICY_CREATED,
      entityType: "policy",
      entityId: policy.id,
      correlationId,
      after: { name: policy.name, enabled: policy.enabled },
    });

    return jsonOk({ policy }, correlationId, 201);
  } catch (error) {
    return jsonError(error, correlationId);
  }
}
