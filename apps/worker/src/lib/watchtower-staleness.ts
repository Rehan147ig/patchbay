import { prisma } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import { ActorType, logger } from "@patchbay/domain";
import { alertDlq } from "@patchbay/queue";
import { getWatchtowerAdapters } from "@patchbay/vendor-connectors";
import { writeAuditEvent } from "./audit";
import { systemOrgId } from "./system-org";

/**
 * Watchtower staleness watchdog. Release polling lives entirely inside the
 * worker process — if the worker dies, hangs, or the schedulers misfire,
 * detection simply stops and nothing else notices. The last-success view
 * (/api/watchtower/health) exists but no human polls it, so this sweep pages
 * loudly when any configured adapter has no COMPLETED DetectionRun within
 * the max age (default 60 minutes = 2x the slowest poll cadence).
 *
 * Stateless by design: while stale it alerts on every sweep (30-minute
 * cadence) until fresh runs resume, the same contract as a firing PagerDuty
 * alert. The alert channel is expected to dedupe.
 */

export const DEFAULT_STALENESS_MAX_AGE_MS = 60 * 60 * 1_000;

export interface AdapterFreshness {
  adapter: string;
  lastCompletedAt: Date | null;
  stale: boolean;
}

export function evaluateFreshness(
  lastByAdapter: Map<string, Date | null>,
  nowMs: number,
  maxAgeMs: number,
): AdapterFreshness[] {
  return [...lastByAdapter.entries()]
    .map(([adapter, lastCompletedAt]): AdapterFreshness => ({
      adapter,
      lastCompletedAt,
      stale: lastCompletedAt === null || nowMs - lastCompletedAt.getTime() > maxAgeMs,
    }))
    .sort((a, b) => a.adapter.localeCompare(b.adapter));
}

export interface StalenessSweepResult {
  stale: boolean;
  adapters: AdapterFreshness[];
}

export async function sweepWatchtowerStaleness(
  options: { maxAgeMs?: number; now?: Date } = {},
): Promise<StalenessSweepResult> {
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_STALENESS_MAX_AGE_MS;
  const now = options.now ?? new Date();
  const adapters = getWatchtowerAdapters().map((adapter) => adapter.slug);
  if (adapters.length === 0) {
    logger.warn("watchtower staleness sweep skipped (no adapters configured)");
    return { stale: false, adapters: [] };
  }

  const lastByAdapter = new Map<string, Date | null>();
  for (const adapter of adapters) {
    const latest = await prisma.detectionRun.findFirst({
      where: { adapter, status: "COMPLETED", completedAt: { not: null } },
      orderBy: { completedAt: "desc" },
      select: { completedAt: true },
    });
    lastByAdapter.set(adapter, latest?.completedAt ?? null);
  }

  const freshness = evaluateFreshness(lastByAdapter, now.getTime(), maxAgeMs);
  const staleAdapters = freshness.filter((entry) => entry.stale);
  if (staleAdapters.length === 0) return { stale: false, adapters: freshness };

  const message =
    `watchtower stale: no completed poll within ${Math.round(maxAgeMs / 60_000)}m ` +
    `for ${staleAdapters.map((entry) => entry.adapter).join(", ")}`;
  logger.error(message, {
    adapters: staleAdapters.map((entry) => entry.adapter),
    lastCompletedAt: staleAdapters.map((entry) => entry.lastCompletedAt?.toISOString() ?? null),
  });
  try {
    await alertDlq("watchtower-staleness", message);
  } catch (error) {
    logger.error("watchtower staleness alert failed", { error: String(error) });
  }
  try {
    await writeAuditEvent({
      organizationId: await systemOrgId(),
      actorType: ActorType.SYSTEM,
      actorId: null,
      action: AuditAction.WATCHTOWER_STALE,
      entityType: "watchtower",
      entityId: "staleness",
      correlationId: `staleness-${now.getTime()}`,
      after: {
        staleAdapters: staleAdapters.map((entry) => entry.adapter),
        maxAgeMs,
      },
    });
  } catch (error) {
    logger.error("watchtower staleness audit failed", { error: String(error) });
  }
  return { stale: true, adapters: freshness };
}
