import { describe, expect, it } from "vitest";
import {
  DEFAULT_WORKER_CONCURRENCY,
  MAX_WORKER_CONCURRENCY,
  resolveWorkerConcurrency,
} from "./worker-concurrency";

describe("resolveWorkerConcurrency", () => {
  it("defaults to 4 when unset or blank", () => {
    expect(resolveWorkerConcurrency({})).toBe(DEFAULT_WORKER_CONCURRENCY);
    expect(resolveWorkerConcurrency({ WORKER_CONCURRENCY: "   " })).toBe(
      DEFAULT_WORKER_CONCURRENCY,
    );
  });

  it("accepts positive integers within bounds", () => {
    expect(resolveWorkerConcurrency({ WORKER_CONCURRENCY: "1" })).toBe(1);
    expect(resolveWorkerConcurrency({ WORKER_CONCURRENCY: "16" })).toBe(16);
    expect(resolveWorkerConcurrency({ WORKER_CONCURRENCY: String(MAX_WORKER_CONCURRENCY) })).toBe(
      MAX_WORKER_CONCURRENCY,
    );
  });

  it("fails closed to the default on garbage, zero, or absurd values", () => {
    for (const raw of ["0", "-3", "2.5", "lots", "NaN", String(MAX_WORKER_CONCURRENCY + 1)]) {
      expect(resolveWorkerConcurrency({ WORKER_CONCURRENCY: raw })).toBe(
        DEFAULT_WORKER_CONCURRENCY,
      );
    }
  });
});
