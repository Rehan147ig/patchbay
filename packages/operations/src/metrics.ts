/**
 * SLO / operations metrics (WP10). Deterministic rollups over DB state for
 * one organization and window:
 *
 * - detection latency (p95 of detector polls)
 * - sandbox pass rate (validation runs)
 * - plan acceptance rate (validated / actionable plans)
 * - PR merge rate and outcome rollup
 * - false positive rate (wrong impact/patch, insufficient tests, validation failure)
 * - cost per successful remediation (agent cost / merged PRs)
 * - agent failure rate and budget-exceeded count
 * - time to remediation (case terminal - case created)
 */
import { PrOutcomeClassification, PullRequestStatus } from "@patchbay/domain";

export interface MetricsPrisma {
  detectionRun: {
    findMany(args: unknown): Promise<Array<Record<string, unknown>>>;
  };
  validationRun: {
    groupBy(args: unknown): Promise<Array<Record<string, unknown>>>;
  };
  remediationPlan: {
    groupBy(args: unknown): Promise<Array<Record<string, unknown>>>;
  };
  prOutcome: {
    groupBy(args: unknown): Promise<Array<Record<string, unknown>>>;
    count(args: unknown): Promise<number>;
  };
  pullRequest: {
    groupBy(args: unknown): Promise<Array<Record<string, unknown>>>;
  };
  agentRun: {
    groupBy(args: unknown): Promise<Array<Record<string, unknown>>>;
    aggregate(args: unknown): Promise<Array<Record<string, unknown>> | Record<string, unknown>>;
  };
  remediationCase: {
    findMany(args: unknown): Promise<Array<Record<string, unknown>>>;
  };
  auditEvent: {
    count(args: unknown): Promise<number>;
  };
}

export interface OrganizationMetrics {
  windowDays: number;
  detection: {
    runCount: number;
    latencyP95Ms: number | null;
  };
  sandbox: {
    passed: number;
    failed: number;
    passRatePct: number | null;
  };
  plans: {
    total: number;
    validated: number;
    acceptancePct: number | null;
  };
  pullRequests: {
    merged: number;
    closed: number;
    open: number;
    mergeRatePct: number | null;
  };
  outcomes: {
    total: number;
    classified: number;
    success: number;
    falsePositive: number;
    falsePositiveRatePct: number | null;
    byClassification: Partial<Record<PrOutcomeClassification, number>>;
  };
  agent: {
    runCount: number;
    failed: number;
    failureRatePct: number | null;
    budgetExceeded: number;
    costTotalCents: number;
    costPerSuccessfulRemediationCents: number | null;
  };
  timeToRemediationHours: number | null;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  const value = sorted[Math.max(0, Math.min(sorted.length - 1, index))];
  return value === undefined ? 0 : value;
}

export interface ComputeMetricsInput {
  organizationId: string;
  windowDays: number;
  now?: Date;
}

export async function computeOrganizationMetrics(
  prisma: MetricsPrisma,
  input: ComputeMetricsInput,
): Promise<OrganizationMetrics> {
  const since = (input.now ?? new Date()).getTime() - input.windowDays * 86_400_000;
  const sinceDate = new Date(since);

  const [detectionRuns, validationGroups, planGroups, outcomeGroups, outcomeCount, prGroups] =
    await Promise.all([
      prisma.detectionRun.findMany({
        where: { startedAt: { gte: sinceDate } },
        select: { latencyMs: true },
      }),
      prisma.validationRun.groupBy({
        by: ["status"],
        where: { organizationId: input.organizationId, createdAt: { gte: sinceDate } },
        _count: { _all: true },
      }),
      prisma.remediationPlan.groupBy({
        by: ["status"],
        where: { organizationId: input.organizationId, createdAt: { gte: sinceDate } },
        _count: { _all: true },
      }),
      prisma.prOutcome.groupBy({
        by: ["classification"],
        where: { organizationId: input.organizationId, createdAt: { gte: sinceDate } },
        _count: { _all: true },
      }),
      prisma.prOutcome.count({ where: { organizationId: input.organizationId } }),
      prisma.pullRequest.groupBy({
        by: ["status"],
        where: { organizationId: input.organizationId, createdAt: { gte: sinceDate } },
        _count: { _all: true },
      }),
    ]);

  const [agentGroups, costAggregate, terminalCases] = await Promise.all([
    prisma.agentRun.groupBy({
      by: ["status"],
      where: { organizationId: input.organizationId, createdAt: { gte: sinceDate } },
      _count: { _all: true },
    }),
    prisma.agentRun.aggregate({
      where: { organizationId: input.organizationId, createdAt: { gte: sinceDate } },
      _sum: { costEstimateCents: true },
    }),
    prisma.remediationCase.findMany({
      where: {
        organizationId: input.organizationId,
        terminalAt: { not: null },
        createdAt: { gte: sinceDate },
      },
      select: { createdAt: true, terminalAt: true },
    }),
  ]);

  const countOf = (groups: Array<Record<string, unknown>>, by: string, value: string): number => {
    const group = groups.find((g) => g[by] === value);
    const count = (group?._count as { _all?: number } | undefined)?._all;
    return count ?? 0;
  };

  const latencies = (detectionRuns as Array<{ latencyMs: number | null }>)
    .map((run) => run.latencyMs)
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);

  const sandboxPassed = countOf(validationGroups, "status", "PASSED");
  const sandboxFailed = countOf(validationGroups, "status", "FAILED");
  const plansTotal = planGroups.reduce(
    (sum, g) => sum + (((g._count as { _all?: number } | undefined)?._all ?? 0) as number),
    0,
  );
  const plansValidated = countOf(planGroups, "status", "VALIDATED");

  const merged = countOf(prGroups, "status", PullRequestStatus.MERGED);
  const closed = countOf(prGroups, "status", PullRequestStatus.CLOSED);
  const open = countOf(prGroups, "status", PullRequestStatus.OPEN);

  const byClassification = {} as Partial<Record<PrOutcomeClassification, number>>;
  let success = 0;
  let falsePositive = 0;
  for (const group of outcomeGroups) {
    const classification = group.classification as PrOutcomeClassification;
    const n = (((group._count as { _all?: number } | undefined)?._all ?? 0) as number) ?? 0;
    byClassification[classification] = n;
    if (classification === PrOutcomeClassification.SUCCESS) success = n;
    if (
      classification === PrOutcomeClassification.WRONG_IMPACT ||
      classification === PrOutcomeClassification.WRONG_PATCH ||
      classification === PrOutcomeClassification.INSUFFICIENT_TESTS ||
      classification === PrOutcomeClassification.VALIDATION_FAILURE
    ) {
      falsePositive += n;
    }
  }
  const classified =
    (byClassification[PrOutcomeClassification.SUCCESS] ?? 0) +
    (byClassification[PrOutcomeClassification.WRONG_IMPACT] ?? 0) +
    (byClassification[PrOutcomeClassification.WRONG_PATCH] ?? 0) +
    (byClassification[PrOutcomeClassification.INSUFFICIENT_TESTS] ?? 0) +
    (byClassification[PrOutcomeClassification.VALIDATION_FAILURE] ?? 0) +
    (byClassification[PrOutcomeClassification.MANUAL_EDITS] ?? 0) +
    (byClassification[PrOutcomeClassification.POLICY_PREFERENCE] ?? 0);

  const agentRunCount = agentGroups.reduce(
    (sum, g) => sum + (((g._count as { _all?: number } | undefined)?._all ?? 0) as number),
    0,
  );
  const agentFailed =
    countOf(agentGroups, "status", "FAILED") + countOf(agentGroups, "status", "BUDGET_EXCEEDED");
  const budgetExceeded = countOf(agentGroups, "status", "BUDGET_EXCEEDED");
  const costTotalCents =
    (costAggregate as { _sum?: { costEstimateCents: number | null } })._sum?.costEstimateCents ?? 0;

  const durationsHours = (terminalCases as Array<{ createdAt: Date; terminalAt: Date }>)
    .map((c) => (c.terminalAt.getTime() - c.createdAt.getTime()) / 3_600_000)
    .filter((h) => h >= 0);

  return {
    windowDays: input.windowDays,
    detection: {
      runCount: detectionRuns.length,
      latencyP95Ms: latencies.length > 0 ? percentile(latencies, 95) : null,
    },
    sandbox: {
      passed: sandboxPassed,
      failed: sandboxFailed,
      passRatePct:
        sandboxPassed + sandboxFailed > 0
          ? Math.round((sandboxPassed / (sandboxPassed + sandboxFailed)) * 100)
          : null,
    },
    plans: {
      total: plansTotal,
      validated: plansValidated,
      acceptancePct: plansTotal > 0 ? Math.round((plansValidated / plansTotal) * 100) : null,
    },
    pullRequests: {
      merged,
      closed,
      open,
      mergeRatePct: merged + closed > 0 ? Math.round((merged / (merged + closed)) * 100) : null,
    },
    outcomes: {
      total: outcomeCount,
      classified,
      success,
      falsePositive,
      falsePositiveRatePct: classified > 0 ? Math.round((falsePositive / classified) * 100) : null,
      byClassification,
    },
    agent: {
      runCount: agentRunCount,
      failed: agentFailed,
      failureRatePct: agentRunCount > 0 ? Math.round((agentFailed / agentRunCount) * 100) : null,
      budgetExceeded,
      costTotalCents,
      costPerSuccessfulRemediationCents:
        merged + success > 0 ? Math.round(costTotalCents / (merged + success)) : null,
    },
    timeToRemediationHours:
      durationsHours.length > 0
        ? Math.round((durationsHours.reduce((a, b) => a + b, 0) / durationsHours.length) * 10) / 10
        : null,
  };
}
