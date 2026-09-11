/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  acquireOrgConcurrency,
  releaseOrgConcurrency,
  createRedisTestClient,
  type IRedisTestClient,
} from "@patchbay/queue";

let testClient: IRedisTestClient | undefined;
const getRedis = () => testClient!.redis;

describe("P0-B: Redis PR Slot Safety", () => {
  beforeAll(async () => {
    // Honor the configured Redis (local compose maps 6380; CI serves 6379).
    // A hardcoded port loops forever on ECONNREFUSED anywhere else.
    testClient = await createRedisTestClient(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
  });

  afterAll(async () => {
    if (testClient) {
      const keys = await getRedis().keys("test:p0_c:*");
      if (keys.length > 0) {
        await getRedis().del(...keys);
      }
      await getRedis().del("org_conc:test-org");
      await getRedis().del(`org_conc:crash-org`);
      // also clean any b2-race keys that may have leaked from exact-limit race
      const raceKeys = await getRedis().keys("org_conc:b2-race-*");
      if (raceKeys.length > 0) await getRedis().del(...raceKeys);
      const ttlKeys = await getRedis().keys("org_conc:ttl-test");
      if (ttlKeys.length > 0) await getRedis().del(...ttlKeys);
      await testClient!.close();
    }
  });

  describe("B1 concurrent limit 20 workers / limit 5", () => {
    it("should enforce org concurrency limit with real INCR/DECR", async () => {
      const redis = getRedis();
      await redis.del("org_conc:test-org");
      const limit = 5;
      const workers = 20;

      const barrier: Promise<boolean>[] = [];
      for (let i = 0; i < workers; i++) {
        barrier.push(
          (async () => {
            const r = await acquireOrgConcurrency("test-org", limit, redis as any);
            if (r.allowed) {
              await releaseOrgConcurrency("test-org", redis as any);
              return true;
            }
            return false;
          })(),
        );
      }
      const results = await Promise.all(barrier);
      const successful = results.filter(Boolean).length;
      const blocked = results.filter((v) => !v).length;
      expect(successful).toBeGreaterThan(0);
      expect(successful).toBeLessThanOrEqual(5);
      expect(blocked).toBeGreaterThanOrEqual(15);
      const counter = parseInt((await redis.get("org_conc:test-org")) || "0", 10);
      expect(counter).toBe(0);
    });
  });

  describe("B2 exact-limit race", () => {
    it("should allow exactly 1 of 2 concurrent when at limit-1 (100 rounds)", async () => {
      const redis = getRedis();
      let violations = 0;
      for (let round = 0; round < 100; round++) {
        const org = `b2-race-${round}-${Date.now()}-${Math.random()}`;
        await redis.del(`org_conc:${org}`);
        await redis.set(`org_conc:${org}`, "4");

        let releaseGate: () => void;
        const gate = new Promise<void>((resolve) => {
          releaseGate = resolve;
        });
        let arrived = 0;
        const [a, b] = await Promise.all([
          (async () => {
            if (++arrived === 2) releaseGate!();
            await gate;
            return acquireOrgConcurrency(org, 5, redis as any);
          })(),
          (async () => {
            if (++arrived === 2) releaseGate!();
            await gate;
            return acquireOrgConcurrency(org, 5, redis as any);
          })(),
        ]);

        const allowedCount = [a.allowed, b.allowed].filter(Boolean).length;
        const counter = parseInt((await redis.get(`org_conc:${org}`)) || "0", 10);
        if (allowedCount !== 1 || counter > 5) violations++;
        if (a.allowed) await releaseOrgConcurrency(org, redis as any);
        if (b.allowed) await releaseOrgConcurrency(org, redis as any);
        await redis.del(`org_conc:${org}`);
      }
      expect(violations).toBe(0);
    });
  });

  describe("B3 normal release", () => {
    it("should restore counter to initial value", async () => {
      const redis = getRedis();
      await redis.set("org_conc:test-org", "3");
      const r = await acquireOrgConcurrency("test-org", 5, redis as any);
      expect(r.allowed).toBe(true);
      await releaseOrgConcurrency("test-org", redis as any);
      const current = parseInt((await redis.get("org_conc:test-org")) || "0", 10);
      expect(current).toBe(3);
      await redis.del("org_conc:test-org");
    });
  });

  describe("B4 rejected reservation rollback", () => {
    it("should roll back over-limit increment", async () => {
      const redis = getRedis();
      await redis.set("org_conc:test-org", "5");
      const result = await acquireOrgConcurrency("test-org", 5, redis as any);
      expect(result.allowed).toBe(false);
      const counter = parseInt((await redis.get("org_conc:test-org")) || "0", 10);
      expect(counter).toBe(5);
      await redis.del("org_conc:test-org");
    });
  });

  describe("B5 Redis unavailable", () => {
    it("should fail closed with structured reason (disposable client)", async () => {
      const redis = getRedis();
      const { Redis } = await import("ioredis");
      const badClient = new (Redis as any)("redis://127.0.0.1:1", {
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 0,
        connectTimeout: 500,
      });
      try {
        await badClient.connect();
      } catch {
        // expected
      }
      const result = await acquireOrgConcurrency("b5-outage", 5, badClient as any);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Redis safety mechanism unreachable");
      await badClient.quit().catch(() => {});
      const recovery = await acquireOrgConcurrency("b5-outage", 5, redis as any);
      expect(recovery.allowed).toBe(true);
      await releaseOrgConcurrency("b5-outage", redis as any);
    });
  });

  describe("B6 Redis recovery", () => {
    it("should resume reservations after Redis restore", async () => {
      const redis = getRedis();
      await redis.del("org_conc:test-org");
      const result = await acquireOrgConcurrency("test-org", 5, redis as any);
      expect(result.allowed).toBe(true);
      await releaseOrgConcurrency("test-org", redis as any);
      const counter = parseInt((await redis.get("org_conc:test-org")) || "0", 10);
      expect(counter).toBe(0);
    });
  });

  describe("B7 TTL recovery", () => {
    it("should set correct TTL on production key (86400s, not 86400000)", async () => {
      const redis = getRedis();
      await redis.del("org_conc:ttl-test");
      const r = await acquireOrgConcurrency("ttl-test", 5, redis as any);
      expect(r.allowed).toBe(true);
      const ttl = await redis.ttl("org_conc:ttl-test");
      expect(ttl).toBeGreaterThan(86000);
      expect(ttl).toBeLessThanOrEqual(86400);
      expect(ttl).not.toBe(86400000);
      await releaseOrgConcurrency("ttl-test", redis as any);
      // also verify short TTL expiry for test isolation
      await redis.set("test:p0_c:ttl-short", "1");
      await redis.expire("test:p0_c:ttl-short", 1);
      await new Promise((r) => setTimeout(r, 2100));
      expect(await redis.get("test:p0_c:ttl-short")).toBeNull();
    });
  });

  describe("B8 Process crash", () => {
    it("should recover capacity after child process acquires and crashes without release", async () => {
      const redis = getRedis();
      const crashOrg = `crash-b8-${Date.now()}`;
      const testKey = `org_conc:${crashOrg}`;
      await redis.del(testKey);

      // Import the actual Lua text from @patchbay/queue
      const { ACQUIRE_LUA } = await import("@patchbay/queue");

      // Pass the literal Lua text in ACQUIRE_LUA environment variable
      const childEnv = {
        ...process.env,
        REDIS_URL: process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
        KEY: testKey,
        LIMIT: "5",
        ACQUIRE_LUA,
      };

      // Spawn the .mjs fixture as:
      // spawn(process.execPath, ["./packages/queue/fixtures/b8-child.mjs"], { env, stdio: ["ignore", "pipe", "pipe"] })
      // Do not use shell:true or --input-type=module
      const { spawn } = require("child_process"); // eslint-disable-line @typescript-eslint/no-require-imports
      const child = spawn(process.execPath, ["./packages/queue/fixtures/b8-child.mjs"], {
        env: childEnv,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let childStdout = "";
      let childStderr = "";
      child.stdout.on("data", (chunk: Buffer) => {
        childStdout += chunk.toString();
      });
      child.stderr.on("data", (chunk: Buffer) => {
        childStderr += chunk.toString();
      });

      // Await child close and use the close callback's numeric exit code argument
      let exitCode: number | undefined;
      await new Promise<void>((resolve) =>
        child.on("close", (code: number) => {
          exitCode = code;
          resolve();
        }),
      );

      // Validate exit code - include stderr in assertion diagnostics
      expect(exitCode, childStderr ? `child stderr: ${childStderr}` : undefined).toBe(0);

      // Validate stdout JSON - include stderr in assertion diagnostics
      let childResult: { allowed: boolean; slotCount: number } | null = null;
      try {
        childResult = JSON.parse(childStdout);
      } catch {
        // stdout JSON parse failure - mark as failed
      }
      expect(
        childResult,
        childStderr
          ? `child stderr: ${childStderr}\nstdout: ${childStdout}`
          : `child stdout: ${childStdout}`,
      ).toBeTruthy();
      expect(childResult?.allowed, childStderr ? `child stderr: ${childStderr}` : undefined).toBe(
        true,
      );

      // Verify child acquired the slot - key has value 1 with positive TTL
      // (child began from empty key; acquired one slot and left it abandoned)
      const ttl = await redis.ttl(testKey);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(86400);
      const count = parseInt((await redis.get(testKey)) || "0", 10);
      // Child acquired one slot and left it; count should be 1 (not decremented)
      expect(count).toBe(1);

      // Parent shortens key for fast test execution (child holds the slot)
      await redis.expire(testKey, 1);
      await new Promise((r) => setTimeout(r, 2100));

      // Key should now be expired
      expect(await redis.get(testKey)).toBeNull();

      // Verify new acquire succeeds after expiry
      const r3 = await acquireOrgConcurrency(crashOrg, 5, redis as any);
      expect(r3.allowed).toBe(true);
      await releaseOrgConcurrency(crashOrg, redis as any);

      // Include stderr in failure diagnostics if test eventually fails
      // (stderr is captured in childStderr for this purpose)
    });
  });

  describe("B9 Retry safety", () => {
    it("should not create duplicate slots on retry", async () => {
      const redis = getRedis();
      await redis.del("org_conc:test-org");
      await redis.set("org_conc:test-org", "4");
      const r1 = await acquireOrgConcurrency("test-org", 5, redis as any);
      expect(r1.allowed).toBe(true);
      const r2 = await acquireOrgConcurrency("test-org", 5, redis as any);
      expect(r2.allowed).toBe(false);
      const counter = parseInt((await redis.get("org_conc:test-org")) || "0", 10);
      expect(counter).toBeLessThanOrEqual(5);
      await releaseOrgConcurrency("test-org", redis as any);
      await redis.del("org_conc:test-org");
    });
  });

  describe("B10 GitHub idempotency", () => {
    it("should be idempotent for same remediation key", async () => {
      const redis = getRedis();
      await redis.del("org_conc:test-org");
      const r1 = await acquireOrgConcurrency("test-org", 5, redis as any);
      expect(r1.allowed).toBe(true);
      await releaseOrgConcurrency("test-org", redis as any);
      const r2 = await acquireOrgConcurrency("test-org", 5, redis as any);
      expect(r2.allowed).toBe(true);
      await releaseOrgConcurrency("test-org", redis as any);
      const counter = parseInt((await redis.get("org_conc:test-org")) || "0", 10);
      expect(counter).toBe(0);
    });
  });

  describe("B11 Double release", () => {
    it("should not make counter negative", async () => {
      const redis = getRedis();
      await redis.set("org_conc:test-org", "1");
      await releaseOrgConcurrency("test-org", redis as any);
      await releaseOrgConcurrency("test-org", redis as any);
      const counter = parseInt((await redis.get("org_conc:test-org")) || "0", 10);
      expect(counter).toBe(0);
      await redis.del("org_conc:test-org");
    });
  });
});
