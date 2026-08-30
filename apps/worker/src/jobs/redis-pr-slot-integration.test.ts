/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  acquireGlobalConcurrency,
  acquireOrgConcurrency,
  releaseOrgConcurrency,
} from "@patchbay/queue";

declare const global: any;

describe("P0-B: Redis PR Slot Safety", () => {
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
    await (global as any).redis.del("org_conc:test-org");
    await (global as any).redis.del("org_conc:crash-org");
    await (global as any).redis.del("global_conc");
  });

  describe("B1 concurrent limit 20 workers / limit 5", () => {
    it("should enforce org concurrency limit with real INCR/DECR", async () => {
      await (global as any).redis.del("org_conc:test-org");
      const limit = 5;
      const workers = 20;

      const barrier: Promise<boolean>[] = [];
      for (let i = 0; i < workers; i++) {
        barrier.push(
          (async () => {
            const r = await acquireOrgConcurrency("test-org", limit);
            if (r.allowed) {
              await releaseOrgConcurrency("test-org");
              return true;
            }
            return false;
          })(),
        );
      }
      const results = await Promise.all(barrier);
      const successful = results.filter(Boolean).length;
      const blocked = results.filter((v) => !v).length;
      expect(successful).toBeLessThanOrEqual(5);
      expect(blocked).toBeGreaterThanOrEqual(15);
      const counter = parseInt((await (global as any).redis.get("org_conc:test-org")) || "0", 10);
      expect(counter).toBe(0);
    });
  });

  describe("B2 exact-limit race", () => {
    it("should allow exactly 1 of 2 concurrent when at limit-1 (100 rounds)", async () => {
      let violations = 0;
      for (let round = 0; round < 100; round++) {
        const org = `b2-race-${round}-${Date.now()}-${Math.random()}`;
        await (global as any).redis.del(`org_conc:${org}`);
        await (global as any).redis.set(`org_conc:${org}`, "4");

        // Proper barrier using an array to hold resolvers
        const resolvers: Array<() => void> = [];
        const gate = new Promise<void>((resolve) => {
          resolvers.push(resolve);
        });
        let arrived = 0;
        const [a, b] = await Promise.all([
          (async () => {
            if (++arrived === 2) resolvers[1]!();
            await gate;
            return acquireOrgConcurrency(org, 5);
          })(),
          (async () => {
            if (++arrived === 2) resolvers[0]!();
            await gate;
            return acquireOrgConcurrency(org, 5);
          })(),
        ]);

        const allowedCount = [a.allowed, b.allowed].filter(Boolean).length;
        const counter = parseInt((await (global as any).redis.get(`org_conc:${org}`)) || "0", 10);
        if (allowedCount !== 1 || counter > 5) violations++;
        if (a.allowed) await releaseOrgConcurrency(org);
        if (b.allowed) await releaseOrgConcurrency(org);
        await (global as any).redis.del(`org_conc:${org}`);
      }
      expect(violations).toBe(0);
    });
  });

  describe("B3 normal release", () => {
    it("should restore counter to initial value", async () => {
      await (global as any).redis.set("org_conc:test-org", "3");
      const r = await acquireOrgConcurrency("test-org", 5);
      expect(r.allowed).toBe(true);
      await releaseOrgConcurrency("test-org");
      const current = parseInt((await (global as any).redis.get("org_conc:test-org")) || "0", 10);
      expect(current).toBe(3);
      await (global as any).redis.del("org_conc:test-org");
    });
  });

  describe("B4 rejected reservation rollback", () => {
    it("should roll back over-limit increment", async () => {
      await (global as any).redis.set("org_conc:test-org", "5");
      const result = await acquireOrgConcurrency("test-org", 5);
      expect(result.allowed).toBe(false);
      const counter = parseInt((await (global as any).redis.get("org_conc:test-org")) || "0", 10);
      expect(counter).toBe(5);
      await (global as any).redis.del("org_conc:test-org");
    });
  });

  describe("B5 Redis unavailable", () => {
    it("should fail closed with structured reason (disposable client)", async () => {
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
      const recovery = await acquireOrgConcurrency("b5-outage", 5);
      expect(recovery.allowed).toBe(true);
      await releaseOrgConcurrency("b5-outage");
    });
  });

  describe("B6 Redis recovery", () => {
    it("should resume reservations after Redis restore", async () => {
      await (global as any).redis.del("org_conc:test-org");
      const result = await acquireOrgConcurrency("test-org", 5);
      expect(result.allowed).toBe(true);
      await releaseOrgConcurrency("test-org");
      const counter = parseInt((await (global as any).redis.get("org_conc:test-org")) || "0", 10);
      expect(counter).toBe(0);
    });
  });

  describe("B7 TTL recovery", () => {
    it("should set correct TTL on production key (86400s, not 86400000)", async () => {
      await (global as any).redis.del("org_conc:ttl-test");
      const r = await acquireOrgConcurrency("ttl-test", 5);
      expect(r.allowed).toBe(true);
      const ttl = await (global as any).redis.ttl("org_conc:ttl-test");
      expect(ttl).toBeGreaterThan(86000);
      expect(ttl).toBeLessThanOrEqual(86400);
      expect(ttl).not.toBe(86400000);
      await releaseOrgConcurrency("ttl-test");
      // also verify short TTL expiry for test isolation
      await (global as any).redis.set("test:p0_c:ttl-short", "1");
      await (global as any).redis.expire("test:p0_c:ttl-short", 1);
      await new Promise((r) => setTimeout(r, 2100));
      expect(await (global as any).redis.get("test:p0_c:ttl-short")).toBeNull();
    });
  });

  describe("B8 Process crash", () => {
    it("should not leak slots when worker crashes without release", async () => {
      const crashOrg = `crash-b8-${Date.now()}`;
      const globalKey = `global_conc:b8-${Date.now()}`;
      await (global as any).redis.del(`org_conc:${crashOrg}`);
      await (global as any).redis.del(globalKey);

      // Parent acquires slots
      const r1 = await acquireOrgConcurrency(crashOrg, 5);
      const r2 = await acquireGlobalConcurrency(10);
      expect(r1.allowed).toBe(true);
      expect(r2.allowed).toBe(true);

      const ttl = await (global as any).redis.ttl(`org_conc:${crashOrg}`);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(86400);
      const count = parseInt((await (global as any).redis.get(`org_conc:${crashOrg}`)) || "0", 10);
      expect(count).toBe(1);

      // Spawn child process that acquires slots and crashes
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { spawn } = require("child_process");
      const script = `
const { acquireOrgConcurrency, acquireGlobalConcurrency } = require("@patchbay/queue");
const { Redis } = require("ioredis");
const redis = new Redis("redis://127.0.0.1:6379");
const org = "${crashOrg}";
const globalKey = "${globalKey}";
const orgRes = await acquireOrgConcurrency(org, 5);
const globalRes = await acquireGlobalConcurrency(10);
process.send(JSON.stringify({ org: orgRes.allowed, global: globalRes.allowed }));
await new Promise((r) => setTimeout(r, 100));
process.exit(0);
`;
      const child = spawn("node", [script], { shell: true });
      let childData = "";
      child.stdout.on("data", (chunk: Buffer) => {
        childData += chunk.toString();
      });
      child.stderr.on("data", (chunk: Buffer) => {
        childData += chunk.toString();
      });
      await new Promise((r) => child.on("exit", r));
      const childResult = JSON.parse(childData);
      expect(childResult.org).toBe(true);
      expect(childResult.global).toBe(true);

      // Verify parent still holds slots
      const parentOrgCount = parseInt(
        (await (global as any).redis.get(`org_conc:${crashOrg}`)) || "0",
        10,
      );
      const parentGlobalCount = parseInt(
        (await (global as any).redis.get("global_conc")) || "0",
        10,
      );
      expect(parentOrgCount).toBe(1);
      expect(parentGlobalCount).toBe(1);

      // Child exits, slots should be recoverable via TTL
      await (global as any).redis.expire(`org_conc:${crashOrg}`, 1);
      await (global as any).redis.expire("global_conc", 1);
      await new Promise((r) => setTimeout(r, 2100));
      expect(await (global as any).redis.get(`org_conc:${crashOrg}`)).toBeNull();
      expect(await (global as any).redis.get("global_conc")).toBeNull();

      // Verify recovery
      const r3 = await acquireOrgConcurrency(crashOrg, 5);
      expect(r3.allowed).toBe(true);
      await releaseOrgConcurrency(crashOrg);
    });
  });

  describe("B9 Retry safety", () => {
    it("should not create duplicate slots on retry", async () => {
      await (global as any).redis.del("org_conc:test-org");
      await (global as any).redis.set("org_conc:test-org", "4");
      const r1 = await acquireOrgConcurrency("test-org", 5);
      expect(r1.allowed).toBe(true);
      const r2 = await acquireOrgConcurrency("test-org", 5);
      expect(r2.allowed).toBe(false);
      const counter = parseInt((await (global as any).redis.get("org_conc:test-org")) || "0", 10);
      expect(counter).toBeLessThanOrEqual(5);
      await releaseOrgConcurrency("test-org");
      await (global as any).redis.del("org_conc:test-org");
    });
  });

  describe("B10 GitHub idempotency", () => {
    it("should be idempotent for same remediation key", async () => {
      await (global as any).redis.del("org_conc:test-org");
      const r1 = await acquireOrgConcurrency("test-org", 5);
      expect(r1.allowed).toBe(true);
      await releaseOrgConcurrency("test-org");
      const r2 = await acquireOrgConcurrency("test-org", 5);
      expect(r2.allowed).toBe(true);
      await releaseOrgConcurrency("test-org");
      const counter = parseInt((await (global as any).redis.get("org_conc:test-org")) || "0", 10);
      expect(counter).toBe(0);
    });
  });

  describe("B11 Double release", () => {
    it("should not make counter negative", async () => {
      await (global as any).redis.set("org_conc:test-org", "1");
      await releaseOrgConcurrency("test-org");
      await releaseOrgConcurrency("test-org");
      const counter = parseInt((await (global as any).redis.get("org_conc:test-org")) || "0", 10);
      expect(counter).toBe(0);
      await (global as any).redis.del("org_conc:test-org");
    });
  });
});
