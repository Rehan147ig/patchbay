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
import { Worker, type Job } from "bullmq";
import { hostname } from "node:os";
import { prisma } from "@patchbay/db";
import { parseEnv } from "@patchbay/env";
import { logger } from "@patchbay/domain";
import { instrumentProcessor } from "@patchbay/telemetry";
import {
  JobType,
  QUEUE_NAME,
  connection,
  queue,
  acquireOrgConcurrency,
  releaseOrgConcurrency,
  acquireGlobalConcurrency,
  releaseGlobalConcurrency,
  ensureConcurrencyRedisReady,
  writeWorkerHeartbeat,
} from "@patchbay/queue";
import {
  createSandboxRunner,
  resolveSandboxMode,
  resolveSandboxValidationMode,
} from "@patchbay/sandbox-runner";
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
import { processEvaluateCapabilityHealth } from "./jobs/evaluate-capability-health";
import { processSiemForward } from "./jobs/siem-forward";
import { failedJobInfoFrom, handlePermanentlyFailedJob } from "./lib/job-failure";
import { sweepWatchtowerStaleness } from "./lib/watchtower-staleness";
import { registerWatchtowerSchedulers } from "./schedule/watchtower";
import { purgeExpiredAgentRuns } from "@patchbay/operations";
import { sweepCapabilityHealth } from "./lib/capability-sweep";

const TASK_SWEEP_INTERVAL_MS = 60_000;
const HEARTBEAT_INTERVAL_MS = 15_000;
const RETENTION_SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1_000;
const CAPABILITY_SWEEP_INTERVAL_MS = 30 * 60 * 1_000;
const WATCHTOWER_STALENESS_SWEEP_INTERVAL_MS = 30 * 60 * 1_000;
const AGENT_RUN_RETENTION_DAYS = Number(process.env.AGENT_RUN_RETENTION_DAYS ?? 90);

// Fail fast at boot: refuse to start with a missing or invalid configuration.
const env = parseEnv();

/** Route a job to its processor (wrapped in an OTEL span by the caller). */
async function dispatchJob(job: Job): Promise<unknown> {
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
    case JobType.EVALUATE_CAPABILITY_HEALTH:
      return processEvaluateCapabilityHealth(job);
    case JobType.SIEM_FORWARD:
      return processSiemForward(job);
    default:
      throw new Error(`unknown job type: ${job.name}`);
  }
}

async function main(): Promise<void> {
  logger.info("patchbay-worker starting", { queue: QUEUE_NAME, redis: connection.options.host });

  // Production fail-closed: the worker must not validate customer code on the
  // host process, and refuses to start when the hardened container runtime is
  // unavailable. createSandboxRunner throws for any non-container runtime.
  // The only exception is SANDBOX_VALIDATION_MODE=github-checks-only, where
  // customer code never executes on this host and customer CI is the sandbox.
  if (resolveSandboxMode() === "production") {
    if (resolveSandboxValidationMode() === "github-checks-only") {
      logger.info(
        "production validation mode is github-checks-only; customer CI is the validation sandbox",
      );
    } else {
      const sandbox = createSandboxRunner();
      const available = await sandbox.isAvailable();
      if (!available) {
        throw new Error(
          `refusing to start: production sandbox runtime ${sandbox.runtime} is unavailable ` +
            "(start Docker and set SANDBOX_RUNTIME=container)",
        );
      }
      logger.info("production sandbox runtime ready", { runtime: sandbox.runtime });
    }
  }

  await ensureConcurrencyRedisReady();

  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      // Acquire per-org and global concurrency slots before job execution.
      // If either fails, the job is deferred (throws, BullMQ will retry later
      // per its attempts/backoff config, or the job can explicitly defer).
      const orgLimit = Number(
        process.env.SANDBOX_CONCURRENCY ?? process.env.ORG_CONCURRENCY_LIMIT ?? "4",
      );
      const globalLimit = Number(process.env.GLOBAL_CONCURRENCY_LIMIT ?? "10");

      const orgResult = await acquireOrgConcurrency(job.data.organizationId ?? "unknown", orgLimit);
      if (!orgResult.allowed) {
        throw new Error(`Org concurrency limit: ${orgResult.reason}`);
      }

      const globalResult = await acquireGlobalConcurrency(globalLimit);
      if (!globalResult.allowed) {
        // Release the org slot before throwing
        await releaseOrgConcurrency(job.data.organizationId ?? "unknown");
        throw new Error(`Global concurrency limit: ${globalResult.reason}`);
      }

      try {
        // One OTEL span per job (job.<type>) with outcome + duration recorded
        // on the way out — including unknown-type rejections, which still
        // count as failed transitions in the mirror and the metrics pipeline.
        return await instrumentProcessor(job.name, dispatchJob)(job);
      } finally {
        // Always release both slots, even if the job threw.
        await releaseGlobalConcurrency();
        await releaseOrgConcurrency(job.data.organizationId ?? "unknown");
      }
    },
    { connection, concurrency: 4, limiter: { max: 20, duration: 1_000 } }, // 4 slots: GRAPH_INDEX (heavy, 1 at a time) + CREATE_PR/VALIDATE (3) share - 50-repo monorepo queues 10m, not a blocker for demo (1 repo 2s),
  );

  // Permanent-failure visibility: BullMQ fires `failed` on every attempt, but
  // handlePermanentlyFailedJob only acts once attempts are exhausted, so
  // transient retries stay quiet while a dead pipeline pages loudly (alert +
  // DLQ copy + audit event). The handler itself never throws.
  worker.on("failed", (job, error) => {
    void handlePermanentlyFailedJob(failedJobInfoFrom(job), error).catch(
      (handlerError: unknown) => {
        logger.error("job failure handler failed", { error: String(handlerError) });
      },
    );
  });
  // Worker-level faults (e.g. the Redis connection dropping mid-run) are not
  // job failures, so they get their own alert path instead of dying silently.
  worker.on("error", (error) => {
    void handlePermanentlyFailedJob(
      { jobType: "worker", attemptsMade: 1, attemptsAllowed: 1 },
      error,
    ).catch((handlerError: unknown) => {
      logger.error("worker error handler failed", { error: String(handlerError) });
    });
  });

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

  const retentionTimer = setInterval(() => {
    purgeExpiredAgentRuns(prisma, {
      retentionDays: AGENT_RUN_RETENTION_DAYS,
      correlationId: `retention-${Date.now()}`,
    }).catch((error: unknown) => {
      logger.error("agent run retention sweep failed", { error: String(error) });
    });
  }, RETENTION_SWEEP_INTERVAL_MS);

  const capabilitySweepTimer = setInterval(() => {
    sweepCapabilityHealth().catch((error: unknown) => {
      logger.error("capability health sweep failed", { error: String(error) });
    });
  }, CAPABILITY_SWEEP_INTERVAL_MS);

  const stalenessSweepTimer = setInterval(() => {
    sweepWatchtowerStaleness().catch((error: unknown) => {
      logger.error("watchtower staleness sweep failed", { error: String(error) });
    });
  }, WATCHTOWER_STALENESS_SWEEP_INTERVAL_MS);

  // Liveness heartbeat for /api/operations/queues: best-effort, never fatal.
  // A missed beat marks the worker stale in the dashboard, not dead in logs.
  const workerId = `${hostname()}-${process.pid}`;
  const workerStartedAt = new Date().toISOString();
  const beat = (): void => {
    writeWorkerHeartbeat({ workerId, startedAt: workerStartedAt, queue: QUEUE_NAME }).catch(
      (error: unknown) => {
        logger.error("worker heartbeat failed", { error: String(error) });
      },
    );
  };
  beat();
  const heartbeatTimer = setInterval(beat, HEARTBEAT_INTERVAL_MS);

  const shutdown = async (signal: string): Promise<void> => {
    logger.info("patchbay-worker shutting down", { signal });
    clearInterval(sweepTimer);
    clearInterval(retentionTimer);
    clearInterval(capabilitySweepTimer);
    clearInterval(stalenessSweepTimer);
    clearInterval(heartbeatTimer);
    // Deadline-bounded shutdown: a hung worker.close() must never stall the
    // process forever (in-flight jobs retry via BullMQ on restart).
    const SHUTDOWN_DEADLINE_MS = 30_000;
    await Promise.race([
      (async () => {
        await worker.close();
        await queue.close();
        connection.disconnect();
      })(),
      new Promise((resolve) => setTimeout(resolve, SHUTDOWN_DEADLINE_MS).unref()),
    ]);
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  // On Node >= 15 an unhandled rejection crashes the process mid-job without
  // running cleanup; log loudly and exit non-zero so orchestrators restart us.
  process.on("unhandledRejection", (reason) => {
    logger.error("worker unhandled rejection", { error: String(reason) });
    process.exitCode = 1;
  });
  process.on("uncaughtException", (error) => {
    logger.error("worker uncaught exception", { error: String(error) });
    process.exit(1);
  });
}

main().catch((error) => {
  logger.error("patchbay-worker failed to start", { error: String(error) });
  process.exitCode = 1;
});
