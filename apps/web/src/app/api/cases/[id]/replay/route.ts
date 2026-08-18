import { prisma } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import {
  ActorType,
  CASE_TERMINAL_STATUSES,
  CaseReasonCode,
  CaseStatus,
  conflict,
  notFound,
} from "@patchbay/domain";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk, writeAuditEvent } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { assertCsrfToken } from "@/lib/csrf-server";

/**
 * POST /api/cases/[id]/replay
 * Reopens a terminal case (CANCELLED or REJECTED by the owner) back to
 * POLICY_ELIGIBLE. Outcome-derived terminal states (MERGED/CLOSED/LEARNED)
 * are never replayable. Model budget is only spent if the user plans again.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(request);
  try {
    assertCsrfToken(request);
    const user = await requireRole("MEMBER");
    const { id } = await params;

    const remediationCase = await prisma.remediationCase.findFirst({
      where: { id, organizationId: user.organizationId },
      select: { id: true, status: true, reasonCode: true },
    });
    if (!remediationCase) {
      throw notFound("Remediation case not found");
    }
    if (!CASE_TERMINAL_STATUSES.has(remediationCase.status as CaseStatus)) {
      throw conflict("Case is not terminal; nothing to replay");
    }
    if (
      remediationCase.status === CaseStatus.MERGED ||
      remediationCase.status === CaseStatus.CLOSED ||
      remediationCase.status === CaseStatus.LEARNED
    ) {
      throw conflict("Outcome-derived terminal cases cannot be replayed");
    }

    const updated = await prisma.remediationCase.update({
      where: { id: remediationCase.id },
      data: {
        status: CaseStatus.POLICY_ELIGIBLE,
        reasonCode: CaseReasonCode.REPLAYED,
        terminalOutcome: null,
        terminalAt: null,
      },
    });

    await prisma.remediationCaseEvent.create({
      data: {
        organizationId: user.organizationId,
        remediationCaseId: remediationCase.id,
        status: CaseStatus.POLICY_ELIGIBLE,
        reasonCode: CaseReasonCode.REPLAYED,
        correlationId,
      },
    });
    await writeAuditEvent({
      organizationId: user.organizationId,
      actorType: ActorType.USER,
      actorId: user.id,
      action: AuditAction.CASE_REPLAYED,
      entityType: "remediationCase",
      entityId: remediationCase.id,
      correlationId,
      after: { from: remediationCase.status, status: updated.status },
    });

    return jsonOk({ caseId: remediationCase.id, status: updated.status }, correlationId);
  } catch (error) {
    return jsonError(error, correlationId);
  }
}
