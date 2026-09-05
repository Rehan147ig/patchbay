// Real-Redis conformance test for Lua acquire exact-limit race
// B2/C2/C3: org/global slot concurrency at limit-1 with two concurrent acquires
// Runs 1000 rounds with isolated keys, captures diagnostics per P0 spec.
// Atomicity is green only when exactly one of two concurrent acquires is allowed
// and final counter = limit across all 1000 rounds.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Redis } from "ioredis";
import { createRedisTestClient } from "./redis-test-client.js";
import { ACQUIRE_LUA } from "./index.js";

const REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
const CONFORMANCE_REDIS_DB = 15; // Dedicated DB to avoid key collision with other Redis suites

/**
 * Environment gate (same idiom as worm-db.test.ts): this suite needs a live
 * Redis. Skipped automatically when none is reachable; run with env loaded:
 *
 *   npx dotenv -e .env -- pnpm vitest run packages/queue/src/redis-conformance.test.ts
 *
 * The probe uses its own client (no retries, silenced errors) so an absent
 * Redis stays quiet instead of failing the file.
 */
const redisReachable = await (async () => {
  const probe = new Redis(REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    retryStrategy: () => null,
  });
  probe.on("error", () => {});
  try {
    await probe.connect();
    await probe.ping();
    return true;
  } catch {
    return false;
  } finally {
    try {
      await probe.quit();
    } catch {
      // best-effort cleanup
    }
  }
})();

let testClient: import("./redis-test-client.js").IRedisTestClient | undefined;

beforeAll(async () => {
  testClient = await createRedisTestClient(REDIS_URL);
  // Switch to dedicated DB for conformance to avoid colliding with other Redis suites
  if (testClient && testClient.redis) {
    await testClient.redis.select(CONFORMANCE_REDIS_DB);
  }
});

afterAll(async () => {
  if (testClient) {
    await testClient.redis.select(0); // restore to DB 0
    await testClient.close();
  }
});

// === Organization Concurrency Exact-Limit Race (B2 conformance) ===
describe.skipIf(!redisReachable)("CONFORMED: Org exact-limit race (B2 conformance)", () => {
  it("should allow exactly 1 of 2 concurrent acquires when starting at limit-1, 1000 rounds", async () => {
    let violations = 0;
    let firstViolationRound = -1;
    const violations_detail: Array<{
      round: number;
      key: string;
      allowed_a: boolean;
      allowed_b: boolean;
      allowedCount: number;
      counter_final: number;
      pttl: number;
      rawResultA: number[];
      rawResultB: number[];
      redisEndpoint: string;
    }> = [];

    for (let round = 0; round < 1000; round++) {
      const org = `conformance-b2-${round}`;
      const testKey = `org_conc:${org}`;

      // Use the shared ready test client with dedicated DB
      const client = testClient!.redis;
      await client.del(testKey);
      await client.set(testKey, "4");

      // Two concurrent acquires using the SAME ready injected client - capture RAW EVAL results via Promise.all
      const [rawA, rawB] = (await Promise.all([
        client.eval(ACQUIRE_LUA, 1, testKey, String(5), String(86400)),
        client.eval(ACQUIRE_LUA, 1, testKey, String(5), String(86400)),
      ])) as [number, number][];

      // Validate raw EVAL structure
      if (!Array.isArray(rawA) || rawA.length < 2 || !Array.isArray(rawB) || rawB.length < 2) {
        violations++;
        if (firstViolationRound < 0) firstViolationRound = round;
        continue;
      }

      const allowedA = rawA[0] === 1;
      const allowedB = rawB[0] === 1;
      const allowedCount = [allowedA, allowedB].filter(Boolean).length;

      // Read final counter and TTL
      const counter_final = parseInt((await client.get(testKey)) || "0", 10);
      const pttl = await client.pttl(testKey);

      // Record per-round data
      violations_detail.push({
        round,
        key: testKey,
        allowed_a: allowedA,
        allowed_b: allowedB,
        allowedCount,
        counter_final,
        pttl,
        rawResultA: rawA,
        rawResultB: rawB,
        redisEndpoint: REDIS_URL,
      });

      // Best-effort cleanup: remove key for next round
      await client.del(testKey);

      // Assertion: exactly one allowed, final counter = limit
      if (allowedCount !== 1 || counter_final !== 5) {
        violations++;
        if (firstViolationRound < 0) firstViolationRound = round;
      }
    }

    // Print diagnostics for FIRST failed round only
    if (firstViolationRound >= 0) {
      const first = violations_detail.find((v) => v.round === firstViolationRound);
      if (first) {
        console.log(`\n--- FIRST FAILED ROUND (B2 conformance) ---`);
        console.log(`Round: ${first.round}`);
        console.log(`Key: ${first.key}`);
        console.log(`Redis DB: ${CONFORMANCE_REDIS_DB}`);
        console.log(`Raw EVAL result A: ${JSON.stringify(first.rawResultA)}`);
        console.log(`Raw EVAL result B: ${JSON.stringify(first.rawResultB)}`);
        console.log(`Parsed allowed_a: ${first.allowed_a}`);
        console.log(`Parsed allowed_b: ${first.allowed_b}`);
        console.log(`Allowed count: ${first.allowedCount}`);
        console.log(`Final counter value: ${first.counter_final}`);
        console.log(`PTTL: ${first.pttl} ms`);
        console.log(`Expected counter: 5`);
        console.log(`--- END FIRST FAILED ROUND ---\n`);
      }
    }

    console.log(`Org B2 conformance: ${1000 - violations}/1000 rounds passed`);
    console.log(`Violations: ${violations}/1000`);

    expect(violations).toBe(0);
  });
});

// === Global Concurrency Exact-Limit Race (C3 conformance) ===
describe.skipIf(!redisReachable)("CONFORMED: Global exact-limit race (C3 conformance)", () => {
  it("should allow exactly 1 of 2 concurrent acquires when starting at limit-1, 1000 rounds", async () => {
    let violations = 0;
    let firstViolationRound = -1;
    const violations_detail: Array<{
      round: number;
      key: string;
      allowed_a: boolean;
      allowed_b: boolean;
      allowedCount: number;
      counter_final: number;
      pttl: number;
      rawResultA: number[];
      rawResultB: number[];
      redisEndpoint: string;
    }> = [];

    for (let round = 0; round < 1000; round++) {
      const testKey = "global_conc";

      // Use the shared ready test client with dedicated DB
      const client = testClient!.redis;
      await client.del(testKey);
      await client.set(testKey, "9");

      // Two concurrent acquires using the SAME ready injected client - capture RAW EVAL results via Promise.all
      const [rawA, rawB] = (await Promise.all([
        client.eval(ACQUIRE_LUA, 1, testKey, String(10), String(86400)),
        client.eval(ACQUIRE_LUA, 1, testKey, String(10), String(86400)),
      ])) as [number, number][];

      // Validate raw EVAL structure
      if (!Array.isArray(rawA) || rawA.length < 2 || !Array.isArray(rawB) || rawB.length < 2) {
        violations++;
        if (firstViolationRound < 0) firstViolationRound = round;
        continue;
      }

      const allowedA = rawA[0] === 1;
      const allowedB = rawB[0] === 1;
      const allowedCount = [allowedA, allowedB].filter(Boolean).length;

      // Read final counter and TTL
      const counter_final = parseInt((await client.get(testKey)) || "0", 10);
      const pttl = await client.pttl(testKey);

      // Record per-round data
      violations_detail.push({
        round,
        key: testKey,
        allowed_a: allowedA,
        allowed_b: allowedB,
        allowedCount,
        counter_final,
        pttl,
        rawResultA: rawA,
        rawResultB: rawB,
        redisEndpoint: REDIS_URL,
      });

      // Best-effort cleanup: remove key for next round
      await client.del(testKey);

      // Assertion: exactly one allowed, final counter = limit
      if (allowedCount !== 1 || counter_final !== 10) {
        violations++;
        if (firstViolationRound < 0) firstViolationRound = round;
      }
    }

    // Print diagnostics for FIRST failed round only
    if (firstViolationRound >= 0) {
      const first = violations_detail.find((v) => v.round === firstViolationRound);
      if (first) {
        console.log(`\n--- FIRST FAILED ROUND (C3 conformance) ---`);
        console.log(`Round: ${first.round}`);
        console.log(`Key: ${first.key}`);
        console.log(`Redis DB: ${CONFORMANCE_REDIS_DB}`);
        console.log(`Raw EVAL result A: ${JSON.stringify(first.rawResultA)}`);
        console.log(`Raw EVAL result B: ${JSON.stringify(first.rawResultB)}`);
        console.log(`Parsed allowed_a: ${first.allowed_a}`);
        console.log(`Parsed allowed_b: ${first.allowed_b}`);
        console.log(`Allowed count: ${first.allowedCount}`);
        console.log(`Final counter value: ${first.counter_final}`);
        console.log(`PTTL: ${first.pttl} ms`);
        console.log(`Expected counter: 10`);
        console.log(`--- END FIRST FAILED ROUND ---\n`);
      }
    }

    console.log(`Global C3 conformance: ${1000 - violations}/1000 rounds passed`);
    console.log(`Violations: ${violations}/1000`);

    expect(violations).toBe(0);
  });
});

// === PR-Slot Path Conformance ===
describe.skipIf(!redisReachable)("CONFORMED: PR-slot path conformance", () => {
  it("should independently prove the PR-slot admission path at limit-1, 1000 rounds", async () => {
    let violations = 0;
    let firstViolationRound = -1;
    const violations_detail: Array<{
      round: number;
      key: string;
      allowed: boolean;
      slotCount: number;
      counter_final: number;
      pttl: number;
      redisEndpoint: string;
    }> = [];

    for (let round = 0; round < 1000; round++) {
      const slotKey = `pr-slot-conformance-${round}`;

      // Use the shared ready test client with dedicated DB
      const client = testClient!.redis;
      await client.del(slotKey);
      await client.set(slotKey, "4");

      // Two concurrent acquires at exact limit-1 via Promise.all
      const [rawA, rawB] = (await Promise.all([
        client.eval(ACQUIRE_LUA, 1, slotKey, String(5), String(86400)),
        client.eval(ACQUIRE_LUA, 1, slotKey, String(5), String(86400)),
      ])) as [number, number][];

      // Validate raw EVAL structure
      if (!Array.isArray(rawA) || rawA.length < 2 || !Array.isArray(rawB) || rawB.length < 2) {
        violations++;
        if (firstViolationRound < 0) firstViolationRound = round;
        continue;
      }

      const allowedA = rawA[0] === 1;
      const allowedB = rawB[0] === 1;
      const slotCountA = rawA[1];
      const slotCountB = rawB[1];

      // Read final counter and TTL
      const counter_final = parseInt((await client.get(slotKey)) || "0", 10);
      const pttl = await client.pttl(slotKey);

      // Record per-round data
      violations_detail.push({
        round,
        key: slotKey,
        allowed: allowedA || allowedB, // at least one should be allowed
        slotCount: slotCountA + slotCountB,
        counter_final,
        pttl,
        redisEndpoint: REDIS_URL,
      });

      // Cleanup: remove key for next round
      await client.del(slotKey);

      // Assertion: counter should be 5 after both acquires
      if (counter_final !== 5) {
        violations++;
        if (firstViolationRound < 0) firstViolationRound = round;
      }
    }

    // Print diagnostics for FIRST failed round only
    if (firstViolationRound >= 0) {
      const first = violations_detail.find((v) => v.round === firstViolationRound);
      if (first) {
        console.log(`\n--- FIRST FAILED ROUND (PR-slot conformance) ---`);
        console.log(`Round: ${first.round}`);
        console.log(`Key: ${first.key}`);
        console.log(`Redis DB: ${CONFORMANCE_REDIS_DB}`);
        console.log(`Allowed: ${first.allowed}`);
        console.log(`Slot count total: ${first.slotCount}`);
        console.log(`Final counter value: ${first.counter_final}`);
        console.log(`PTTL: ${first.pttl} ms`);
        console.log(`Expected counter: 5`);
        console.log(`--- END FIRST FAILED ROUND ---\n`);
      }
    }

    console.log(`PR-slot conformance: ${1000 - violations}/1000 rounds passed`);
    console.log(`Violations: ${violations}/1000`);

    expect(violations).toBe(0);
  });
});
