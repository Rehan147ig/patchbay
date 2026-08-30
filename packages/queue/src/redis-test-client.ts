import { Redis } from "ioredis";

export interface IRedisTestClient {
  readonly redis: Redis;
  readonly key: string;
  close(): Promise<void>;
  isConnected(): boolean;
}

/**
 * Creates one disposable Redis client from REDIS_URL,
 * explicitly awaits connect and ping, and returns a typed client.
 * Tests must pass this same client into acquire and release functions
 * so all operations use the same verified Redis connection.
 */
export async function createRedisTestClient(redisUrl: string): Promise<IRedisTestClient> {
  const redis = new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });

  // Explicitly await connect and ping
  await redis.connect();
  await redis.ping();

  const key = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  return {
    redis,
    key,
    close: async () => {
      try {
        await redis.quit();
      } catch {
        // best-effort cleanup
      }
    },
    isConnected: (): boolean => {
      return redis.status === "ready";
    },
  };
}
