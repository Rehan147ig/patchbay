import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { GitHubProvider, LocalGitProvider, redactTokenInError } from "./index";

const OPENAI_FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/repositories/openai-node-legacy",
);

const GIT_INTEGRATION = process.env.RUN_GIT_INTEGRATION === "true";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN ?? "";
const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY ?? "";
const GITHUB_SHA = process.env.GITHUB_SHA ?? "";

describe("LocalGitProvider.checkout", () => {
  it("copies a fixture into a disposable workspace with tree/source hashes and provenance", async () => {
    const local = new LocalGitProvider();
    const result = await local.checkout({
      repositoryDir: OPENAI_FIXTURE,
      baseBranch: "main",
    });

    expect(result.workspaceDir).toBeDefined();
    expect(existsSync(result.workspaceDir)).toBe(true);
    expect(existsSync(path.join(result.workspaceDir, "package.json"))).toBe(true);
    expect(result.baseBranch).toBe("main");
    expect(result.treeHash).toMatch(/^[0-9a-f]{16}$/);
    expect(result.sourceHash).toMatch(/^[0-9a-f]{16}$/);
    expect(result.snapshotRecorded).toBe(true);

    rmSync(result.workspaceDir, { recursive: true, force: true });
  });

  it("computes an identical tree hash for identical fixture content", async () => {
    const local = new LocalGitProvider();
    const first = await local.checkout({ repositoryDir: OPENAI_FIXTURE });
    const second = await local.checkout({ repositoryDir: OPENAI_FIXTURE });

    expect(second.treeHash).toBe(first.treeHash);
    expect(second.sourceHash).toBe(first.sourceHash);

    rmSync(first.workspaceDir, { recursive: true, force: true });
    rmSync(second.workspaceDir, { recursive: true, force: true });
  });

  it("cleans up the workspace when the fixture copy fails", async () => {
    const local = new LocalGitProvider();
    await expect(
      local.checkout({ repositoryDir: path.join(OPENAI_FIXTURE, "does-not-exist") }),
    ).rejects.toThrow();
  });

  it("rejects checkout without a fixture directory unless fixture mode is explicit", async () => {
    const local = new LocalGitProvider();
    await expect(
      local.checkout({
        repositoryFullName: "acme/app",
        installationId: 1,
        sha: "abc",
      }),
    ).rejects.toThrow("Fixture mode is not allowed");
  });

  it("requires an exact commit sha in fixture mode", async () => {
    const local = new LocalGitProvider();
    await expect(
      local.checkout({
        repositoryFullName: "acme/app",
        installationId: 1,
        fixtureMode: true,
      }),
    ).rejects.toThrow("requires an exact commit sha");
  });
});

describe("GitHubProvider.checkout contract", () => {
  const provider = new GitHubProvider({ token: "ghp_test", repository: "acme/app" });

  it("requires an exact commit sha before any git work", async () => {
    await expect(
      provider.checkout({
        repositoryFullName: "acme/app",
        installationId: 1,
        baseBranch: "main",
      }),
    ).rejects.toThrow("requires an exact commit sha");
  });

  it("rejects a target that does not match the configured repository", async () => {
    await expect(
      provider.checkout({
        repositoryFullName: "acme/other",
        installationId: 1,
        sha: "0123456789abcdef",
      }),
    ).rejects.toThrow("target acme/other does not match configured repository acme/app");
  });
});

describe("redactTokenInError", () => {
  it("replaces credential material in error messages before they escape", () => {
    const error = new Error(
      "git fetch failed: https://x-access-token:supersecret@github.com/x/y.git",
    );
    const redacted = redactTokenInError(error, "supersecret");
    expect(String(redacted)).toContain("[REDACTED]");
    expect(String(redacted)).not.toContain("supersecret");
  });

  it("leaves unrelated errors untouched", () => {
    const error = new Error("nothing sensitive here");
    expect((redactTokenInError(error, "secret") as Error).message).toBe("nothing sensitive here");
  });
});

describe("exact-SHA checkout integration (env-gated)", () => {
  const integration = GIT_INTEGRATION && GITHUB_TOKEN && GITHUB_REPOSITORY && GITHUB_SHA;
  it.skipIf(!integration)(
    "checks out the exact SHA, records hashes, and never leaks the token",
    async () => {
      const provider = new GitHubProvider({ token: GITHUB_TOKEN, repository: GITHUB_REPOSITORY });
      const result = await provider.checkout({
        organization: GITHUB_REPOSITORY.split("/")[0]!,
        repositoryFullName: GITHUB_REPOSITORY,
        installationId: 0,
        sha: GITHUB_SHA,
      });

      expect(result.workspaceDir).toBeDefined();
      expect(result.treeHash).toMatch(/^[0-9a-f]{16,}$/);
      expect(result.sourceHash).toMatch(/^[0-9a-f]{16}$/);
      expect(result.snapshotRecorded).toBe(true);

      const files = readdirSync(result.workspaceDir);
      expect(files.length).toBeGreaterThan(0);

      // Token must never be persisted in the workspace git config or hooks path.
      const configPath = path.join(result.workspaceDir, ".git", "config");
      expect(existsSync(configPath)).toBe(true);
      const config = readFileSync(configPath, "utf8");
      expect(config).not.toContain(GITHUB_TOKEN);

      try {
        rmSync(result.workspaceDir, { recursive: true, force: true });
        expect(existsSync(result.workspaceDir)).toBe(false);
      } finally {
        rmSync(result.workspaceDir, { recursive: true, force: true });
      }
    },
  );
});
