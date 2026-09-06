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
import { assertDeliveryQuota } from "@/lib/billing";

/** Deterministic validation command set (ADR-0004 allowlist). */
const VALIDATION_COMMANDS = ["pnpm install --frozen-lockfile"];

const SKIPPED_MESSAGE =
  "Validation skipped: SANDBOX_VALIDATION_MODE=github-checks-only — Patch does not " +
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

    // Org scoping lives INSIDE the query (not a post-hoc check).
    const plan = await prisma.remediationPlan.findFirst({
      where: {
        id,
        impactAssessment: { repository: { organizationId: user.organizationId } },
      },
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
    // Certification requires a release change event's vendor. Contract-flow
    // plans (WP4) carry none and fail closed here until WP6 planning exists.
    const changeEvent = plan.impactAssessment.changeEvent;
    if (!changeEvent) {
      throw validationFailed("Plans without a release change event cannot be validated here");
    }
    const certification = requireCertified(changeEvent.vendor.slug, "VALIDATE");
    if (!certification.ok) {
      throw validationFailed(
        `Connector ${changeEvent.vendor.slug} is not certified for VALIDATE: ${certification.reasons.join("; ")}`,
      );
    }
    await assertCapabilityGateOpen(user.organizationId, changeEvent.vendor.slug, "VALIDATE");
    // Monthly validation budget first: fast 402 here, terminal refusal in the
    // worker — same math, two layers, never a silent execution past quota.
    await assertDeliveryQuota(user.organizationId, "VALIDATE");
    if (plan.patches.length === 0) {
      throw validationFailed("This plan has no patches to validate");
    }

    // Execution-plane profile (WP8): repo-specific wins, org default
    // (repositoryId null) is the fallback, deterministic by name. Null =
    // legacy static command set (still allowlist-enforced at execution).
    const repositoryId = plan.impactAssessment.repository.id as string | undefined;
    const repoProfile = repositoryId
      ? await prisma.validationProfile.findFirst({
          where: { organizationId: user.organizationId, repositoryId },
          orderBy: { name: "asc" },
        })
      : null;
    const validationProfile =
      repoProfile ??
      (await prisma.validationProfile.findFirst({
        where: { organizationId: user.organizationId, repositoryId: null },
        orderBy: { name: "asc" },
      }));
    const validationProfileId = validationProfile?.id ?? null;

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
          validationProfileId,
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
        validationProfileId,
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
      after: {
        validationRunId: validationRun.id,
        commands: VALIDATION_COMMANDS,
        validationProfileId,
      },
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
