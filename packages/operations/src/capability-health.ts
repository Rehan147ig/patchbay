/**
 * Capability health evaluation + runtime kill switch (WP10).
 *
 * Certification (packages/vendor-connectors) is a static registry. This module
 * is the dynamic counterpart: it measures a vendor's certified capability
 * level against operational thresholds over a rolling window and suspends the
 * corresponding CapabilityGate when they fail. Suspended gates block the
 * DRAFT_PR / VALIDATE routes (assertCapabilityGateOpen) until an admin
 * restores them.
 *
 * Evaluation is deterministic over DB state: same window, same verdict.
 */
import { AuditAction } from "@patchbay/audit";
import {
  ActorType,
  CapabilityGateStatus,
  PrOutcomeClassification,
  PullRequestStatus,
  logger,
} from "@patchbay/domain";
import { buildAuditEvent } from "@patchbay/audit";

export interface PrismaLike {
  pullRequest: {
    findMany(args: unknown): Promise<Array<Record<string, unknown>>>;
  };
  agentRun: {
    findMany(args: unknown): Promise<Array<Record<string, unknown>>>;
  };
  capabilityGate: {
    upsert(args: unknown): Promise<Record<string, unknown>>;
  };
  auditEvent: {
    create(args: unknown): Promise<Record<string, unknown>>;
  };
}

export interface CapabilityHealthInput {
  organizationId: string;
  vendorSlug: string;
  level: string;
  /** Rolling evaluation window. */
  windowDays: number;
  /** Minimum share of terminal PRs that merged (0-100). */
  minMergeRatePct: number;
  /** Maximum share of agent runs that failed or blew their budget (0-100). */
  maxFailureRatePct: number;
  /** Maximum p95 latency of successful agent runs, ms. */
  maxLatencyP95Ms: number;
  correlationId: string;
  now?: Date;
}

export interface CapabilityHealthVerdict {
  vendorSlug: string;
  level: string;
  healthy: boolean;
  hasData: boolean;
  reasons: string[];
  metrics: {
    mergeRatePct: number | null;
    failureRatePct: number | null;
    latencyP95Ms: number | null;
    terminalPrCount: number;
    agentRunCount: number;
  };
}

export interface CapabilityGateWrite {
  organizationId: string;
  vendorSlug: string;
  level: string;
  status: CapabilityGateStatus;
  reason?: string | null;
  correlationId: string;
  /** Audit actor; defaults to SYSTEM (auto-suspend). */
  actorType?: ActorType;
  actorId?: string | null;
}

export interface CapabilityGateResult {
  id: string;
  status: CapabilityGateStatus;
  changed: boolean;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  const value = sorted[Math.max(0, Math.min(sorted.length - 1, index))];
  return value === undefined ? 0 : value;
}

export async function evaluateCapabilityHealth(
  prisma: PrismaLike,
  input: CapabilityHealthInput,
): Promise<CapabilityHealthVerdict> {
  const since = (input.now ?? new Date()).getTime() - input.windowDays * 86_400_000;

  const pullRequests = (await prisma.pullRequest.findMany({
    where: {
      organizationId: input.organizationId,
      status: { in: [PullRequestStatus.MERGED, PullRequestStatus.CLOSED] },
      createdAt: { gte: new Date(since) },
    },
    select: {
      status: true,
      remediationPlan: {
        select: {
          impactAssessment: {
            select: {
              changeEvent: { select: { vendor: { select: { slug: true } } } },
            },
          },
        },
      },
    },
  })) as Array<{
    status: string;
    remediationPlan: {
      impactAssessment: { changeEvent: { vendor: { slug: string } } };
    } | null;
  }>;

  const vendorPrs = pullRequests.filter(
    (pr) => pr.remediationPlan?.impactAssessment.changeEvent.vendor.slug === input.vendorSlug,
  );
  const merged = vendorPrs.filter((pr) => pr.status === PullRequestStatus.MERGED).length;
  const closed = vendorPrs.filter((pr) => pr.status === PullRequestStatus.CLOSED).length;
  const mergeRatePct = merged + closed > 0 ? Math.round((merged / (merged + closed)) * 100) : null;

  const agentRuns = (await prisma.agentRun.findMany({
    where: {
      organizationId: input.organizationId,
      createdAt: { gte: new Date(since) },
    },
    select: { status: true, latencyMs: true },
  })) as Array<{ status: string; latencyMs: number | null }>;

  const agentRunCount = agentRuns.length;
  const failed = agentRuns.filter(
    (run) => run.status === "FAILED" || run.status === "BUDGET_EXCEEDED",
  ).length;
  const failureRatePct = agentRunCount > 0 ? Math.round((failed / agentRunCount) * 100) : null;

  const latencies = agentRuns
    .filter((run) => run.status === "SUCCEEDED" && run.latencyMs !== null)
    .map((run) => run.latencyMs as number)
    .sort((a, b) => a - b);
  const latencyP95Ms = latencies.length > 0 ? percentile(latencies, 95) : null;

  const hasData = vendorPrs.length > 0 || agentRunCount > 0;
  const reasons: string[] = [];
  if (mergeRatePct !== null && mergeRatePct < input.minMergeRatePct) {
    reasons.push(
      `merge rate ${mergeRatePct}% below threshold ${input.minMergeRatePct}% ` +
        `(${merged} merged / ${merged + closed} terminal PRs)`,
    );
  }
  if (failureRatePct !== null && failureRatePct > input.maxFailureRatePct) {
    reasons.push(
      `agent failure rate ${failureRatePct}% above threshold ${input.maxFailureRatePct}% ` +
        `(${failed} of ${agentRunCount} runs)`,
    );
  }
  if (latencyP95Ms !== null && latencyP95Ms > input.maxLatencyP95Ms) {
    reasons.push(`agent latency p95 ${latencyP95Ms}ms above threshold ${input.maxLatencyP95Ms}ms`);
  }

  return {
    vendorSlug: input.vendorSlug,
    level: input.level,
    healthy: !hasData || reasons.length === 0,
    hasData,
    reasons,
    metrics: {
      mergeRatePct,
      failureRatePct,
      latencyP95Ms,
      terminalPrCount: vendorPrs.length,
      agentRunCount,
    },
  };
}

/**
 * Sets (or clears) a capability gate for an organization. Idempotent:
 * writing the same status twice reports changed:false. Writes an audit event.
 */
export async function setCapabilityGate(
  prisma: PrismaLike,
  input: CapabilityGateWrite,
): Promise<CapabilityGateResult> {
  const existing = await prisma.capabilityGate.upsert({
    where: {
      organizationId_vendorSlug_level: {
        organizationId: input.organizationId,
        vendorSlug: input.vendorSlug,
        level: input.level,
      },
    },
    create: {
      organizationId: input.organizationId,
      vendorSlug: input.vendorSlug,
      level: input.level,
      status: input.status,
      reason: input.reason ?? null,
      suspendedAt: input.status === CapabilityGateStatus.SUSPENDED ? new Date() : null,
    },
    update: {
      status: input.status,
      reason: input.reason ?? null,
      suspendedAt: input.status === CapabilityGateStatus.SUSPENDED ? new Date() : null,
    },
    select: { id: true, status: true },
  });

  const changed = existing.status !== input.status || Boolean(input.reason);
  if (changed) {
    await prisma.auditEvent.create({
      data: buildAuditEvent({
        organizationId: input.organizationId,
        actorType: input.actorType ?? ActorType.SYSTEM,
        actorId: input.actorId ?? null,
        action:
          input.status === CapabilityGateStatus.SUSPENDED
            ? AuditAction.CAPABILITY_GATE_SUSPENDED
            : AuditAction.CAPABILITY_GATE_CHANGED,
        entityType: "capabilityGate",
        entityId: existing.id as string,
        correlationId: input.correlationId,
        after: {
          vendorSlug: input.vendorSlug,
          level: input.level,
          status: input.status,
          reason: input.reason ?? null,
        },
      }),
    });
  }

  return { id: existing.id as string, status: existing.status as CapabilityGateStatus, changed };
}

/**
 * Evaluates a vendor capability and suspends it on threshold failure.
 * Returns the verdict; callers (worker job, web admin API) surface it.
 */
export async function enforceCapabilityHealth(
  prisma: PrismaLike,
  input: CapabilityHealthInput,
): Promise<CapabilityHealthVerdict> {
  const verdict = await evaluateCapabilityHealth(prisma, input);
  if (verdict.healthy) return verdict;

  await setCapabilityGate(prisma, {
    organizationId: input.organizationId,
    vendorSlug: input.vendorSlug,
    level: input.level,
    status: CapabilityGateStatus.SUSPENDED,
    reason: verdict.reasons.join("; "),
    correlationId: input.correlationId,
  });

  logger.warn("capability suspended after health evaluation", {
    correlationId: input.correlationId,
    organizationId: input.organizationId,
    vendorSlug: input.vendorSlug,
    level: input.level,
    reasons: verdict.reasons,
    metrics: verdict.metrics,
  });

  return verdict;
}

/** Classification codes that count as a false positive for SLO purposes. */
export const FALSE_POSITIVE_CLASSIFICATIONS: readonly PrOutcomeClassification[] = [
  PrOutcomeClassification.WRONG_IMPACT,
  PrOutcomeClassification.WRONG_PATCH,
  PrOutcomeClassification.INSUFFICIENT_TESTS,
  PrOutcomeClassification.VALIDATION_FAILURE,
];
