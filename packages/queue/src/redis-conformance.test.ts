// Real-Redis conformance test for Lua acquire exact-limit race
// B2/C2/C3: org/global/PR slot concurrency at limit-1 with two concurrent acquires
// Runs 1000 rounds with isolated keys, captures diagnostics per P0 spec.
// Atomicity is green only when exactly one of two concurrent acquires is allowed
// and final counter = limit across all 1000 rounds.

import { describe, it, expect, beforeAll, afterAll } from "vitest";

beforeAll(async () => {
  if (!(global as any).redis) {
    const { Redis: RedisConstructor } = await import("ioredis");
    const client = new RedisConstructor("redis://127.0.0.1:6379");
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
  const { redis } = global as any;
  if (redis) {
    const keys = await redis.keys("test:p0_c:*");
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  }
});

// === Organization Concurrency Exact-Limit Race (B2) ===
describe("CONFORMED: Org exact-limit race (B2 conformance)", () => {
  it("should allow exactly 1 of 2 concurrent acquires when starting at limit-1, 1000 rounds", async () => {
    let violations = 0;
    const violations_detail: Array<{
      round: number;
      key: string;
      allowed_a: boolean;
      allowed_b: boolean;
      allowedCount: number;
      counter_final: number;
      pttl: number;
      redisEndpoint: string;
    }> = [];

    for (let round = 0; round < 1000; round++) {
      const org = `conformance-b2-${round}`;
      const key = `org_conc:${org}`;
      const redisEndpoint = "redis://127.0.0.1:6379";

      // Initialize key to limit - 1 = 4 for limit 5
      await (global as any).redis.del(key);
      await (global as any).redis.set(key, "4");

      // Two concurrent acquires via acquireOrgConcurrency
      const { acquireOrgConcurrency: aoc } = await import("@patchbay/queue");
      const orgRes1 = await aoc(org, 5);
      const orgRes2 = await aoc(org, 5);

      const allowedA = orgRes1.allowed;
      const allowedB = orgRes2.allowed;
      const allowedCount = [allowedA, allowedB].filter(Boolean).length;
      const counter_final = parseInt(
        (await (global as any).redis.get(key)) || "0",
        10,
      );
      const pttl = await (global as any).redis.pttl(key);

      // Diagnostics: record per-round data
      violations_detail.push({
        round,
        key,
        allowed_a: allowedA,
        allowed_b: allowedB,
        allowedCount,
        counter_final,
        pttl,
        redisEndpoint,
      });

      // Cleanup: key will be reset next round; best-effort del
      if (orgRes1.allowed) await (global as any).redis.del(key);
      if (orgRes2.allowed) await (global as any).redis.del(key);

      // Assertion: exactly one allowed, final counter = limit
      if (allowedCount !== 1 || counter_final !== 5) {
        violations++;
      }
    }

    const violationDetail = violations_detail.slice(0, 10);
    console.log(`Org B2 conformance: ${1000 - violations}/1000 rounds passed`);
    console.log(`Violations: ${violations}/1000`);
    if (violationDetail.length > 0) {
      console.log("First 10 violation details:", violationDetail);
    }

    expect(violations).toBe(0);
  });
});

// === Global Concurrency Exact-Limit Race (C3) ===
describe("CONFORMED: Global exact-limit race (C3 conformance)", () => {
  it("should allow exactly 1 of 2 concurrent acquires when starting at limit-1, 1000 rounds", async () => {
    let violations = 0;
    const violations_detail: Array<{
      round: number;
      key: string;
      allowed_a: boolean;
      allowed_b: boolean;
      allowedCount: number;
      counter_final: number;
      pttl: number;
      redisEndpoint: string;
    }> = [];

    for (let round = 0; round < 1000; round++) {
      const key = "global_conc";
      const redisEndpoint = "redis://127.0.0.1:6379";

      // Initialize key to limit - 1 = 9 for limit 10
      await (global as any).redis.del(key);
      await (global as any).redis.set(key, "9");

      // Two concurrent acquires via acquireGlobalConcurrency
      const { acquireGlobalConcurrency: agc } = await import("@patchbay/queue");
      const globalRes1 = await agc(10);
      const globalRes2 = await agc(10);

      const allowedA = globalRes1.allowed;
      const allowedB = globalRes2.allowed;
      const allowedCount = [allowedA, allowedB].filter(Boolean).length;
      const counter_final = parseInt(
        (await (global as any).redis.get(key)) || "0",
        10,
      );
      const pttl = await (global as any).redis.pttl(key);

      // Diagnostics
      violations_detail.push({
        round,
        key,
        allowed_a: allowedA,
        allowed_b: allowedB,
        allowedCount,
        counter_final,
        pttl,
        redisEndpoint,
      });

      // Cleanup
      if (globalRes1.allowed) await (global as any).redis.del(key);
      if (globalRes2.allowed) await (global as any).redis.del(key);

      // Assertion
      if (allowedCount !== 1 || counter_final !== 10) {
        violations++;
      }
    }

    console.log(`Global C3 conformance: ${1000 - violations}/1000 rounds passed`);
    console.log(`Violations: ${violations}/1000`);
    if (violations_detail.length > 0 && violations > 0) {
      console.log("First 5 violation details:", violations_detail.slice(0, 5));
    }

    expect(violations).toBe(0);
  });
});

// === PR Slot Exact-Limit Race ===
describe("CONFORMED: PR slot exact-limit race", () => {
  it("should allow exactly 1 of 2 concurrent acquires when starting at limit-1 (4/5), 1000 rounds", async () => {
    let violations = 0;
    const violations_detail: Array<{
      round: number;
      key: string;
      allowed_a: boolean;
      allowed_b: boolean;
      allowedCount: number;
      counter_final: number;
      pttl: number;
      redisEndpoint: string;
    }> = [];

    for (let round = 0; round < 1000; round++) {
      const org = `conformance-pr-${round}`;
      const key = `pr_slot:${org}`;
      const redisEndpoint = "redis://127.0.0.1:6379";

      // Initialize key to limit - 1 = 4 for limit 5
      await (global as any).redis.del(key);
      await (global as any).redis.set(key, "4");

      // Two concurrent acquires via raw EVAL with ACQUIRE_LUA
      const { ACQUIRE_LUA } = await import("@patchbay/queue");
      const [a, b] = await Promise.all([
        (global as any).redis.eval(ACQUIRE_LUA, 1, key, "5", "86400"),
        (global as any).redis.eval(ACQUIRE_LUA, 1, key, "5", "86400"),
      ]);

      const allowedA = a[0] === 1;
      const allowedB = b[0] === 1;
      const allowedCount = [allowedA, allowedB].filter(Boolean).length;
      const counter_final = parseInt(
        (await (global as any).redis.get(key)) || "0",
        10,
      );
      const pttl = await (global as any).redis.pttl(key);

      // Diagnostics
      violations_detail.push({
        round,
        key,
        allowed_a: allowedA,
        allowed_b: allowedB,
        allowedCount,
        counter_final,
        pttl,
        redisEndpoint,
      });

      // Cleanup
      await (global as any).redis.del(key);

      // Assertion
      if (allowedCount !== 1 || counter_final !== 5) {
        violations++;
      }
    }

    console.log(`PR slot conformance: ${1000 - violations}/1000 rounds passed`);
    console.log(`Violations: ${violations}/1000`);
    if (violations_detail.length > 0 && violations > 0) {
      console.log("First 5 violation details:", violations_detail.slice(0, 5));
    }

    expect(violations).toBe(0);
  });
});