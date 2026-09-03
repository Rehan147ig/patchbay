import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyzeRepository } from "./analyzer";
import { shouldParallelize, splitChunks } from "./parallel";

const FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/repositories/openai-node-legacy",
);

describe("splitChunks", () => {
  it("preserves order across chunks", () => {
    const items = [1, 2, 3, 4, 5, 6, 7];
    expect(splitChunks(items, 3).flat()).toEqual(items);
  });

  it("handles empty input and oversized counts", () => {
    expect(splitChunks([], 4)).toEqual([]);
    expect(splitChunks([1, 2], 8)).toEqual([[1, 2]]);
  });
});

describe("shouldParallelize", () => {
  it("forces on and off via env regardless of file count", () => {
    expect(
      shouldParallelize(1, { force: "1", minFiles: 200, maxWorkers: 4, taskTimeoutMs: 1 }),
    ).toBe(true);
    expect(
      shouldParallelize(10000, { force: "0", minFiles: 200, maxWorkers: 4, taskTimeoutMs: 1 }),
    ).toBe(false);
  });

  it("uses the file threshold in auto mode", () => {
    expect(
      shouldParallelize(199, { force: "", minFiles: 200, maxWorkers: 4, taskTimeoutMs: 1 }),
    ).toBe(false);
    expect(
      shouldParallelize(200, { force: "", minFiles: 200, maxWorkers: 4, taskTimeoutMs: 1 }),
    ).toBe(true);
  });
});

describe("parallel vs serial analysis", () => {
  it("produces identical usages with workers forced on and off", async () => {
    process.env.REPO_ANALYSIS_PARALLEL = "1";
    const parallel = await analyzeRepository({ rootDir: FIXTURE, trackPackages: ["openai"] });
    process.env.REPO_ANALYSIS_PARALLEL = "0";
    const serial = await analyzeRepository({ rootDir: FIXTURE, trackPackages: ["openai"] });
    delete process.env.REPO_ANALYSIS_PARALLEL;

    expect(parallel.usages).toEqual(serial.usages);
    expect(parallel.untrackedPackages).toEqual(serial.untrackedPackages);
    expect(parallel.untrackedUsages).toBe(serial.untrackedUsages);
    expect(parallel.usages.length).toBeGreaterThan(0);
  }, 120_000);
});
