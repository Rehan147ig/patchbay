import { prisma } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import {
  ActorType,
  CASE_TERMINAL_STATUSES,
  CaseStatus,
  conflict,
  notFound,
  validationFailed,
} from "@patchbay/domain";
import { enqueue, JobType } from "@patchbay/queue";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk, writeAuditEvent } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { assertCsrfToken } from "@/lib/csrf-server";

/**
 * POST /api/maintenance/cases/[id]/assess
 * Re-runs change analysis for the case's latest impact assessment
 * (ANALYZE_CHANGE on its change event). Terminal cases conflict; cases
 * without a release-funnel change event (contract-driven) fail closed —
 * their assessment path is the contract pipeline, not this vector.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(request);
  try {
    assertCsrfToken(request);
    const user = await requireRole("MEMBER");
    const { id } = await params;

    const remediationCase = await prisma.remediationCase.findFirst({
      where: { id, organizationId: user.organizationId },
      include: {
        impactAssessments: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });
    if (!remediationCase) {
      throw notFound("Maintenance case not found");
    }
    if (CASE_TERMINAL_STATUSES.has(remediationCase.status as CaseStatus)) {
      throw conflict("Case is already terminal; replay it to reassess");
    }
    const changeEventId = remediationCase.impactAssessments[0]?.changeEventId ?? null;
    if (!changeEventId) {
      throw validationFailed(
        "Case has no release-funnel change event to assess (contract-driven cases assess via the contract pipeline)",
      );
    }

    await enqueue(JobType.ANALYZE_CHANGE, {
      changeEventId,
      organizationId: user.organizationId,
      correlationId,
    });
    await writeAuditEvent({
      organizationId: user.organizationId,
      actorType: ActorType.USER,
      actorId: user.id,
      action: AuditAction.CHANGE_ANALYZED,
      entityType: "remediationCase",
      entityId: remediationCase.id,
      correlationId,
      after: { changeEventId },
    });
    return jsonOk(
      { caseId: remediationCase.id, changeEventId, status: "QUEUED" },
      correlationId,
      202,
    );
  } catch (error) {
    return jsonError(error, correlationId);
  }
}
