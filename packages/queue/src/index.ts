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
export { createRedisTestClient, type IRedisTestClient } from "./redis-test-client.js";

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

export const ACQUIRE_LUA = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])
local newVal = redis.call('INCR', key)
if newVal == 1 then
  redis.call('EXPIRE', key, ttl)
end
if newVal > limit then
  redis.call('DECR', key)
  return {0, newVal}
end
return {1, newVal}
`;

export const RELEASE_LUA = `
local key = KEYS[1]
local cur = redis.call('GET', key)
if not cur then return 0 end
cur = tonumber(cur)
if cur <= 0 then
  redis.call('DEL', key)
  return 0
end
return redis.call('DECR', key)
`;

export const ACQUIRE_TTL_SECONDS = 86400; // 24h — EXPIRE uses seconds (was incorrectly 86_400_000)

/**
 * Ensures concurrency Redis clients are connected and reachable.
 * Call once during worker startup before accepting jobs.
 * Preserves fail-closed behavior: if Redis becomes unavailable later,
 * acquire functions return structured denial via the "Redis safety mechanism unreachable" path.
 */
export async function ensureConcurrencyRedisReady(): Promise<void> {
  await orgConcurrencyRedis.connect();
  await orgConcurrencyRedis.ping();
  await globalConcurrencyRedis.connect();
  await globalConcurrencyRedis.ping();
}

/**
 * Acquire a per-organization concurrency slot atomically via Lua.
 * The increment, limit check, rollback and TTL are one atomic operation.
 * `redisClient` is for testing only — allows injecting a disposable client for outage tests
 * without disconnecting the shared singleton in parallel runs.
 */
export async function acquireOrgConcurrency(
  organizationId: string,
  orgLimit: number,
  redisClient?: Redis,
): Promise<{ allowed: boolean; slotCount: number; reason?: string }> {
  const slotKey = `org_conc:${organizationId}`;
  const client = redisClient ?? orgConcurrencyRedis;
  try {
    const res = (await client.eval(
      ACQUIRE_LUA,
      1,
      slotKey,
      String(orgLimit),
      String(ACQUIRE_TTL_SECONDS),
    )) as [number, number];
    const allowed = res[0] === 1;
    const slotCount = res[1];
    if (!allowed) {
      return {
        allowed: false,
        slotCount,
        reason: `Organization concurrency limit exceeded: ${slotCount} > ${orgLimit}`,
      };
    }
    return { allowed: true, slotCount };
  } catch {
    return { allowed: false, slotCount: 0, reason: "Redis safety mechanism unreachable" };
  }
}

/**
 * Release a per-organization concurrency slot atomically, never below 0.
 * Accepts an optional injected Redis client so test setup, acquire, release,
 * and assertions all use the same verified connection.
 */
export async function releaseOrgConcurrency(
  organizationId: string,
  redisClient?: Redis,
): Promise<void> {
  const slotKey = `org_conc:${organizationId}`;
  const client = redisClient ?? orgConcurrencyRedis;
  await client.eval(RELEASE_LUA, 1, slotKey);
}

/**
 * Acquire global concurrency slot atomically via Lua.
 * `redisClient` is for testing only — see acquireOrgConcurrency.
 */
export async function acquireGlobalConcurrency(
  globalLimit: number,
  redisClient?: Redis,
): Promise<{ allowed: boolean; slotCount: number; reason?: string }> {
  const slotKey = "global_conc";
  const client = redisClient ?? globalConcurrencyRedis;
  try {
    const res = (await client.eval(
      ACQUIRE_LUA,
      1,
      slotKey,
      String(globalLimit),
      String(ACQUIRE_TTL_SECONDS),
    )) as [number, number];
    const allowed = res[0] === 1;
    const slotCount = res[1];
    if (!allowed) {
      return {
        allowed: false,
        slotCount,
        reason: `Global concurrency limit exceeded: ${slotCount} > ${globalLimit}`,
      };
    }
    return { allowed: true, slotCount };
  } catch {
    return { allowed: false, slotCount: 0, reason: "Redis safety mechanism unreachable" };
  }
}

/**
 * Release global concurrency slot atomically, never below 0.
 * Accepts an optional injected Redis client so test setup, acquire, release,
 * and assertions all use the same verified connection.
 */
export async function releaseGlobalConcurrency(redisClient?: Redis): Promise<void> {
  const client = redisClient ?? globalConcurrencyRedis;
  await client.eval(RELEASE_LUA, 1, "global_conc");
}
