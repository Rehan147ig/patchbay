import { prisma, withOrgContext } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import { ActorType } from "@patchbay/domain";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk, writeAuditEvent } from "@/lib/api";
import { requireRole } from "@/lib/auth";

/**
 * GET /api/audit/export — alias of /api/export with audit-centric path.
 * Admin-only JSONL export of the organization's audit trail + operational records.
 * Single audit event per export; respects RLS + withOrgContext tenant isolation.
 */
export async function GET(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  try {
    const user = await requireRole("ADMIN");
    const db = withOrgContext(prisma, user.organizationId);

    const [auditEvents, remediationCases, outcomes] = await Promise.all([
      db.auditEvent.findMany({
        where: { organizationId: user.organizationId },
        orderBy: { createdAt: "asc" },
        take: 10000,
      }),
      db.remediationCase.findMany({
        where: { organizationId: user.organizationId },
        orderBy: { createdAt: "asc" },
        take: 1000,
        select: { id: true, scopeKey: true, status: true, reasonCode: true, createdAt: true },
      }),
      db.prOutcome.findMany({
        where: { organizationId: user.organizationId },
        orderBy: { createdAt: "asc" },
        take: 1000,
      }),
    ]);

    await writeAuditEvent({
      organizationId: user.organizationId,
      actorType: ActorType.USER,
      actorId: user.id,
      action: AuditAction.DATA_EXPORTED,
      entityType: "audit_export",
      entityId: user.organizationId,
      correlationId,
      after: {
        counts: {
          auditEvents: auditEvents.length,
          cases: remediationCases.length,
          outcomes: outcomes.length,
        },
      },
    });

    return jsonOk(
      {
        exportedAt: new Date().toISOString(),
        organizationId: user.organizationId,
        counts: {
          auditEvents: auditEvents.length,
          cases: remediationCases.length,
          outcomes: outcomes.length,
        },
        data: { auditEvents, remediationCases, outcomes },
      },
      correlationId,
    );
  } catch (error) {
    return jsonError(error, correlationId);
  }
}
