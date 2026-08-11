import { prisma } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import { validationFailed } from "@patchbay/domain";
import { enqueue, JobType } from "@patchbay/queue";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk, writeAuditEvent } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { assertCsrfToken } from "@/lib/csrf";

/**
 * POST /api/vendor-changes/[id]/analyze
 * Enqueues an analyze-change job. The worker normalizes the raw payload into
 * NormalizedChange rows and (re)assesses impact per affected repository.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(request);
  try {
    assertCsrfToken(request);
    const user = await requireRole("MEMBER");
    const { id } = await params;

    const event = await prisma.vendorChangeEvent.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!event) {
      throw validationFailed("Change event not found");
    }

    await enqueue(JobType.ANALYZE_CHANGE, {
      changeEventId: event.id,
      organizationId: user.organizationId,
      correlationId,
    });

    await writeAuditEvent({
      organizationId: user.organizationId,
      actorType: "USER",
      actorId: user.id,
      action: AuditAction.CHANGE_ANALYZED,
      entityType: "vendorChangeEvent",
      entityId: event.id,
      correlationId,
      after: { title: event.title },
    });

    return jsonOk({ changeEventId: event.id, status: "QUEUED" }, correlationId, 202);
  } catch (error) {
    return jsonError(error, correlationId);
  }
}
