/**
 * Shared BullMQ queue definition. Lives in its own package so both the web
 * app (enqueue) and the worker (consume) use one connection + job contract
 * without importing each other's process side effects.
 */
import { createHash } from "node:crypto";
import { Queue, type Job, type JobsOptions } from "bullmq";
import { Redis } from "ioredis";
import { assertJobPayloadSize, parseRedisUrl } from "./url";

export const QUEUE_NAME = "remediation";

export const JobType = {
  SCAN_REPOSITORY: "scan-repository",
  ANALYZE_CHANGE: "analyze-change",
  RUN_VALIDATION: "run-validation",
  CREATE_PR: "create-pr",
  POLL_NPM_REGISTRY: "poll-npm-registry",
  UPDATE_TASK_PARAMETER: "update-task-parameter",
  GRAPH_INDEX: "graph-index",
  CLASSIFY_RELEASE: "classify-release",
  MATCH_RELEASE: "match-release",
  AGENT_PLAN: "agent-plan",
  AGENT_REPLAY: "agent-replay",
  DETECT_RELEASES: "detect-releases",
  EVALUATE_CAPABILITY_HEALTH: "evaluate-capability-health",
} as const;
export type JobType = (typeof JobType)[keyof typeof JobType];

const RAW_REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";

// Fail fast: an invalid or unparseable REDIS_URL must never boot a queue
// that connects nowhere or logs credentials. rediss:// enables TLS via ioredis.
parseRedisUrl(RAW_REDIS_URL);

export const connection = new Redis(RAW_REDIS_URL, {
  maxRetriesPerRequest: null,
});

/**
 * Rate-limit counters. A dedicated lazy connection so an unavailable Redis
 * fails fast (and the request fails open to the caller's in-memory fallback)
 * instead of queuing commands behind the BullMQ connection, which must never
 * stall for a rate check.
 */
export const rateLimitRedis = new Redis(RAW_REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
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

/**
 * Single enqueue path: size-bounds every job payload before it reaches Redis
 * and keeps the queue contract in one place. Routes must use this instead of
 * calling queue.add directly.
 */
export async function enqueue(
  jobType: JobType,
  data: unknown,
  options?: JobsOptions,
): Promise<Job> {
  assertJobPayloadSize(data);
  return queue.add(jobType, data as Record<string, unknown>, options);
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs: number;
}

/**
 * Atomic fixed-window counter: INCR on a per-key key, EXPIRE only when the
 * counter starts a fresh window. Keys are hashed so no caller-controlled
 * string ever lands in the Redis key space.
 */
export async function checkRateLimitRedis(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const redisKey = `rl:${createHash("sha256").update(key).digest("hex")}`;
  const count = await rateLimitRedis.incr(redisKey);
  if (count === 1) {
    await rateLimitRedis.expire(redisKey, Math.max(1, Math.ceil(windowMs / 1000)));
  }
  if (count > limit) {
    const ttl = await rateLimitRedis.pttl(redisKey);
    return { allowed: false, retryAfterMs: ttl > 0 ? ttl : windowMs };
  }
  return { allowed: true, retryAfterMs: 0 };
}
