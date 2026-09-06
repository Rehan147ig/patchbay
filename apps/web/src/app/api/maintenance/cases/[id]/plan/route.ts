import { prisma } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import { ActorType, CASE_TERMINAL_STATUSES, CaseStatus } from "@patchbay/domain";
import { enqueue, JobType } from "@patchbay/queue";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk, writeAuditEvent } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { assertCsrfToken } from "@/lib/csrf-server";

/**
 * POST /api/maintenance/cases/[id]/plan
 * Starts agent planning (analyst → planner → reviewer) for a case, ported
 * from the release plan vector to case scope: eligibility is POLICY_ELIGIBLE
 * (or a PLANNING replay), replays are idempotent on non-terminal runs, and
 * the case moves to PLANNING with a timeline event. Anything else returns
 * eligibility details instead of failing — the UI renders next actions from
 * them, never a dead button.
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
        release: { select: { id: true } },
      },
    });
    if (!remediationCase) {
      return jsonOk(
        {
          eligible: false,
          status: "NOT_FOUND",
          message: "Maintenance case not found in this organization.",
        },
        correlationId,
        404,
      );
    }
    if (!remediationCase.releaseId || !remediationCase.releaseRepositoryMatchId) {
      const terminal = CASE_TERMINAL_STATUSES.has(remediationCase.status as CaseStatus);
      return jsonOk(
        {
          eligible: false,
          status: remediationCase.status,
          reasonCode: remediationCase.reasonCode,
          terminal,
          message:
            "Agent planning needs a release-funnel match (release + repository). " +
            "Contract-driven cases plan through the contract pipeline.",
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
            : "This case cannot be planned automatically in its current state.",
        },
        correlationId,
      );
    }

    const existing = await prisma.agentRun.findFirst({
      where: {
        organizationId: user.organizationId,
        remediationCaseId: remediationCase.id,
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
        releaseRecordId: remediationCase.releaseId,
        repositoryId: remediationCase.repositoryId,
        releaseRepositoryMatchId: remediationCase.releaseRepositoryMatchId,
        remediationCaseId: remediationCase.id,
        type: "PLAN_REVIEW",
        status: "QUEUED",
        correlationId,
        model: "pending",
        promptTemplateVersion: "h3-plan-v1",
        redactedInputDigest: "",
        inputJson: { caseId: remediationCase.id },
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
      actorType: ActorType.USER,
      actorId: user.id,
      action: AuditAction.AGENT_RUN_QUEUED,
      entityType: "agentRun",
      entityId: run.id,
      correlationId,
      after: {
        releaseRecordId: remediationCase.releaseId,
        repositoryId: remediationCase.repositoryId,
        remediationCaseId: remediationCase.id,
      },
    });

    return jsonOk(
      {
        eligible: true,
        agentRunId: run.id,
        status: "QUEUED",
        caseId: remediationCase.id,
      },
      correlationId,
      202,
    );
  } catch (error) {
    return jsonError(error, correlationId);
  }
}
