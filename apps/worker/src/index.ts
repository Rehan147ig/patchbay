/**
 * Patchbay background worker (BullMQ consumer).
 *
 * Job types:
 * - scan-repository: index IntegrationUsage from a repository snapshot
 * - analyze-change: normalize + impact assessment for a VendorChangeEvent
 * - run-validation: execute allowlisted validation commands on a patched workspace
 * - create-pr: create a draft PR via the git provider (policy-gated upstream)
 *
 * Phase 1: queue connection; Phase 2 adds the scan-repository processor.
 * Remaining processors arrive with their engine phases (docs/implementation-plan.md).
 */
import { Worker } from "bullmq";
import { parseEnv } from "@patchbay/env";
import { logger } from "@patchbay/domain";
import { JobType, QUEUE_NAME, connection, queue } from "@patchbay/queue";
import { processAnalyzeChange } from "./jobs/analyze-change";
import { processCreatePR } from "./jobs/create-pr";
import { processPollNpmRegistry } from "./jobs/poll-npm-registry";
import { processRunValidation } from "./jobs/run-validation";
import { processScanRepository } from "./jobs/scan-repository";

// Fail fast at boot: refuse to start with a missing or invalid configuration.
parseEnv();

async function main(): Promise<void> {
  logger.info("patchbay-worker starting", { queue: QUEUE_NAME, redis: connection.options.host });

  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      switch (job.name) {
        case JobType.SCAN_REPOSITORY:
          return processScanRepository(job);
        case JobType.ANALYZE_CHANGE:
          return processAnalyzeChange(job);
        case JobType.RUN_VALIDATION:
          return processRunValidation(job);
        case JobType.CREATE_PR:
          return processCreatePR(job);
        case JobType.POLL_NPM_REGISTRY:
          return processPollNpmRegistry(job);
        default:
          throw new Error(`unknown job type: ${job.name}`);
      }
    },
    { connection, concurrency: 2 },
  );

  const redisPing = await connection.ping();
  logger.info("redis connection ok", { pong: redisPing });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info("patchbay-worker shutting down", { signal });
    await worker.close();
    await queue.close();
    connection.disconnect();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error) => {
  logger.error("patchbay-worker failed to start", { error: String(error) });
  process.exitCode = 1;
});
