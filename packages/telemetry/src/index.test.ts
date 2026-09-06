import { describe, expect, it } from "vitest";
import {
  getJobMirrorSnapshot,
  instrumentProcessor,
  recordHttpDuration,
  recordJobOutcome,
  resetJobMirror,
  withSpan,
} from "./index";

describe("telemetry", () => {
  it("mirrors job outcomes per type without throwing (OTEL no-op safe)", () => {
    resetJobMirror();
    recordJobOutcome("run-validation", "completed", 120);
    recordJobOutcome("run-validation", "failed", 45);
    recordJobOutcome("create-pr", "completed", 10);
    expect(getJobMirrorSnapshot()).toMatchObject({
      "run-validation": { completed: 1, failed: 1 },
      "create-pr": { completed: 1, failed: 0 },
    });
  });

  it("passes span-wrapped values through and propagates throws", async () => {
    await expect(withSpan("test.ok", { a: 1 }, async () => 42)).resolves.toBe(42);
    await expect(
      withSpan("test.err", {}, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });

  it("records processor transitions with job attributes", async () => {
    resetJobMirror();
    const processor = instrumentProcessor("scan-repository", async (job) => `done:${job.id}`);
    await expect(
      processor({ id: "job-1", data: { correlationId: "c-1" }, attemptsMade: 2 }),
    ).resolves.toBe("done:job-1");
    const failing = instrumentProcessor("scan-repository", async () => {
      throw new Error("nope");
    });
    await expect(failing({ data: {} })).rejects.toThrow("nope");
    expect(getJobMirrorSnapshot()["scan-repository"]).toMatchObject({ completed: 1, failed: 1 });
  });

  it("records http durations without throwing", () => {
    expect(() => recordHttpDuration("/api/operations/queues", "GET", 12)).not.toThrow();
  });
});
