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
import {
  processUpdateTaskParameter,
  sweepPendingTaskParameters,
} from "./jobs/update-task-parameter";
import { processGraphIndex } from "./jobs/graph-index";
import { processClassifyRelease } from "./jobs/classify-release";
import { processMatchRelease } from "./jobs/match-release";
import { processAgentPlan } from "./jobs/agent-plan";
import { processAgentReplay } from "./jobs/agent-replay";
import { processDetectReleases } from "./jobs/detect-releases";
import { registerWatchtowerSchedulers } from "./schedule/watchtower";

const TASK_SWEEP_INTERVAL_MS = 60_000;

// Fail fast at boot: refuse to start with a missing or invalid configuration.
const env = parseEnv();

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
        case JobType.UPDATE_TASK_PARAMETER:
          return processUpdateTaskParameter(job);
        case JobType.GRAPH_INDEX:
          return processGraphIndex(job);
        case JobType.CLASSIFY_RELEASE:
          return processClassifyRelease(job);
        case JobType.MATCH_RELEASE:
          return processMatchRelease(job);
        case JobType.AGENT_PLAN:
          return processAgentPlan(job);
        case JobType.AGENT_REPLAY:
          return processAgentReplay(job);
        case JobType.DETECT_RELEASES:
          return processDetectReleases(job);
        default:
          throw new Error(`unknown job type: ${job.name}`);
      }
    },
    { connection, concurrency: 2, limiter: { max: 20, duration: 1_000 } },
  );

  const redisPing = await connection.ping();
  logger.info("redis connection ok", { pong: redisPing });

  await registerWatchtowerSchedulers({
    pollingEnabled: env.WATCHTOWER_POLLING_ENABLED,
    npmIntervalMs: env.WATCHTOWER_POLL_INTERVAL_NPM_MS,
    githubIntervalMs: env.WATCHTOWER_POLL_INTERVAL_GITHUB_MS,
  });

  const sweepTimer = setInterval(() => {
    sweepPendingTaskParameters().catch((error: unknown) => {
      logger.error("task parameter sweep failed", { error: String(error) });
    });
  }, TASK_SWEEP_INTERVAL_MS);

  const shutdown = async (signal: string): Promise<void> => {
    logger.info("patchbay-worker shutting down", { signal });
    clearInterval(sweepTimer);
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
