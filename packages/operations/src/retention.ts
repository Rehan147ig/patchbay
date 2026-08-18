/**
 * Retention policy (WP10): purges the AI payloads of terminal agent runs
 * once they pass the retention window, keeping only digests, telemetry
 * (latency/cost/status/error) and schema-validated outputs that SLO metrics
 * depend on. Idempotent and safe to run on a schedule.
 */
import { AuditAction } from "@patchbay/audit";
import { ActorType, logger } from "@patchbay/domain";
import { buildAuditEvent } from "@patchbay/audit";

export interface RetentionPrisma {
  agentRun: {
    findMany(args: unknown): Promise<Array<Record<string, unknown>>>;
    update(args: unknown): Promise<Record<string, unknown>>;
  };
  auditEvent: {
    create(args: unknown): Promise<Record<string, unknown>>;
  };
}

export interface PurgeInput {
  /** Runs older than this many days are eligible. */
  retentionDays: number;
  correlationId: string;
  now?: Date;
  /** Organization filter; omit to purge across tenants. */
  organizationId?: string;
}

export interface PurgeResult {
  eligible: number;
  purged: number;
}

/** Terminal run states whose payloads can be retired. */
const TERMINAL_RUN_STATUSES = ["SUCCEEDED", "FAILED", "CANCELLED", "BUDGET_EXCEEDED"];

export async function purgeExpiredAgentRuns(
  prisma: RetentionPrisma,
  input: PurgeInput,
): Promise<PurgeResult> {
  const cutoff = new Date((input.now ?? new Date()).getTime() - input.retentionDays * 86_400_000);

  const eligible = (await prisma.agentRun.findMany({
    where: {
      ...(input.organizationId ? { organizationId: input.organizationId } : {}),
      status: { in: TERMINAL_RUN_STATUSES },
      completedAt: { not: null, lt: cutoff },
      AND: [{ OR: [{ inputJson: { not: undefined } }, { outputJson: { not: undefined } }] }],
    },
    select: { id: true, organizationId: true },
  })) as Array<{ id: string; organizationId: string }>;

  let purged = 0;
  for (const run of eligible) {
    await prisma.agentRun.update({
      where: { id: run.id },
      data: { inputJson: null, outputJson: null, tokenUsage: null },
    });
    await prisma.auditEvent.create({
      data: buildAuditEvent({
        organizationId: run.organizationId,
        actorType: ActorType.SYSTEM,
        actorId: null,
        action: AuditAction.AGENT_RUN_PURGED,
        entityType: "agentRun",
        entityId: run.id,
        correlationId: input.correlationId,
        after: { retentionDays: input.retentionDays, cutoff: cutoff.toISOString() },
      }),
    });
    purged += 1;
  }

  if (purged > 0) {
    logger.info("purged expired agent run payloads", {
      correlationId: input.correlationId,
      purged,
      retentionDays: input.retentionDays,
    });
  }

  return { eligible: eligible.length, purged };
}
