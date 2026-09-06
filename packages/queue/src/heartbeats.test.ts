import { describe, expect, it, vi } from "vitest";
import type { Redis } from "ioredis";
import { readWorkerHeartbeats, writeWorkerHeartbeat, WORKER_HEARTBEATS_KEY } from "./index";

type HeartbeatClient = Pick<Redis, "hset" | "hgetall" | "hdel">;

function fakeRedis() {
  const store = new Map<string, string>();
  const client = {
    store,
    hset: vi.fn(async (key: string, obj: Record<string, string>) => {
      if (key !== WORKER_HEARTBEATS_KEY) throw new Error("wrong key");
      for (const [field, value] of Object.entries(obj)) store.set(field, value);
      return Object.keys(obj).length;
    }),
    hgetall: vi.fn(async (key: string) => {
      if (key !== WORKER_HEARTBEATS_KEY) throw new Error("wrong key");
      return Object.fromEntries(store.entries());
    }),
    hdel: vi.fn(async (key: string, ...fields: string[]) => {
      let removed = 0;
      for (const field of fields) {
        if (store.delete(field)) removed += 1;
      }
      return removed;
    }),
  };
  return Object.assign(client as unknown as HeartbeatClient, { store });
}

describe("worker heartbeats", () => {
  it("writes a fresh heartbeat readable by the queues endpoint", async () => {
    const redis = fakeRedis();
    await writeWorkerHeartbeat(
      { workerId: "w-1", startedAt: new Date().toISOString(), queue: "remediation" },
      redis,
    );
    const beats = await readWorkerHeartbeats(redis);
    expect(beats).toHaveLength(1);
    expect(beats[0]).toMatchObject({ workerId: "w-1", fresh: true, queue: "remediation" });
  });

  it("marks stale writers and prunes them on the next write", async () => {
    const redis = fakeRedis();
    redis.store.set(
      "w-old",
      JSON.stringify({ workerId: "w-old", startedAt: "2020-01-01", lastBeatAt: "2020-01-01" }),
    );
    redis.store.set("w-bad", "not-json");
    const before = await readWorkerHeartbeats(redis, 1);
    expect(before.find((beat) => beat.workerId === "w-old")?.fresh).toBe(false);
    await writeWorkerHeartbeat({ workerId: "w-new", startedAt: new Date().toISOString() }, redis);
    expect(redis.store.has("w-old")).toBe(false);
    expect(redis.store.has("w-bad")).toBe(false);
    expect(redis.store.has("w-new")).toBe(true);
  });

  it("degrades to an empty list when Redis is down", async () => {
    const down = {
      hset: vi.fn(async () => {
        throw new Error("redis down");
      }),
      hgetall: vi.fn(async () => {
        throw new Error("redis down");
      }),
      hdel: vi.fn(),
    };
    await expect(writeWorkerHeartbeat({ workerId: "w-1", startedAt: "x" }, down)).rejects.toThrow(
      "redis down",
    );
    await expect(readWorkerHeartbeats(down)).resolves.toEqual([]);
  });
});
