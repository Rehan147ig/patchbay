import { describe, expect, it } from "vitest";
import {
  ANALYSIS_CACHE_MAX_BYTES,
  analysisCacheKey,
  readAnalysisCache,
  writeAnalysisCache,
  type AnalysisCacheClient,
} from "./analysis-cache";
import type { RepositoryAnalysis } from "@patchbay/repo-analysis";

function memoryClient(): AnalysisCacheClient & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    setex: async (key: string, _ttl: number, value: string) => {
      store.set(key, value);
      return "OK";
    },
    get: async (key: string) => store.get(key) ?? null,
  };
}

function analysis(): RepositoryAnalysis {
  return {
    packageManager: "pnpm",
    packageCount: 1,
    filesScanned: 2,
    typescriptFiles: 2,
    pythonFiles: 0,
    javaFiles: 0,
    durationMs: 10,
    commitSha: "sha-abc",
    lockfileVersions: {},
    untrackedUsages: 0,
    untrackedPackages: [],
    manifests: [],
    pythonManifests: [],
    usages: [],
    errors: [],
  };
}

describe("analysisCacheKey", () => {
  it("is deterministic and order-insensitive over track packages", () => {
    expect(analysisCacheKey("sha-1", ["openai", "stripe"])).toBe(
      analysisCacheKey("sha-1", ["stripe", "openai"]),
    );
    expect(analysisCacheKey("sha-1", ["openai"])).not.toBe(analysisCacheKey("sha-2", ["openai"]));
  });
});

describe("writeAnalysisCache / readAnalysisCache", () => {
  it("round-trips an analysis", async () => {
    const client = memoryClient();
    expect(await writeAnalysisCache(client, "sha-abc", ["openai"], analysis())).toBe(true);
    expect(await readAnalysisCache(client, "sha-abc", ["openai"])).toEqual(analysis());
  });

  it("misses on unknown keys and track-set changes", async () => {
    const client = memoryClient();
    await writeAnalysisCache(client, "sha-abc", ["openai"], analysis());
    expect(await readAnalysisCache(client, "sha-other", ["openai"])).toBeNull();
    expect(await readAnalysisCache(client, "sha-abc", ["stripe"])).toBeNull();
  });

  it("rejects corrupt entries instead of throwing", async () => {
    const client = memoryClient();
    client.store.set(analysisCacheKey("sha-abc", ["openai"]), "{not json");
    expect(await readAnalysisCache(client, "sha-abc", ["openai"])).toBeNull();
    client.store.set(analysisCacheKey("sha-abc", ["openai"]), JSON.stringify({ bogus: true }));
    expect(await readAnalysisCache(client, "sha-abc", ["openai"])).toBeNull();
  });

  it("skips oversize payloads without throwing", async () => {
    const client = memoryClient();
    const big = analysis();
    (big as { usages: unknown[] }).usages = new Array(100_000).fill({ x: "y".repeat(100) });
    expect(JSON.stringify(big).length).toBeGreaterThan(ANALYSIS_CACHE_MAX_BYTES);
    expect(await writeAnalysisCache(client, "sha-abc", ["openai"], big)).toBe(false);
    expect(client.store.size).toBe(0);
  });

  it("survives client failures on both paths", async () => {
    const failing: AnalysisCacheClient = {
      setex: async () => {
        throw new Error("redis down");
      },
      get: async () => {
        throw new Error("redis down");
      },
    };
    expect(await writeAnalysisCache(failing, "sha-abc", ["openai"], analysis())).toBe(false);
    expect(await readAnalysisCache(failing, "sha-abc", ["openai"])).toBeNull();
  });
});
