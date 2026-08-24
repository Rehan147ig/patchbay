import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertInstallationBelongsToOrganization,
  resolveRepositorySource,
  type RepositorySourceDeps,
} from "./repository-source";

vi.mock("./git-safe", () => ({
  runGit: vi.fn(),
  assertSafeSha: vi.fn((sha: string) => sha),
  assertSafeRepoFullName: vi.fn((name: string) => {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
      throw new Error(`unsafe repository full name rejected: ${name}`);
    }
    return name;
  }),
  gitAuthEnv: vi.fn(() => ({})),
}));

import { runGit } from "./git-safe";

function makeDeps(overrides: Partial<RepositorySourceDeps> = {}): RepositorySourceDeps {
  return {
    findInstallationOrganizationId: vi.fn().mockResolvedValue("org-1"),
    createInstallationProvider: vi.fn(async ({ installationId }) => ({
      resolveHeadSha: vi.fn().mockResolvedValue("sha-abc"),
      checkout: vi
        .fn()
        .mockResolvedValue({ workspaceDir: path.join(tmpdir(), `patchbay-gh-${installationId}`) }),
    })),
    resolveFixtureDir: vi.fn((name: string) => `/fixtures/${name}`),
    ...overrides,
  };
}

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
  });

  it("resolves fixture metadata through the hardened fixture resolver", async () => {
    const deps = makeDeps();
    const source = await resolveRepositorySource(
      repository({ provider: "LOCAL", metadata: { fixture: "openai-node-legacy" } }),
      deps,
    );
    expect(source.kind).toBe("fixture");
    expect(source.rootDir).toBe("/fixtures/openai-node-legacy");
    expect(() => source.cleanup()).not.toThrow();
    expect(deps.resolveFixtureDir).toHaveBeenCalledWith("openai-node-legacy");
  });

  it("checks out connected GitHub installations at the API-resolved HEAD", async () => {
    const source = await resolveRepositorySource(
      repository({ metadata: { installationId: 42 } }),
      makeDeps(),
    );
    expect(source.kind).toBe("github");
    if (source.kind !== "github") return;
    expect(source.commitSha).toBe("sha-abc");
    const gh = path.join(tmpdir(), "patchbay-gh-42");
    expect(existsSync(gh)).toBe(false);
  });

  it("rejects an installation bound to another organization before any checkout", async () => {
    const deps = makeDeps({
      findInstallationOrganizationId: vi.fn().mockResolvedValue("org-other"),
    });
    await expect(
      resolveRepositorySource(repository({ metadata: { installationId: 42 } }), deps),
    ).rejects.toThrow(/not bound to organization org-1/);
    expect(deps.createInstallationProvider).not.toHaveBeenCalled();
  });

  it("shallow-clones a credential-free github.com cloneUrl into a disposable workspace", async () => {
    const url = "https://github.com/Rehan147ig/patch-demo-openai-legacy";
    const source = await resolveRepositorySource(
      repository({ metadata: { cloneUrl: url } }),
      makeDeps(),
    );
    expect(source.kind).toBe("clone");
    if (source.kind !== "clone") return;
    expect(existsSync(source.rootDir)).toBe(true);
    expect(runGit).toHaveBeenCalledWith(
      ["clone", "--depth", "1", "--single-branch", url, source.rootDir],
      {},
    );
    source.cleanup();
    expect(existsSync(source.rootDir)).toBe(false);
  });

  it.each([
    ["https://evil.example/a/b", /must be an https:\/\/github\.com URL/],
    ["http://github.com/a/b", /must be an https:\/\/github\.com URL/],
    ["https://user:pass@github.com/a/b", /must not embed credentials/],
    ["https://github.com/a/b/c", /unsafe repository full name/],
  ])("rejects hostile cloneUrl %s before any git call", async (url, pattern) => {
    await expect(
      resolveRepositorySource(repository({ metadata: { cloneUrl: url } }), makeDeps()),
    ).rejects.toThrow(pattern as RegExp);
    expect(runGit).not.toHaveBeenCalled();
  });

  it("cleans up the workspace when the clone fails", async () => {
    vi.mocked(runGit).mockImplementationOnce(() => {
      throw new Error("git clone failed");
    });
    await expect(
      resolveRepositorySource(
        repository({ metadata: { cloneUrl: "https://github.com/acme/missing" } }),
        makeDeps(),
      ),
    ).rejects.toThrow(/git clone failed/);
  });
});

describe("assertInstallationBelongsToOrganization", () => {
  it("passes when the installation is bound to the expected organization", async () => {
    const deps = makeDeps();
    await expect(
      assertInstallationBelongsToOrganization(7, "org-1", deps),
    ).resolves.toBeUndefined();
  });

  it("throws for unknown or foreign installations", async () => {
    const deps = makeDeps({
      findInstallationOrganizationId: vi.fn().mockResolvedValue(null),
    });
    await expect(assertInstallationBelongsToOrganization(9, "org-1", deps)).rejects.toThrow(
      /not bound to organization/,
    );
  });
});
