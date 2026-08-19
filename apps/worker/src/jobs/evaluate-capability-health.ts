import { z } from "zod";
import { prisma, createNotification, NotificationType } from "@patchbay/db";
import { enforceCapabilityHealth, type CapabilityHealthVerdict } from "@patchbay/operations";
import { CapabilityGateStatus, logger } from "@patchbay/domain";
import type { Job } from "bullmq";

/**
 * evaluate-capability-health processor (WP10 auto-suspend).
 *
 * Evaluates the DRAFT_PR capability of one vendor for one organization over
 * a rolling window and suspends its CapabilityGate when the SLO thresholds
 * fail (merge rate, agent failure rate, agent latency p95). Suspension is
 * fail-loud: the draft-pr / validate routes refuse to enqueue while the gate
 * is closed, and only an admin restore reopens it.
 */

export const EvaluateCapabilityHealthJobDataSchema = z.object({
  organizationId: z.string().min(1),
  vendorSlug: z.string().min(1),
  correlationId: z.string().min(1),
});
export type EvaluateCapabilityHealthJobData = z.infer<typeof EvaluateCapabilityHealthJobDataSchema>;

export const CAPABILITY_HEALTH_DEFAULTS = {
  /** Rolling evaluation window in days. */
  windowDays: 30,
  /** Suspend when fewer than this % of terminal PRs merged. */
  minMergeRatePct: 50,
  /** Suspend when more than this % of agent runs failed / blew budget. */
  maxFailureRatePct: 50,
  /** Suspend when the p95 latency of successful agent runs exceeds this, ms. */
  maxLatencyP95Ms: 60_000,
} as const;

export async function processEvaluateCapabilityHealth(job: Job): Promise<CapabilityHealthVerdict> {
  const parsed = EvaluateCapabilityHealthJobDataSchema.safeParse(job.data);
  if (!parsed.success) {
    throw new Error(`invalid evaluate-capability-health job data: ${parsed.error.message}`);
  }
  const { organizationId, vendorSlug, correlationId } = parsed.data;

  const gateBefore = await prisma.capabilityGate.findUnique({
    where: {
      organizationId_vendorSlug_level: {
        organizationId,
        vendorSlug,
        level: "DRAFT_PR",
      },
    },
    select: { status: true, reason: true },
  });

  const verdict = await enforceCapabilityHealth(prisma, {
    organizationId,
    vendorSlug,
    level: "DRAFT_PR",
    ...CAPABILITY_HEALTH_DEFAULTS,
    correlationId,
  });

  const gateAfter = await prisma.capabilityGate.findUnique({
    where: {
      organizationId_vendorSlug_level: {
        organizationId,
        vendorSlug,
        level: "DRAFT_PR",
      },
    },
    select: { status: true, reason: true },
  });
  // Notify only on the transition into SUSPENDED so repeated unhealthy
  // evaluations do not spam the bell.
  if (
    gateAfter?.status === CapabilityGateStatus.SUSPENDED &&
    gateBefore?.status !== CapabilityGateStatus.SUSPENDED
  ) {
    await createNotification({
      organizationId,
      type: NotificationType.CAPABILITY_GATE_SUSPENDED,
      title: `Capability suspended: ${vendorSlug} DRAFT_PR`,
      body: gateAfter.reason ?? "Auto-suspended after failing SLO thresholds",
      correlationId,
    });
  }

  logger.info("capability health evaluated", {
    correlationId,
    organizationId,
    vendorSlug,
    healthy: verdict.healthy,
    hasData: verdict.hasData,
    reasons: verdict.reasons,
    metrics: verdict.metrics,
  });

  return verdict;
}
