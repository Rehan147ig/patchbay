/**
 * Shared BullMQ queue definition. Lives in its own package so both the web
 * app (enqueue) and the worker (consume) use one connection + job contract
 * without importing each other's process side effects.
 */
import { Queue } from "bullmq";
import { Redis } from "ioredis";

export const QUEUE_NAME = "remediation";

export const JobType = {
  SCAN_REPOSITORY: "scan-repository",
  ANALYZE_CHANGE: "analyze-change",
  RUN_VALIDATION: "run-validation",
  CREATE_PR: "create-pr",
} as const;
export type JobType = (typeof JobType)[keyof typeof JobType];

const REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";

export const connection = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
});

export const queue = new Queue(QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 2_000 },
    removeOnComplete: 1_000,
    removeOnFail: 5_000,
  },
});
