/**
 * Release Watchtower polling schedulers.
 *
 * BullMQ repeatable-job schedulers create the DETECT_RELEASES job on a fixed
 * cadence (npm + OpenAPI every 15 min, GitHub releases every 30 min). They are
 * stored in Redis, so one worker instance is sufficient; multiple workers share
 * the same scheduler without double-polling (BullMQ distributes repeats).
 * Polling is conditional via adapter cursors (ETag / If-None-Match), so a
 * scheduler tick that finds nothing new costs one cheap network round trip.
 */
import { logger } from "@patchbay/domain";
import { JobType, queue } from "@patchbay/queue";
import { getWatchtowerAdapters } from "@patchbay/vendor-connectors";

const NPM_SCHEDULER_ID = "watchtower-npm-openapi";
const GITHUB_SCHEDULER_ID = "watchtower-github";

export interface WatchtowerSchedulerConfig {
  pollingEnabled: boolean;
  npmIntervalMs: number;
  githubIntervalMs: number;
}

const npmSlugs = (): string[] =>
  getWatchtowerAdapters()
    .filter((adapter) => adapter.source === "NPM" || adapter.source === "OPENAPI")
    .map((adapter) => adapter.slug);

const githubSlugs = (): string[] =>
  getWatchtowerAdapters()
    .filter((adapter) => adapter.source === "GITHUB_RELEASE")
    .map((adapter) => adapter.slug);

/**
 * Idempotent: upserting an existing scheduler with the same id updates its
 * interval and payload instead of creating a duplicate repeat.
 */
export async function registerWatchtowerSchedulers(
  config: WatchtowerSchedulerConfig,
): Promise<{ registered: string[] }> {
  const registered: string[] = [];

  if (!config.pollingEnabled) {
    logger.info("watchtower polling disabled; schedulers not registered");
    return { registered };
  }

  await queue.upsertJobScheduler(
    NPM_SCHEDULER_ID,
    { every: config.npmIntervalMs },
    {
      name: JobType.DETECT_RELEASES,
      data: {
        adapterSlugs: npmSlugs(),
        correlationId: crypto.randomUUID(),
        scheduled: true,
      },
    },
  );
  registered.push(`${NPM_SCHEDULER_ID} (every ${config.npmIntervalMs}ms)`);

  await queue.upsertJobScheduler(
    GITHUB_SCHEDULER_ID,
    { every: config.githubIntervalMs },
    {
      name: JobType.DETECT_RELEASES,
      data: {
        adapterSlugs: githubSlugs(),
        correlationId: crypto.randomUUID(),
        scheduled: true,
      },
    },
  );
  registered.push(`${GITHUB_SCHEDULER_ID} (every ${config.githubIntervalMs}ms)`);

  logger.info("watchtower schedulers registered", { registered });
  return { registered };
}
