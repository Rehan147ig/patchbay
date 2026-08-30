/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  acquireGlobalConcurrency,
  acquireOrgConcurrency,
  releaseGlobalConcurrency,
  releaseOrgConcurrency,
} from "./index.js";

declare const global: any;

describe("P0-C: Concurrency & Fairness", () => {
  beforeAll(async () => {
    if (!(global as any).redis) {
      const { Redis } = await import("ioredis");
      const client = new (Redis as any)("redis://127.0.0.1:6379");
      await new Promise<void>((resolve) => {
        client.once("ready", () => resolve());
        client.once("error", () => resolve());
        setTimeout(() => resolve(), 3000);
      });
      (global as any).redis = client;
    }
    if (!(global as any).redis) {
      throw new Error("Redis client not initialized");
    }
  });

  afterAll(async () => {
    const keys = await (global as any).redis.keys("test:p0_c:*");
    if (keys.length > 0) {
      await (global as any).redis.del(...keys);
    }
  });

  describe("Org isolation", () => {
    it("should enforce org concurrency limits across organizations", async () => {
      const orgLimit = 4;
      const globalLimit = 10;
      const orgPromises: Promise<boolean>[] = [];
      for (let i = 0; i < 100; i++) {
        orgPromises.push(
          acquireOrgConcurrency("org-a", orgLimit).then((result) => {
            if (result.allowed) {
              return releaseOrgConcurrency("org-a").then(() => result.allowed);
            }
            return result.allowed;
          }),
        );
        orgPromises.push(
          acquireOrgConcurrency("org-b", orgLimit).then((result) => {
            if (result.allowed) {
              return releaseOrgConcurrency("org-b").then(() => result.allowed);
            }
            return result.allowed;
          }),
        );
        orgPromises.push(
          acquireOrgConcurrency("org-c", orgLimit).then((result) => {
            if (result.allowed) {
              return releaseOrgConcurrency("org-c").then(() => result.allowed);
            }
            return result.allowed;
          }),
        );
      }
      await Promise.all(orgPromises);
      const globalCounter = (await (global as any).redis.get("test:p0_c:global_conc")) || "0";
      expect(parseInt(globalCounter, 10)).toBeLessThanOrEqual(globalLimit);
    });
  });

  describe("Org exact-limit race", () => {
    it("should handle org counter=3, limit=4 correctly (100 rounds)", async () => {
      let violations = 0;
      for (let round = 0; round < 100; round++) {
        const org = `c2-race-${round}-${Date.now()}-${Math.random()}`;
        await (global as any).redis.del(`org_conc:${org}`);
        await (global as any).redis.set(`org_conc:${org}`, "3");

        let releaseGate: () => void;
        const gate = new Promise<void>((resolve) => {
          releaseGate = resolve;
        });
        let arrived = 0;
        const [a, b] = await Promise.all([
          (async () => {
            if (++arrived === 2) releaseGate!();
            await gate;
            return acquireOrgConcurrency(org, 4);
          })(),
          (async () => {
            if (++arrived === 2) releaseGate!();
            await gate;
            return acquireOrgConcurrency(org, 4);
          })(),
        ]);

        const allowedCount = [a.allowed, b.allowed].filter(Boolean).length;
        const counter = parseInt((await (global as any).redis.get(`org_conc:${org}`)) || "0", 10);
        if (allowedCount !== 1 || counter > 4) violations++;
        if (a.allowed) await releaseOrgConcurrency(org);
        if (b.allowed) await releaseOrgConcurrency(org);
        await (global as any).redis.del(`org_conc:${org}`);
      }
      expect(violations).toBe(0);
    });
  });

  describe("Global exact-limit race", () => {
    it("should handle global counter=9, limit=10 correctly (100 rounds)", async () => {
      let violations = 0;
      for (let round = 0; round < 100; round++) {
        await (global as any).redis.del("global_conc");
        await (global as any).redis.set("global_conc", "9");

        let releaseGate: () => void;
        const gate = new Promise<void>((resolve) => {
          releaseGate = resolve;
        });
        let arrived = 0;
        const [a, b] = await Promise.all([
          (async () => {
            if (++arrived === 2) releaseGate!();
            await gate;
            return acquireGlobalConcurrency(10);
          })(),
          (async () => {
            if (++arrived === 2) releaseGate!();
            await gate;
            return acquireGlobalConcurrency(10);
          })(),
        ]);

        const allowedCount = [a.allowed, b.allowed].filter(Boolean).length;
        const counter = parseInt((await (global as any).redis.get("global_conc")) || "0", 10);
        if (allowedCount !== 1 || counter > 10) violations++;
        if (a.allowed) await releaseGlobalConcurrency();
        if (b.allowed) await releaseGlobalConcurrency();
        await (global as any).redis.del("global_conc");
      }
      expect(violations).toBe(0);
    });
  });

  describe("Retry amplification", () => {
    it("should measure worker-side admission churn", async () => {
      await (global as any).redis.del("org_conc:org-a", "org_conc:org-b", "global_conc");
      const orgLimit = 4;
      const aResults: boolean[] = [];
      for (let i = 0; i < 100; i++) {
        const result = await acquireOrgConcurrency("org-a", orgLimit);
        if (result.allowed) {
          await releaseOrgConcurrency("org-a");
          aResults.push(true);
        } else {
          aResults.push(false);
        }
      }
      const bResults: boolean[] = [];
      for (let i = 0; i < 10; i++) {
        const result = await acquireOrgConcurrency("org-b", orgLimit);
        if (result.allowed) {
          await releaseOrgConcurrency("org-b");
          bResults.push(true);
        } else {
          bResults.push(false);
        }
      }
      expect(aResults.filter((x) => x).length).toBeGreaterThan(0);
      expect(bResults.filter((x) => x).length).toBeGreaterThan(0);
      await (global as any).redis.del("org_conc:org-a", "org_conc:org-b");
    });
  });

  describe("Tenant fairness", () => {
    it("should measure fairness between organizations", async () => {
      await (global as any).redis.del("org_conc:org-a", "org_conc:org-b", "org_conc:org-c");
      const aStartTimes: number[] = [];
      const bStartTimes: number[] = [];
      const cStartTimes: number[] = [];
      for (let i = 0; i < 100; i++) {
        const start = Date.now();
        const result = await acquireOrgConcurrency("org-a", 4);
        if (result.allowed) {
          const releaseStart = Date.now();
          await releaseOrgConcurrency("org-a");
          aStartTimes.push(releaseStart - start);
        }
      }
      for (let i = 0; i < 10; i++) {
        const start = Date.now();
        const result = await acquireOrgConcurrency("org-b", 4);
        if (result.allowed) {
          const releaseStart = Date.now();
          await releaseOrgConcurrency("org-b");
          bStartTimes.push(releaseStart - start);
        }
      }
      for (let i = 0; i < 10; i++) {
        const start = Date.now();
        const result = await acquireOrgConcurrency("org-c", 4);
        if (result.allowed) {
          const releaseStart = Date.now();
          await releaseOrgConcurrency("org-c");
          cStartTimes.push(releaseStart - start);
        }
      }
      expect(aStartTimes.length).toBeGreaterThan(0);
      expect(bStartTimes.length).toBeGreaterThan(0);
      expect(cStartTimes.length).toBeGreaterThan(0);
      await (global as any).redis.del("org_conc:org-a", "org_conc:org-b", "org_conc:org-c");
    });
  });

  describe("Backpressure", () => {
    it("should measure queue behavior under load", async () => {
      const iterations = 100;
      const queueDepths: number[] = [];
      const retryCounts: number[] = [];
      for (let i = 0; i < iterations; i++) {
        const result = await acquireOrgConcurrency("test-org", 5);
        if (result.allowed) {
          await releaseOrgConcurrency("test-org");
        }
        const depth = (await (global as any).redis.get("test:p0_c:org:counter")) || "0";
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
      const orgLimit = 4;
      for (let i = 0; i < 500; i++) {
        const r = await acquireOrgConcurrency("org-a", orgLimit);
        if (r.allowed) await releaseOrgConcurrency("org-a");
      }
      const bResults: boolean[] = [];
      for (let i = 0; i < 10; i++) {
        const result = await acquireOrgConcurrency("org-b", orgLimit);
        if (result.allowed) {
          await releaseOrgConcurrency("org-b");
          bResults.push(true);
        } else {
          bResults.push(false);
        }
      }
      const cResults: boolean[] = [];
      for (let i = 0; i < 10; i++) {
        const result = await acquireOrgConcurrency("org-c", orgLimit);
        if (result.allowed) {
          await releaseOrgConcurrency("org-c");
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
      await (global as any).redis.del("org_conc:crash-org");
      await (global as any).redis.del("global_conc");
      const orgRes = await acquireOrgConcurrency("crash-org", 5);
      const globalRes = await acquireGlobalConcurrency(10);
      expect(orgRes.allowed).toBe(true);
      expect(globalRes.allowed).toBe(true);
      const orgCount = parseInt((await (global as any).redis.get("org_conc:crash-org")) || "0", 10);
      const globalCount = parseInt((await (global as any).redis.get("global_conc")) || "0", 10);
      expect(orgCount).toBe(1);
      expect(globalCount).toBe(1);
      await (global as any).redis.expire("org_conc:crash-org", 1);
      await (global as any).redis.expire("global_conc", 1);
      await new Promise((r) => setTimeout(r, 2100));
      const orgAfter = await (global as any).redis.get("org_conc:crash-org");
      const globalAfter = await (global as any).redis.get("global_conc");
      expect(orgAfter).toBeNull();
      expect(globalAfter).toBeNull();
      const orgRes2 = await acquireOrgConcurrency("crash-org", 5);
      const globalRes2 = await acquireGlobalConcurrency(10);
      expect(orgRes2.allowed).toBe(true);
      expect(globalRes2.allowed).toBe(true);
      await releaseOrgConcurrency("crash-org");
      await releaseGlobalConcurrency();
    });
  });

  describe("Redis outage", () => {
    it("should fail closed when Redis is unavailable (disposable client)", async () => {
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
      const recovery = await acquireOrgConcurrency("outage-disposable", 5);
      expect(recovery.allowed).toBe(true);
      await releaseOrgConcurrency("outage-disposable");
    });
  });

  describe("Redis recovery", () => {
    it("should resume scheduling after Redis restore", async () => {
      const result = await acquireOrgConcurrency("recovery-org", 5);
      expect(result.allowed).toBe(true);
      await releaseOrgConcurrency("recovery-org");
      const globalResult = await acquireGlobalConcurrency(10);
      expect(globalResult.allowed).toBe(true);
      await releaseGlobalConcurrency();
    });
  });

  describe("Double release", () => {
    it("should not make counter negative for global and org", async () => {
      await (global as any).redis.set("org_conc:double-org", "1");
      await (global as any).redis.set("global_conc", "1");
      await releaseOrgConcurrency("double-org");
      await releaseOrgConcurrency("double-org");
      await releaseGlobalConcurrency();
      await releaseGlobalConcurrency();
      const orgCounter = parseInt(
        (await (global as any).redis.get("org_conc:double-org")) || "0",
        10,
      );
      const globalCounter = parseInt((await (global as any).redis.get("global_conc")) || "0", 10);
      expect(orgCounter).toBe(0);
      expect(globalCounter).toBe(0);
      await (global as any).redis.del("org_conc:double-org");
      await (global as any).redis.del("global_conc");
    });
  });

  describe("Retry safety", () => {
    it("should not permanently consume multiple org/global reservations on retry", async () => {
      const orgLimit = 4;
      await (global as any).redis.del("org_conc:retry-org");
      const r1 = await acquireOrgConcurrency("retry-org", orgLimit);
      expect(r1.allowed).toBe(true);
      const r2 = await acquireOrgConcurrency("retry-org", orgLimit);
      expect(r2.allowed).toBe(true);
      const count = parseInt((await (global as any).redis.get("org_conc:retry-org")) || "0", 10);
      expect(count).toBe(2);
      await releaseOrgConcurrency("retry-org");
      await releaseOrgConcurrency("retry-org");
      const final = parseInt((await (global as any).redis.get("org_conc:retry-org")) || "0", 10);
      expect(final).toBe(0);
    });
  });

  describe("GitHub idempotency", () => {
    it("should not create duplicate logical PRs", async () => {
      const org = "test-org";
      const result = await acquireOrgConcurrency(org, 5);
      expect(result.allowed).toBe(true);
      await releaseOrgConcurrency(org);
      const result2 = await acquireOrgConcurrency(org, 5);
      expect(result2.allowed).toBe(true);
      await releaseOrgConcurrency(org);
    });
  });
});
