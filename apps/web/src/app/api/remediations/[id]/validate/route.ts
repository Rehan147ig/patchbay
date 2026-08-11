import { prisma } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import { ActorType, ValidationStatus, validationFailed } from "@patchbay/domain";
import { enqueue, JobType } from "@patchbay/queue";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk, writeAuditEvent } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { assertCsrfToken } from "@/lib/csrf";

/** Deterministic validation command set (ADR-0004 allowlist). */
const VALIDATION_COMMANDS = ["pnpm install --frozen-lockfile"];

/**
 * POST /api/remediations/[id]/validate
 * Creates a QUEUED ValidationRun and enqueues the run-validation job. The
 * worker applies the plan's patches to a disposable copy of the fixture
 * workspace and executes the allowlisted commands.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(request);
  try {
    assertCsrfToken(request);
    const user = await requireRole("MEMBER");
    const { id } = await params;

    const plan = await prisma.remediationPlan.findUnique({
      where: { id },
      include: {
        impactAssessment: { include: { repository: true } },
        patches: { select: { id: true } },
      },
    });
    if (!plan) throw validationFailed("Remediation plan not found");
    if (plan.impactAssessment.repository.organizationId !== user.organizationId) {
      throw validationFailed("Remediation plan not found");
    }
    if (plan.patches.length === 0) {
      throw validationFailed("This plan has no patches to validate");
    }

    const validationRun = await prisma.validationRun.create({
      data: {
        organizationId: user.organizationId,
        remediationPlanId: plan.id,
        status: ValidationStatus.QUEUED,
        commands: VALIDATION_COMMANDS as never,
      },
    });

    await enqueue(JobType.RUN_VALIDATION, {
      validationRunId: validationRun.id,
      remediationPlanId: plan.id,
      organizationId: user.organizationId,
      correlationId,
    });

    await writeAuditEvent({
      organizationId: user.organizationId,
      actorType: ActorType.USER,
      actorId: user.id,
      action: AuditAction.PLAN_VALIDATION_QUEUED,
      entityType: "remediationPlan",
      entityId: plan.id,
      correlationId,
      after: { validationRunId: validationRun.id, commands: VALIDATION_COMMANDS },
    });

    return jsonOk(
      { validationRunId: validationRun.id, remediationPlanId: plan.id, status: "QUEUED" },
      correlationId,
      202,
    );
  } catch (error) {
    return jsonError(error, correlationId);
  }
}
