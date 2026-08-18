import { prisma, withOrgContext } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import { ActorType } from "@patchbay/domain";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk, writeAuditEvent } from "@/lib/api";
import { requireRole } from "@/lib/auth";

/**
 * GET /api/export
 * Admin-only JSONL export (WP10) of the organization's operational records:
 * cases, plans, pull requests, outcomes, validations, and agent-run telemetry
 * (digests and metadata only — never raw AI inputs/outputs, which are
 * retention-purged anyway). One audit event records the export.
 */
export async function GET(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  try {
    const user = await requireRole("ADMIN");
    const db = withOrgContext(prisma, user.organizationId);

    const [cases, plans, pullRequests, outcomes, validations, agentRuns] = await Promise.all([
      db.remediationCase.findMany({
        where: { organizationId: user.organizationId },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          scopeKey: true,
          status: true,
          reasonCode: true,
          capabilityLevel: true,
          validationProfile: true,
          blastRadius: true,
          policyDecision: true,
          terminalOutcome: true,
          terminalAt: true,
          createdAt: true,
        },
      }),
      db.remediationPlan.findMany({
        where: { organizationId: user.organizationId },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          remediationCaseId: true,
          status: true,
          strategy: true,
          confidence: true,
          requiresHumanReview: true,
          policyDecision: true,
          createdAt: true,
        },
      }),
      db.pullRequest.findMany({
        where: { organizationId: user.organizationId },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          remediationPlanId: true,
          provider: true,
          externalId: true,
          url: true,
          branchName: true,
          status: true,
          createdAt: true,
        },
      }),
      db.prOutcome.findMany({
        where: { organizationId: user.organizationId },
        orderBy: { createdAt: "asc" },
      }),
      db.validationRun.findMany({
        where: { organizationId: user.organizationId },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          remediationPlanId: true,
          status: true,
          commands: true,
          exitCode: true,
          runtimeMetadata: true,
          startedAt: true,
          completedAt: true,
          createdAt: true,
        },
      }),
      db.agentRun.findMany({
        where: { organizationId: user.organizationId },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          remediationCaseId: true,
          type: true,
          status: true,
          model: true,
          provider: true,
          promptTemplateVersion: true,
          redactedInputDigest: true,
          costEstimateCents: true,
          budgetCents: true,
          latencyMs: true,
          error: true,
          startedAt: true,
          completedAt: true,
          createdAt: true,
        },
      }),
    ]);

    await writeAuditEvent({
      organizationId: user.organizationId,
      actorType: ActorType.USER,
      actorId: user.id,
      action: AuditAction.DATA_EXPORTED,
      entityType: "organization",
      entityId: user.organizationId,
      correlationId,
      after: {
        counts: {
          cases: cases.length,
          plans: plans.length,
          pullRequests: pullRequests.length,
          outcomes: outcomes.length,
          validations: validations.length,
          agentRuns: agentRuns.length,
        },
      },
    });

    return jsonOk(
      {
        exportedAt: new Date().toISOString(),
        organizationId: user.organizationId,
        counts: {
          cases: cases.length,
          plans: plans.length,
          pullRequests: pullRequests.length,
          outcomes: outcomes.length,
          validations: validations.length,
          agentRuns: agentRuns.length,
        },
        data: {
          cases,
          plans,
          pullRequests,
          outcomes,
          validations,
          agentRuns,
        },
      },
      correlationId,
    );
  } catch (error) {
    return jsonError(error, correlationId);
  }
}
