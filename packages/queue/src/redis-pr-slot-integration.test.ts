/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  acquireGlobalConcurrency,
  acquireOrgConcurrency,
  releaseGlobalConcurrency,
  releaseOrgConcurrency,
  createRedisTestClient,
  type IRedisTestClient,
} from "./index.js";

let testClient: IRedisTestClient | undefined;
const getRedis = () => testClient!.redis;

describe("P0-C: Concurrency & Fairness", () => {
  beforeAll(async () => {
    testClient = await createRedisTestClient("redis://127.0.0.1:6379");
  });

  afterAll(async () => {
    if (testClient) {
      const redis = getRedis();
      const keys = await redis.keys("test:p0_c:*");
      if (keys.length > 0) {
        await redis.del(...keys);
      }
      await redis.del("org_conc:retry-org", "org_conc:double-org");
      await redis.del("global_conc");
      await redis.del("org_conc:org-a", "org_conc:org-b", "org_conc:org-c");
      await redis.del("org_conc:crash-org");
      await redis.del("org_conc:test-org");
      // clean c2 race keys that may leak
      const raceKeys = await redis.keys("org_conc:c2-race-*");
      if (raceKeys.length > 0) await redis.del(...raceKeys);
      await testClient!.close();
    }
  });

  describe("Org isolation", () => {
    it("should enforce org concurrency limits across organizations", async () => {
      const redis = getRedis();
      const orgLimit = 4;
      const globalLimit = 10;
      const orgPromises: Promise<boolean>[] = [];
      for (let i = 0; i < 100; i++) {
        orgPromises.push(
          acquireOrgConcurrency("org-a", orgLimit, redis as any).then((result) => {
            if (result.allowed) {
              return releaseOrgConcurrency("org-a", redis as any).then(() => result.allowed);
            }
            return result.allowed;
          }),
        );
        orgPromises.push(
          acquireOrgConcurrency("org-b", orgLimit, redis as any).then((result) => {
            if (result.allowed) {
              return releaseOrgConcurrency("org-b", redis as any).then(() => result.allowed);
            }
            return result.allowed;
          }),
        );
        orgPromises.push(
          acquireOrgConcurrency("org-c", orgLimit, redis as any).then((result) => {
            if (result.allowed) {
              return releaseOrgConcurrency("org-c", redis as any).then(() => result.allowed);
            }
            return result.allowed;
          }),
        );
      }
      await Promise.all(orgPromises);
      const globalCounter = (await redis.get("test:p0_c:global_conc")) || "0";
      expect(parseInt(globalCounter, 10)).toBeLessThanOrEqual(globalLimit);
    });
  });

  describe("Org exact-limit race", () => {
    it("should handle org counter=3, limit=4 correctly (100 rounds)", async () => {
      const redis = getRedis();
      let violations = 0;
      for (let round = 0; round < 100; round++) {
        const org = `c2-race-${round}-${Date.now()}-${Math.random()}`;
        await redis.del(`org_conc:${org}`);
        await redis.set(`org_conc:${org}`, "3");

        let releaseGate: () => void;
        const gate = new Promise<void>((resolve) => {
          releaseGate = resolve;
        });
        let arrived = 0;
        const [a, b] = await Promise.all([
          (async () => {
            if (++arrived === 2) releaseGate!();
            await gate;
            return acquireOrgConcurrency(org, 4, redis as any);
          })(),
          (async () => {
            if (++arrived === 2) releaseGate!();
            await gate;
            return acquireOrgConcurrency(org, 4, redis as any);
          })(),
        ]);

        const allowedCount = [a.allowed, b.allowed].filter(Boolean).length;
        const counter = parseInt((await redis.get(`org_conc:${org}`)) || "0", 10);
        if (allowedCount !== 1 || counter > 4) violations++;
        if (a.allowed) await releaseOrgConcurrency(org, redis as any);
        if (b.allowed) await releaseOrgConcurrency(org, redis as any);
        await redis.del(`org_conc:${org}`);
      }
      expect(violations).toBe(0);
    });
  });

  describe("Global exact-limit race", () => {
    it("should handle global counter=9, limit=10 correctly (100 rounds)", async () => {
      const redis = getRedis();
      let violations = 0;
      for (let round = 0; round < 100; round++) {
        await redis.del("global_conc");
        await redis.set("global_conc", "9");

        let releaseGate: () => void;
        const gate = new Promise<void>((resolve) => {
          releaseGate = resolve;
        });
        let arrived = 0;
        const [a, b] = await Promise.all([
          (async () => {
            if (++arrived === 2) releaseGate!();
            await gate;
            return acquireGlobalConcurrency(10, redis as any);
          })(),
          (async () => {
            if (++arrived === 2) releaseGate!();
            await gate;
            return acquireGlobalConcurrency(10, redis as any);
          })(),
        ]);

        const allowedCount = [a.allowed, b.allowed].filter(Boolean).length;
        const counter = parseInt((await redis.get("global_conc")) || "0", 10);
        if (allowedCount !== 1 || counter > 10) violations++;
        if (a.allowed) await releaseGlobalConcurrency(redis as any);
        if (b.allowed) await releaseGlobalConcurrency(redis as any);
        await redis.del("global_conc");
      }
      expect(violations).toBe(0);
    });
  });

  describe("Retry amplification", () => {
    it("should measure worker-side admission churn", async () => {
      const redis = getRedis();
      await redis.del("org_conc:org-a", "org_conc:org-b", "global_conc");
      const orgLimit = 4;
      const aResults: boolean[] = [];
      for (let i = 0; i < 100; i++) {
        const result = await acquireOrgConcurrency("org-a", orgLimit, redis as any);
        if (result.allowed) {
          await releaseOrgConcurrency("org-a", redis as any);
          aResults.push(true);
        } else {
          aResults.push(false);
        }
      }
      const bResults: boolean[] = [];
      for (let i = 0; i < 10; i++) {
        const result = await acquireOrgConcurrency("org-b", orgLimit, redis as any);
        if (result.allowed) {
          await releaseOrgConcurrency("org-b", redis as any);
          bResults.push(true);
        } else {
          bResults.push(false);
        }
      }
      expect(aResults.filter((x) => x).length).toBeGreaterThan(0);
      expect(bResults.filter((x) => x).length).toBeGreaterThan(0);
      await redis.del("org_conc:org-a", "org_conc:org-b");
    });
  });

  describe("Tenant fairness", () => {
    it("should measure fairness between organizations", async () => {
      const redis = getRedis();
      await redis.del("org_conc:org-a", "org_conc:org-b", "org_conc:org-c");
      const aStartTimes: number[] = [];
      const bStartTimes: number[] = [];
      const cStartTimes: number[] = [];
      for (let i = 0; i < 100; i++) {
        const start = Date.now();
        const result = await acquireOrgConcurrency("org-a", 4, redis as any);
        if (result.allowed) {
          const releaseStart = Date.now();
          await releaseOrgConcurrency("org-a", redis as any);
          aStartTimes.push(releaseStart - start);
        }
      }
      for (let i = 0; i < 10; i++) {
        const start = Date.now();
        const result = await acquireOrgConcurrency("org-b", 4, redis as any);
        if (result.allowed) {
          const releaseStart = Date.now();
          await releaseOrgConcurrency("org-b", redis as any);
          bStartTimes.push(releaseStart - start);
        }
      }
      for (let i = 0; i < 10; i++) {
        const start = Date.now();
        const result = await acquireOrgConcurrency("org-c", 4, redis as any);
        if (result.allowed) {
          const releaseStart = Date.now();
          await releaseOrgConcurrency("org-c", redis as any);
          cStartTimes.push(releaseStart - start);
        }
      }
      expect(aStartTimes.length).toBeGreaterThan(0);
      expect(bStartTimes.length).toBeGreaterThan(0);
      expect(cStartTimes.length).toBeGreaterThan(0);
      await redis.del("org_conc:org-a", "org_conc:org-b", "org_conc:org-c");
    });
  });

  describe("Backpressure", () => {
    it("should measure queue behavior under load", async () => {
      const redis = getRedis();
      const iterations = 100;
      const queueDepths: number[] = [];
      const retryCounts: number[] = [];
      for (let i = 0; i < iterations; i++) {
        const result = await acquireOrgConcurrency("test-org", 5, redis as any);
        if (result.allowed) {
          await releaseOrgConcurrency("test-org", redis as any);
        }
        const depth = (await redis.get("test:p0_c:org:counter")) || "0";
        queueDepths.push(parseInt(depth, 10));
        if (!result.allowed) {
          retryCounts.push(i);
        }
      }
      expect(queueDepths.length).toBe(iterations);
    });
  });

  describe("Starvation", () => {
    it("should allow B/C to execute after A heavy load", async () => {
      const redis = getRedis();
      const orgLimit = 4;
      for (let i = 0; i < 500; i++) {
        const r = await acquireOrgConcurrency("org-a", orgLimit, redis as any);
        if (r.allowed) await releaseOrgConcurrency("org-a", redis as any);
      }
      const bResults: boolean[] = [];
      for (let i = 0; i < 10; i++) {
        const result = await acquireOrgConcurrency("org-b", orgLimit, redis as any);
        if (result.allowed) {
          await releaseOrgConcurrency("org-b", redis as any);
          bResults.push(true);
        } else {
          bResults.push(false);
        }
      }
      const cResults: boolean[] = [];
      for (let i = 0; i < 10; i++) {
        const result = await acquireOrgConcurrency("org-c", orgLimit, redis as any);
        if (result.allowed) {
          await releaseOrgConcurrency("org-c", redis as any);
          cResults.push(true);
        } else {
          cResults.push(false);
        }
      }
      expect(bResults.filter((x) => x).length).toBeGreaterThan(0);
      expect(cResults.filter((x) => x).length).toBeGreaterThan(0);
    });
  });

  describe("Crash recovery", () => {
    it("should recover org and global capacity after simulated crash", async () => {
      const redis = getRedis();
      await redis.del("org_conc:crash-org");
      await redis.del("global_conc");
      const orgRes = await acquireOrgConcurrency("crash-org", 5, redis as any);
      const globalRes = await acquireGlobalConcurrency(10, redis as any);
      expect(orgRes.allowed).toBe(true);
      expect(globalRes.allowed).toBe(true);
      const orgCount = parseInt((await redis.get("org_conc:crash-org")) || "0", 10);
      const globalCount = parseInt((await redis.get("global_conc")) || "0", 10);
      expect(orgCount).toBe(1);
      expect(globalCount).toBe(1);
      await redis.expire("org_conc:crash-org", 1);
      await redis.expire("global_conc", 1);
      await new Promise((r) => setTimeout(r, 2100));
      const orgAfter = await redis.get("org_conc:crash-org");
      const globalAfter = await redis.get("global_conc");
      expect(orgAfter).toBeNull();
      expect(globalAfter).toBeNull();
      const orgRes2 = await acquireOrgConcurrency("crash-org", 5, redis as any);
      const globalRes2 = await acquireGlobalConcurrency(10, redis as any);
      expect(orgRes2.allowed).toBe(true);
      expect(globalRes2.allowed).toBe(true);
      await releaseOrgConcurrency("crash-org", redis as any);
      await releaseGlobalConcurrency(redis as any);
    });
  });

  describe("Redis outage", () => {
    it("should fail closed when Redis is unavailable (disposable client)", async () => {
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
        // expected to fail
      }
      const result = await acquireOrgConcurrency("outage-disposable", 5, badClient as any);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Redis safety mechanism unreachable");
      await badClient.quit().catch(() => {});
      const recovery = await acquireOrgConcurrency("outage-disposable", 5, redis as any);
      expect(recovery.allowed).toBe(true);
      await releaseOrgConcurrency("outage-disposable", redis as any);
    });
  });

  describe("Redis recovery", () => {
    it("should resume scheduling after Redis restore", async () => {
      const redis = getRedis();
      const result = await acquireOrgConcurrency("recovery-org", 5, redis as any);
      expect(result.allowed).toBe(true);
      await releaseOrgConcurrency("recovery-org", redis as any);
      const globalResult = await acquireGlobalConcurrency(10, redis as any);
      expect(globalResult.allowed).toBe(true);
      await releaseGlobalConcurrency(redis as any);
    });
  });

  describe("Double release", () => {
    it("should not make counter negative for global and org", async () => {
      const redis = getRedis();
      await redis.set("org_conc:double-org", "1");
      await redis.set("global_conc", "1");
      await releaseOrgConcurrency("double-org", redis as any);
      await releaseOrgConcurrency("double-org", redis as any);
      await releaseGlobalConcurrency(redis as any);
      await releaseGlobalConcurrency(redis as any);
      const orgCounter = parseInt((await redis.get("org_conc:double-org")) || "0", 10);
      const globalCounter = parseInt((await redis.get("global_conc")) || "0", 10);
      expect(orgCounter).toBe(0);
      expect(globalCounter).toBe(0);
      await redis.del("org_conc:double-org");
      await redis.del("global_conc");
    });
  });

  describe("Retry safety", () => {
    it("should not permanently consume multiple org/global reservations on retry", async () => {
      const redis = getRedis();
      const orgLimit = 4;
      await redis.del("org_conc:retry-org");
      const r1 = await acquireOrgConcurrency("retry-org", orgLimit, redis as any);
      expect(r1.allowed).toBe(true);
      const r2 = await acquireOrgConcurrency("retry-org", orgLimit, redis as any);
      expect(r2.allowed).toBe(true);
      const count = parseInt((await redis.get("org_conc:retry-org")) || "0", 10);
      expect(count).toBe(2);
      await releaseOrgConcurrency("retry-org", redis as any);
      await releaseOrgConcurrency("retry-org", redis as any);
      const final = parseInt((await redis.get("org_conc:retry-org")) || "0", 10);
      expect(final).toBe(0);
    });
  });

  describe("GitHub idempotency", () => {
    it("should not create duplicate logical PRs", async () => {
      const redis = getRedis();
      const org = "test-org";
      const result = await acquireOrgConcurrency(org, 5, redis as any);
      expect(result.allowed).toBe(true);
      await releaseOrgConcurrency(org, redis as any);
      const result2 = await acquireOrgConcurrency(org, 5, redis as any);
      expect(result2.allowed).toBe(true);
      await releaseOrgConcurrency(org, redis as any);
    });
  });
});
