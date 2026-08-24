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
 * validations, agent runs, graph data, scans, usages, deliveries) inside a
 * single transaction, so a partial wipe can never leave the tenant in a
 * half-deleted state. Keeps the organization, its users, repositories,
 * vendors, releases, and subscriptions.
 *
 * Audit history is intentionally OUT of erasure scope: the WORM trigger on
 * AuditEvent rejects any UPDATE/DELETE at the database level, so the trail
 * (including the DATA_DELETED marker written before the transaction) is
 * immutable proof of what was deleted, when, and by whom.
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

    const deleted = await prisma.$transaction(async (tx) => {
      const results = await Promise.all([
        tx.prOutcome.deleteMany({ where: { organizationId: orgId } }),
        tx.capabilityGate.deleteMany({ where: { organizationId: orgId } }),
        tx.approval.deleteMany({ where: { organizationId: orgId } }),
        tx.pullRequest.deleteMany({ where: { organizationId: orgId } }),
        tx.patchArtifact.deleteMany({ where: { organizationId: orgId } }),
        tx.validationRun.deleteMany({ where: { organizationId: orgId } }),
        tx.remediationCaseEvent.deleteMany({ where: { organizationId: orgId } }),
        tx.remediationCase.deleteMany({ where: { organizationId: orgId } }),
        tx.remediationPlan.deleteMany({ where: { organizationId: orgId } }),
        tx.impactAssessmentUsage.deleteMany({ where: { organizationId: orgId } }),
        tx.impactAssessment.deleteMany({ where: { organizationId: orgId } }),
        tx.agentStep.deleteMany({ where: { organizationId: orgId } }),
        tx.agentRun.deleteMany({ where: { organizationId: orgId } }),
        tx.graphSourceEvidence.deleteMany({ where: { organizationId: orgId } }),
        tx.graphEdge.deleteMany({ where: { organizationId: orgId } }),
        tx.graphNode.deleteMany({ where: { organizationId: orgId } }),
        tx.graphIndexJob.deleteMany({ where: { organizationId: orgId } }),
        tx.graphSnapshot.deleteMany({ where: { organizationId: orgId } }),
        tx.integrationUsage.deleteMany({ where: { organizationId: orgId } }),
        tx.repositoryScan.deleteMany({ where: { organizationId: orgId } }),
        tx.releaseRepositoryMatch.deleteMany({ where: { organizationId: orgId } }),
        tx.webhookDelivery.deleteMany({ where: { organizationId: orgId } }),
        tx.vendorChangeEvent.deleteMany({ where: { organizationId: orgId } }),
      ]);
      return results.reduce((sum, r) => sum + r.count, 0);
    });

    return jsonOk({ deleted }, correlationId);
  } catch (error) {
    return jsonError(error, correlationId);
  }
}
