import { prisma, type Prisma } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import { notFound, policyUpdateSchema } from "@patchbay/domain";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk, parseBody, writeAuditEvent } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { assertCsrfToken } from "@/lib/csrf";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(request);
  try {
    assertCsrfToken(request);
    const user = await requireRole("ADMIN");
    const { id } = await params;
    const input = await parseBody(request, policyUpdateSchema);

    const existing = await prisma.policy.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!existing) throw notFound("Policy not found");

    const policy = await prisma.policy.update({
      where: { id },
      data: {
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.definitionJson !== undefined
          ? { definitionJson: input.definitionJson as Prisma.InputJsonValue }
          : {}),
      },
    });

    await writeAuditEvent({
      organizationId: user.organizationId,
      actorType: "USER",
      actorId: user.id,
      action: AuditAction.POLICY_UPDATED,
      entityType: "policy",
      entityId: policy.id,
      correlationId,
      before: { enabled: existing.enabled, name: existing.name },
      after: { enabled: policy.enabled, name: policy.name },
    });

    return jsonOk({ policy }, correlationId);
  } catch (error) {
    return jsonError(error, correlationId);
  }
}
