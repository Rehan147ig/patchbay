/**
 * Shared BullMQ queue definition. Lives in its own package so both the web
 * app (enqueue) and the worker (consume) use one connection + job contract
 * without importing each other's process side effects.
 */
import { createHash } from "node:crypto";
import { Queue, type Job, type JobsOptions } from "bullmq";
import { Redis } from "ioredis";
import { assertJobPayloadSize, parseRedisUrl } from "./url";

export { assertJobPayloadSize, MAX_JOB_PAYLOAD_BYTES, parseRedisUrl } from "./url";

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

// Redis connection (shared between BullMQ queue and rate-limit/organization/concurrency checkers).
export const connection = new Redis(RAW_REDIS_URL, {
  maxRetriesPerRequest: null,
});

// Rate-limit Redis: per-request in-memory fallback so an unavailable Redis
// does not queue commands behind the BullMQ connection.
export const rateLimitRedis = new Redis(RAW_REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
});

// per-org concurrency counter. lazy so Redis-unavailability fails fast
// at enqueue time rather than stalling the BullMQ worker loop.
export const orgConcurrencyRedis = new Redis(RAW_REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
});

// global concurrency counter. lazy so Redis-unavailability fails fast
export const globalConcurrencyRedis = new Redis(RAW_REDIS_URL, {
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

/**
 * Rate-limit result.
 */
export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs: number;
}

/**
 * Atomic fixed-window counter: INCR on a hashed key, EXPIRE only when the
 * counter starts a fresh window. Used by the web rate-limiter.
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

/**
 * Acquire a per-organization concurrency slot.
 * INCR is atomic; TTL auto-releases on worker crash (24h).
 * Returns the slot count; caller must check against orgLimit.
 * If orgLimit is exceeded, DECR the slot back and returns the observed count.
 */
export async function acquireOrgConcurrency(
  organizationId: string,
  orgLimit: number,
): Promise<{ allowed: boolean; slotCount: number; reason?: string }> {
  const slotKey = `org_conc:${organizationId}`;
  let newSlotCount: number;
  try {
    newSlotCount = await orgConcurrencyRedis.incr(slotKey);
  } catch {
    // Redis unavailable — fail closed: cannot acquire slot
    return { allowed: false, slotCount: 0, reason: "Redis safety mechanism unreachable" };
  }
  if (newSlotCount === 1) {
    // First INCR — set TTL so the slot auto-releases if the worker crashes
    await orgConcurrencyRedis.expire(slotKey, 86_400_000); // 24h TTL
  }
  if (newSlotCount > orgLimit) {
    // Exceeded org's concurrency quota — roll back the slot and block
    await orgConcurrencyRedis.decr(slotKey);
    return {
      allowed: false,
      slotCount: newSlotCount,
      reason: `Organization concurrency limit exceeded: ${newSlotCount} > ${orgLimit}`,
    };
  }
  return { allowed: true, slotCount: newSlotCount };
}

/**
 * Release a per-organization concurrency slot.
 * Must be called in a finally block after job completion.
 */
export async function releaseOrgConcurrency(organizationId: string): Promise<void> {
  const slotKey = `org_conc:${organizationId}`;
  await orgConcurrencyRedis.decr(slotKey);
}

/**
 * Acquire global concurrency slot.
 * INCR is atomic; TTL auto-releases on worker crash.
 * globalLimit is the maximum concurrent jobs across ALL organizations.
 */
export async function acquireGlobalConcurrency(
  globalLimit: number,
): Promise<{ allowed: boolean; slotCount: number; reason?: string }> {
  const slotKey = "global_conc";
  let newSlotCount: number;
  try {
    newSlotCount = await globalConcurrencyRedis.incr(slotKey);
  } catch {
    // Redis unavailable — fail closed
    return { allowed: false, slotCount: 0, reason: "Redis safety mechanism unreachable" };
  }
  if (newSlotCount === 1) {
    // First INCR — set TTL so the slot auto-releases if the worker crashes
    await globalConcurrencyRedis.expire(slotKey, 86_400_000); // 24h TTL
  }
  if (newSlotCount > globalLimit) {
    // Exceeded global concurrency quota — roll back the slot and block
    await globalConcurrencyRedis.decr(slotKey);
    return {
      allowed: false,
      slotCount: newSlotCount,
      reason: `Global concurrency limit exceeded: ${newSlotCount} > ${globalLimit}`,
    };
  }
  return { allowed: true, slotCount: newSlotCount };
}

/**
 * Release global concurrency slot.
 */
export async function releaseGlobalConcurrency(): Promise<void> {
  await globalConcurrencyRedis.decr("global_conc");
}
