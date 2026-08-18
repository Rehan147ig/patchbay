import { prisma } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import { ActorType } from "@patchbay/domain";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk, writeAuditEvent } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { assertCsrfToken } from "@/lib/csrf-server";

/**
 * DELETE /api/data
 * Admin-only organization data deletion (WP10). Removes every operational
 * record of the caller's organization (cases, plans, PRs, outcomes,
 * validations, agent runs, graph data, scans, usages, deliveries). Keeps the
 * organization, its users, repositories, vendors, releases, and subscriptions.
 *
 * The single DATA_DELETED audit event is written before deletion and survives
 * it, so there is an immutable proof of deletion for compliance.
 */
export async function DELETE(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  try {
    assertCsrfToken(request);
    const user = await requireRole("ADMIN");
    const orgId = user.organizationId;

    await writeAuditEvent({
      organizationId: orgId,
      actorType: ActorType.USER,
      actorId: user.id,
      action: AuditAction.DATA_DELETED,
      entityType: "organization",
      entityId: orgId,
      correlationId,
      after: { scope: "operational records" },
    });

    const deletes = await Promise.all([
      prisma.prOutcome.deleteMany({ where: { organizationId: orgId } }),
      prisma.capabilityGate.deleteMany({ where: { organizationId: orgId } }),
      prisma.approval.deleteMany({ where: { organizationId: orgId } }),
      prisma.pullRequest.deleteMany({ where: { organizationId: orgId } }),
      prisma.patchArtifact.deleteMany({ where: { organizationId: orgId } }),
      prisma.validationRun.deleteMany({ where: { organizationId: orgId } }),
      prisma.remediationCaseEvent.deleteMany({ where: { organizationId: orgId } }),
      prisma.remediationCase.deleteMany({ where: { organizationId: orgId } }),
      prisma.remediationPlan.deleteMany({ where: { organizationId: orgId } }),
      prisma.impactAssessmentUsage.deleteMany({ where: { organizationId: orgId } }),
      prisma.impactAssessment.deleteMany({ where: { organizationId: orgId } }),
      prisma.agentStep.deleteMany({ where: { organizationId: orgId } }),
      prisma.agentRun.deleteMany({ where: { organizationId: orgId } }),
      prisma.graphSourceEvidence.deleteMany({ where: { organizationId: orgId } }),
      prisma.graphEdge.deleteMany({ where: { organizationId: orgId } }),
      prisma.graphNode.deleteMany({ where: { organizationId: orgId } }),
      prisma.graphIndexJob.deleteMany({ where: { organizationId: orgId } }),
      prisma.graphSnapshot.deleteMany({ where: { organizationId: orgId } }),
      prisma.integrationUsage.deleteMany({ where: { organizationId: orgId } }),
      prisma.repositoryScan.deleteMany({ where: { organizationId: orgId } }),
      prisma.releaseRepositoryMatch.deleteMany({ where: { organizationId: orgId } }),
      prisma.webhookDelivery.deleteMany({ where: { organizationId: orgId } }),
      prisma.vendorChangeEvent.deleteMany({ where: { organizationId: orgId } }),
    ]);

    // The DATA_DELETED marker is the only audit row that remains.
    await prisma.auditEvent.deleteMany({
      where: { organizationId: orgId, action: { not: AuditAction.DATA_DELETED } },
    });

    return jsonOk({ deleted: deletes.reduce((sum, r) => sum + r.count, 0) }, correlationId);
  } catch (error) {
    return jsonError(error, correlationId);
  }
}
