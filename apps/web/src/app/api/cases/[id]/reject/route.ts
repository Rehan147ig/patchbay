import { prisma } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import {
  ActorType,
  CASE_TERMINAL_STATUSES,
  CaseReasonCode,
  CaseStatus,
  CaseTerminalOutcome,
  conflict,
  notFound,
} from "@patchbay/domain";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk, writeAuditEvent } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { assertCsrfToken } from "@/lib/csrf-server";

/**
 * POST /api/cases/[id]/reject
 * Terminates a non-terminal case as REJECTED (owner decision). The case
 * stays visible with its terminalOutcome; only a replay can reopen it.
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
    if (CASE_TERMINAL_STATUSES.has(remediationCase.status as CaseStatus)) {
      throw conflict("Case is already terminal");
    }

    const updated = await prisma.remediationCase.update({
      where: { id: remediationCase.id },
      data: {
        status: CaseStatus.REJECTED,
        reasonCode: CaseReasonCode.REJECTED_BY_OWNER,
        terminalOutcome: CaseTerminalOutcome.REJECTED,
        terminalAt: new Date(),
      },
    });

    await prisma.remediationCaseEvent.create({
      data: {
        organizationId: user.organizationId,
        remediationCaseId: remediationCase.id,
        status: CaseStatus.REJECTED,
        reasonCode: CaseReasonCode.REJECTED_BY_OWNER,
        correlationId,
      },
    });
    await writeAuditEvent({
      organizationId: user.organizationId,
      actorType: ActorType.USER,
      actorId: user.id,
      action: AuditAction.CASE_REJECTED,
      entityType: "remediationCase",
      entityId: remediationCase.id,
      correlationId,
      after: { status: updated.status },
    });

    return jsonOk({ caseId: remediationCase.id, status: updated.status }, correlationId);
  } catch (error) {
    return jsonError(error, correlationId);
  }
}
