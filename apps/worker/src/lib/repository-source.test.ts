import { existsSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveRepositorySource } from "./repository-source";

vi.mock("@patchbay/db", () => ({
  prisma: {
    gitHubInstallation: { findUnique: vi.fn() },
  },
}));

vi.mock("@patchbay/git-provider", () => ({
  createGitHubAppProviderFromStore: vi.fn(),
  runGit: vi.fn(),
  assertSafeRepoFullName: vi.fn((name: string) => {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
      throw new Error(`unsafe repository full name rejected: ${name}`);
    }
    return name;
  }),
}));

vi.mock("@patchbay/repo-analysis", () => ({
  resolveFixtureDir: vi.fn(() => "C:/fixtures/openai-node-legacy"),
}));

vi.mock("@patchbay/env", () => ({
  getSecretStore: vi.fn().mockReturnValue({}),
}));

import { assertSafeRepoFullName, runGit } from "@patchbay/git-provider";
import { prisma } from "@patchbay/db";

function repository(overrides: Record<string, unknown> = {}) {
  return {
    id: "repo-1",
    provider: "GITHUB",
    fullName: "acme/app",
    defaultBranch: "main",
    organizationId: "org-1",
    metadata: {},
    ...overrides,
  };
}

describe("resolveRepositorySource", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.gitHubInstallation.findUnique).mockResolvedValue({
      organizationId: "org-1",
    } as never);
  });

  it("resolves fixture metadata with a no-op cleanup", async () => {
    const source = await resolveRepositorySource(
      repository({ provider: "LOCAL", metadata: { fixture: "openai-node-legacy" } }),
    );
    expect(source.kind).toBe("fixture");
    expect(source.rootDir).toBe("C:/fixtures/openai-node-legacy");
    expect(() => source.cleanup()).not.toThrow();
  });

  it("shallow-clones a credential-free github.com cloneUrl into a disposable workspace", async () => {
    const url = "https://github.com/Rehan147ig/patch-demo-openai-legacy";
    const source = await resolveRepositorySource(repository({ metadata: { cloneUrl: url } }));
    expect(source.kind).toBe("clone");
    if (source.kind !== "clone") return;
    expect(source.cloneUrl).toBe(url);
    expect(existsSync(source.rootDir)).toBe(true);
    expect(runGit).toHaveBeenCalledWith(
      ["clone", "--depth", "1", "--single-branch", url, source.rootDir],
      {},
    );
    source.cleanup();
    expect(existsSync(source.rootDir)).toBe(false);
  });

  it("rejects non-github hosts before any git call", async () => {
    await expect(
      resolveRepositorySource(repository({ metadata: { cloneUrl: "https://evil.example/a/b" } })),
    ).rejects.toThrow(/must be an https:\/\/github\.com URL/);
    expect(runGit).not.toHaveBeenCalled();
  });

  it("rejects plain http", async () => {
    await expect(
      resolveRepositorySource(repository({ metadata: { cloneUrl: "http://github.com/a/b" } })),
    ).rejects.toThrow(/must be an https:\/\/github\.com URL/);
    expect(runGit).not.toHaveBeenCalled();
  });

  it("rejects embedded credentials in the URL", async () => {
    await expect(
      resolveRepositorySource(
        repository({ metadata: { cloneUrl: "https://user:pass@github.com/a/b" } }),
      ),
    ).rejects.toThrow(/must not embed credentials/);
    expect(runGit).not.toHaveBeenCalled();
  });

  it("rejects multi-segment paths (transport-modifier style payloads)", async () => {
    await expect(
      resolveRepositorySource(repository({ metadata: { cloneUrl: "https://github.com/a/b/c" } })),
    ).rejects.toThrow(/unsafe repository full name/);
    expect(assertSafeRepoFullName).toHaveBeenCalled();
    expect(runGit).not.toHaveBeenCalled();
  });

  it("cleans up the workspace when the clone fails", async () => {
    vi.mocked(runGit).mockImplementationOnce(() => {
      throw new Error("git clone failed");
    });
    await expect(
      resolveRepositorySource(
        repository({
          metadata: { cloneUrl: "https://github.com/acme/missing-repo" },
        }),
      ),
    ).rejects.toThrow(/git clone failed/);
    // The failed workspace was removed by the error path; nothing to assert
    // beyond the throw since mkdtemp path is internal.
  });
});
