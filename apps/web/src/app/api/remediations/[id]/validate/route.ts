import { prisma } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import { ActorType, ValidationStatus, validationFailed } from "@patchbay/domain";
import { requireCertified } from "@patchbay/vendor-connectors";
import { enqueue, JobType } from "@patchbay/queue";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk, writeAuditEvent } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { assertCsrfToken } from "@/lib/csrf-server";
import { assertCapabilityGateOpen } from "@/lib/capability-gates";

/** Deterministic validation command set (ADR-0004 allowlist). */
const VALIDATION_COMMANDS = ["pnpm install --frozen-lockfile"];

const SKIPPED_MESSAGE =
  "Validation skipped: SANDBOX_VALIDATION_MODE=github-checks-only — Patchbay does not " +
  "execute customer code on this host; customer CI (GitHub checks) is the validation sandbox.";

/**
 * POST /api/remediations/[id]/validate
 * Creates a QUEUED ValidationRun and enqueues the run-validation job. The
 * worker applies the plan's patches to a disposable copy of the fixture
 * workspace and executes the allowlisted commands.
 *
 * With SANDBOX_VALIDATION_MODE=github-checks-only the run is created as
 * SKIPPED (never PASSED), nothing is enqueued, and customer CI is the
 * validation sandbox.
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
        impactAssessment: {
          include: {
            repository: true,
            changeEvent: { include: { vendor: { select: { slug: true } } } },
          },
        },
        patches: { select: { id: true } },
      },
    });
    if (!plan) throw validationFailed("Remediation plan not found");
    if (plan.impactAssessment.repository.organizationId !== user.organizationId) {
      throw validationFailed("Remediation plan not found");
    }
    const certification = requireCertified(
      plan.impactAssessment.changeEvent.vendor.slug,
      "VALIDATE",
    );
    if (!certification.ok) {
      throw validationFailed(
        `Connector ${plan.impactAssessment.changeEvent.vendor.slug} is not certified for VALIDATE: ${certification.reasons.join("; ")}`,
      );
    }
    await assertCapabilityGateOpen(
      user.organizationId,
      plan.impactAssessment.changeEvent.vendor.slug,
      "VALIDATE",
    );
    if (plan.patches.length === 0) {
      throw validationFailed("This plan has no patches to validate");
    }

    // github-checks-only: record the run as SKIPPED without enqueuing anything —
    // customer code never executes on this host. SKIPPED is not PASSED, so the
    // draft-PR policy gate still applies as-is.
    if (process.env.SANDBOX_VALIDATION_MODE === "github-checks-only") {
      const skippedRun = await prisma.validationRun.create({
        data: {
          organizationId: user.organizationId,
          remediationPlanId: plan.id,
          status: ValidationStatus.SKIPPED,
          commands: VALIDATION_COMMANDS as never,
          stdout: SKIPPED_MESSAGE,
          completedAt: new Date(),
        },
      });
      await writeAuditEvent({
        organizationId: user.organizationId,
        actorType: ActorType.USER,
        actorId: user.id,
        action: AuditAction.PLAN_VALIDATION_SKIPPED,
        entityType: "remediationPlan",
        entityId: plan.id,
        correlationId,
        after: { validationRunId: skippedRun.id, reason: "customer CI is the validation sandbox" },
      });
      return jsonOk(
        {
          validationRunId: skippedRun.id,
          remediationPlanId: plan.id,
          status: "SKIPPED",
        },
        correlationId,
        202,
      );
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
