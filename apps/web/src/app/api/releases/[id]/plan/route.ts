import { prisma } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import { CASE_TERMINAL_STATUSES, CaseStatus, validationFailed } from "@patchbay/domain";
import { enqueue, JobType } from "@patchbay/queue";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk, writeAuditEvent } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { assertCsrfToken } from "@/lib/csrf-server";

/**
 * POST /api/releases/[id]/plan
 * Creates an AgentRun (analyst -> planner -> reviewer, one queue job) for a
 * matched release+repository pair and returns the run id. Replays are
 * idempotent: a non-terminal run for the same match is returned as-is.
 *
 * WP3 gate: planning is only allowed when the release's RemediationCase is
 * POLICY_ELIGIBLE (or already PLANNING for a replay). Denied cases return
 * their status + reasonCode and never create an AgentRun.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(request);
  try {
    assertCsrfToken(request);
    const user = await requireRole("MEMBER");
    const { id } = await params;

    const release = await prisma.releaseRecord.findUnique({
      where: { id },
      include: { product: { include: { vendor: true } } },
    });
    if (!release) {
      throw validationFailed("Release not found");
    }

    const body = (await request.json().catch(() => ({}))) as { matchId?: unknown };
    const matchId = typeof body.matchId === "string" ? body.matchId : "";
    const match = await prisma.releaseRepositoryMatch.findFirst({
      where: { id: matchId, releaseRecordId: release.id, organizationId: user.organizationId },
      select: { id: true, repositoryId: true, dependencyId: true },
    });
    if (!match) {
      throw validationFailed("Match not found for this release");
    }

    const remediationCase = await prisma.remediationCase.findFirst({
      where: {
        organizationId: user.organizationId,
        releaseId: release.id,
        releaseRepositoryMatchId: match.id,
      },
      select: { id: true, status: true, reasonCode: true },
    });
    if (!remediationCase) {
      return jsonOk(
        {
          eligible: false,
          status: "IMPACT_CONFIRMED",
          reasonCode: "insufficient-evidence",
          message: "No remediation case exists for this match yet.",
        },
        correlationId,
      );
    }
    const planningAllowed =
      remediationCase.status === "POLICY_ELIGIBLE" || remediationCase.status === "PLANNING";
    if (!planningAllowed) {
      const terminal = CASE_TERMINAL_STATUSES.has(remediationCase.status as CaseStatus);
      return jsonOk(
        {
          eligible: false,
          status: remediationCase.status,
          reasonCode: remediationCase.reasonCode,
          terminal,
          message: terminal
            ? "This case is closed; replay it from the case page to reopen planning."
            : "This case cannot be planned automatically.",
        },
        correlationId,
      );
    }

    const existing = await prisma.agentRun.findFirst({
      where: {
        organizationId: user.organizationId,
        releaseRecordId: release.id,
        releaseRepositoryMatchId: match.id,
        status: { in: ["QUEUED", "RUNNING", "SUCCEEDED"] },
      },
      orderBy: { createdAt: "desc" },
    });
    if (existing) {
      return jsonOk(
        { eligible: true, agentRunId: existing.id, replay: true, status: existing.status },
        correlationId,
      );
    }

    const run = await prisma.agentRun.create({
      data: {
        organizationId: user.organizationId,
        releaseRecordId: release.id,
        repositoryId: match.repositoryId,
        releaseRepositoryMatchId: match.id,
        remediationCaseId: remediationCase.id,
        type: "PLAN_REVIEW",
        status: "QUEUED",
        correlationId,
        model: "pending",
        promptTemplateVersion: "h3-plan-v1",
        redactedInputDigest: "",
        inputJson: { matchId: match.id },
      },
    });

    await prisma.$transaction([
      prisma.remediationCase.update({
        where: { id: remediationCase.id },
        data: { status: "PLANNING" },
      }),
      prisma.remediationCaseEvent.create({
        data: {
          organizationId: user.organizationId,
          remediationCaseId: remediationCase.id,
          status: "PLANNING",
          reasonCode: remediationCase.reasonCode,
          detailJson: { agentRunId: run.id },
          correlationId,
        },
      }),
    ]);

    await enqueue(JobType.AGENT_PLAN, {
      agentRunId: run.id,
      correlationId,
    });

    await writeAuditEvent({
      organizationId: user.organizationId,
      actorType: "USER",
      actorId: user.id,
      action: AuditAction.AGENT_RUN_QUEUED,
      entityType: "agentRun",
      entityId: run.id,
      correlationId,
      after: {
        releaseRecordId: release.id,
        repositoryId: match.repositoryId,
        matchId: match.id,
        remediationCaseId: remediationCase.id,
        packageName: release.product.packageName,
        version: release.version,
      },
    });

    return jsonOk(
      {
        eligible: true,
        agentRunId: run.id,
        status: "QUEUED",
        releaseId: release.id,
        matchId: match.id,
      },
      correlationId,
      202,
    );
  } catch (error) {
    return jsonError(error, correlationId);
  }
}
