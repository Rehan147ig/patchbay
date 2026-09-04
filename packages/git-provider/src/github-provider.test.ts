import { describe, expect, it, vi } from "vitest";
import { GitHubProvider, createGitProviderFromEnv } from "./github-provider";
import { GitHubAppProvider } from "./github-app-provider";
import { LocalGitProvider } from "./index";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const PATCHES = [{ filePath: "src/chat/chat-service.ts", patchedContent: "// patched" }];

describe("GitHubProvider", () => {
  it("creates a draft PR via a single signed Git Data API commit", async () => {
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const call = { url, method: init?.method ?? "GET", body: init?.body as string | undefined };
      calls.push(call);

      if (url.endsWith("/repos/acme/app")) {
        return jsonResponse(200, { default_branch: "main" });
      }
      if (url.includes("/pulls") && init?.method === "GET") {
        return jsonResponse(200, []);
      }
      if (url.includes("/git/ref/heads/main")) {
        return jsonResponse(200, { object: { sha: "base-sha" } });
      }
      if (url.endsWith("/git/refs")) {
        expect(JSON.parse(init?.body as string)).toEqual({
          ref: "refs/heads/patchbay/fix-1",
          sha: "base-sha",
        });
        return jsonResponse(201, { ref: "refs/heads/patchbay/fix-1" });
      }
      if (url.includes("/git/ref/heads/patchbay%2Ffix-1")) {
        return jsonResponse(200, { object: { sha: "base-sha" } });
      }
      if (url.endsWith("/git/commits/base-sha")) {
        return jsonResponse(200, { sha: "base-sha", tree: { sha: "base-tree-sha" } });
      }
      if (url.endsWith("/git/blobs")) {
        const body = JSON.parse(init?.body as string);
        expect(body).toEqual({
          content: Buffer.from("// patched", "utf8").toString("base64"),
          encoding: "base64",
        });
        return jsonResponse(201, { sha: "blob-sha" });
      }
      if (url.endsWith("/git/trees")) {
        const body = JSON.parse(init?.body as string);
        expect(body).toEqual({
          base_tree: "base-tree-sha",
          tree: [
            {
              path: "src/chat/chat-service.ts",
              mode: "100644",
              type: "blob",
              sha: "blob-sha",
            },
          ],
        });
        return jsonResponse(201, { sha: "new-tree-sha" });
      }
      if (url.endsWith("/git/commits")) {
        const body = JSON.parse(init?.body as string);
        // No explicit author/committer: with an App installation token GitHub
        // signs the commit as the App bot (Verified badge). Sending either
        // field would attribute (and sign) differently, so assert absence.
        expect(body).toEqual({
          message: "[Patch] Fix",
          tree: "new-tree-sha",
          parents: ["base-sha"],
        });
        return jsonResponse(201, { sha: "commit-sha", tree: { sha: "new-tree-sha" } });
      }
      if (url.includes("/git/refs/heads/patchbay%2Ffix-1") && init?.method === "PATCH") {
        const body = JSON.parse(init?.body as string);
        // Never forced: clobbering a moved tip must fail loudly, not overwrite.
        expect(body).toEqual({ sha: "commit-sha" });
        return jsonResponse(200, { ref: "refs/heads/patchbay/fix-1" });
      }
      if (url.endsWith("/pulls") && init?.method === "POST") {
        const body = JSON.parse(init?.body as string);
        expect(body).toMatchObject({
          title: "[Patch] Fix",
          head: "patchbay/fix-1",
          base: "main",
          draft: true,
        });
        return jsonResponse(201, { number: 42, html_url: "https://github.com/acme/app/pull/42" });
      }
      throw new Error(`unexpected request: ${init?.method} ${url}`);
    }) as typeof fetch;

    const provider = new GitHubProvider({
      token: "ghp_test",
      repository: "acme/app",
      fetchImpl,
    });

    const result = await provider.createDraftPullRequest({
      repositoryName: "app",
      fixtureDir: "",
      branchName: "patchbay/fix-1",
      title: "[Patch] Fix",
      body: "Automated.",
      patches: PATCHES,
    });

    expect(result).toMatchObject({
      provider: "GITHUB",
      url: "https://github.com/acme/app/pull/42",
      externalId: "42",
      status: "DRAFT",
      branchName: "patchbay/fix-1",
    });
    expect(calls).toHaveLength(11);
    expect(calls.every((c) => c.url.startsWith("https://api.github.com"))).toBe(true);
  });

  it("rejects patch paths escaping the repository before any blob is created", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? "GET" });
      if (url.endsWith("/repos/acme/app")) {
        return jsonResponse(200, { default_branch: "main" });
      }
      if (url.includes("/pulls") && init?.method === "GET") {
        return jsonResponse(200, []);
      }
      if (url.includes("/git/ref/heads/main")) {
        return jsonResponse(200, { object: { sha: "base-sha" } });
      }
      if (url.endsWith("/git/refs")) {
        return jsonResponse(201, {});
      }
      throw new Error(`unexpected request: ${init?.method} ${url}`);
    }) as typeof fetch;

    const provider = new GitHubProvider({
      token: "ghp_test",
      repository: "acme/app",
      fetchImpl,
    });

    await expect(
      provider.createDraftPullRequest({
        repositoryName: "app",
        fixtureDir: "",
        branchName: "patchbay/fix-1",
        title: "Fix",
        body: "body",
        patches: [{ filePath: "../evil.ts", patchedContent: "// evil" }],
      }),
    ).rejects.toThrow("escapes the repository");
    expect(calls.some((c) => c.url.endsWith("/git/blobs"))).toBe(false);
  });

  it("throws a clear error when the GitHub API rejects", async () => {
    const fetchImpl = (async () =>
      jsonResponse(401, { message: "Bad credentials" })) as typeof fetch;

    const provider = new GitHubProvider({
      token: "ghp_bad",
      repository: "acme/app",
      fetchImpl,
    });

    await expect(
      provider.createDraftPullRequest({
        repositoryName: "app",
        fixtureDir: "",
        branchName: "patchbay/fix-1",
        title: "Fix",
        body: "body",
        patches: PATCHES,
      }),
    ).rejects.toThrow("GitHub API GET /repos/acme/app failed: 401 Bad credentials");
  });

  it("rejects invalid configuration", () => {
    expect(() => new GitHubProvider({ token: "", repository: "acme/app" })).toThrow(
      "requires a token",
    );
    expect(() => new GitHubProvider({ token: "t", repository: "not-a-owner-repo" })).toThrow(
      "owner/name form",
    );
  });

  it("refuses an empty changeset instead of opening a no-op commit", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const provider = new GitHubProvider({
      token: "ghp_test",
      repository: "acme/app",
      fetchImpl,
    });

    await expect(
      provider.createDraftPullRequest({
        repositoryName: "app",
        fixtureDir: "",
        branchName: "patchbay/empty",
        title: "Fix",
        body: "body",
        patches: [],
      }),
    ).rejects.toThrow(/at least one patch/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails loudly on a non-fast-forward ref update (race) instead of overwriting", async () => {
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      if (url.endsWith("/repos/acme/app")) {
        return jsonResponse(200, { default_branch: "main" });
      }
      if (url.includes("/pulls") && init?.method === "GET") {
        return jsonResponse(200, []);
      }
      if (url.includes("/git/ref/heads/main")) {
        return jsonResponse(200, { object: { sha: "base-sha" } });
      }
      if (url.endsWith("/git/refs")) {
        return jsonResponse(201, { ref: "refs/heads/patchbay/race" });
      }
      if (url.includes("/git/ref/heads/patchbay%2Frace")) {
        return jsonResponse(200, { object: { sha: "base-sha" } });
      }
      if (url.endsWith("/git/commits/base-sha")) {
        return jsonResponse(200, { sha: "base-sha", tree: { sha: "base-tree-sha" } });
      }
      if (url.endsWith("/git/blobs")) {
        return jsonResponse(201, { sha: "blob-sha" });
      }
      if (url.endsWith("/git/trees")) {
        return jsonResponse(201, { sha: "new-tree-sha" });
      }
      if (url.endsWith("/git/commits")) {
        return jsonResponse(201, { sha: "commit-sha", tree: { sha: "new-tree-sha" } });
      }
      if (url.includes("/git/refs/heads/patchbay%2Frace") && init?.method === "PATCH") {
        // Someone moved the tip mid-flight: non-fast-forward must fail loudly.
        return jsonResponse(422, { message: "Reference update failed: non-fast-forward" });
      }
      throw new Error(`unexpected request: ${init?.method} ${url}`);
    }) as typeof fetch;

    const provider = new GitHubProvider({
      token: "ghp_test",
      repository: "acme/app",
      fetchImpl,
    });

    await expect(
      provider.createDraftPullRequest({
        repositoryName: "app",
        fixtureDir: "",
        branchName: "patchbay/race",
        title: "Fix",
        body: "body",
        patches: PATCHES,
      }),
    ).rejects.toThrow(/PATCH .* failed: 422 .*non-fast-forward/);
  });

  it("resolves the HEAD sha of the default branch", async () => {
    const fetchImpl = (async (url: string) => {
      if (url.endsWith("/repos/acme/app")) {
        return jsonResponse(200, { default_branch: "main" });
      }
      if (url.includes("/git/ref/heads/main")) {
        return jsonResponse(200, { object: { sha: "head-sha-1" } });
      }
      throw new Error(`unexpected request: ${url}`);
    }) as typeof fetch;

    const provider = new GitHubProvider({
      token: "ghp_test",
      repository: "acme/app",
      fetchImpl,
    });

    await expect(provider.resolveHeadSha()).resolves.toBe("head-sha-1");
  });

  it("resolves the HEAD sha of a specific branch", async () => {
    const fetchImpl = (async (url: string) => {
      if (url.includes("/git/ref/heads/release-2")) {
        return jsonResponse(200, { object: { sha: "release-sha" } });
      }
      throw new Error(`unexpected request: ${url}`);
    }) as typeof fetch;

    const provider = new GitHubProvider({
      token: "ghp_test",
      repository: "acme/app",
      fetchImpl,
    });

    await expect(provider.resolveHeadSha("release-2")).resolves.toBe("release-sha");
  });
});

describe("createGitProviderFromEnv", () => {
  it("returns a GitHub provider when credentials are configured", () => {
    const provider = createGitProviderFromEnv({
      GITHUB_TOKEN: "ghp_x",
      GITHUB_REPOSITORY: "acme/app",
    } as NodeJS.ProcessEnv);
    expect(provider).toBeInstanceOf(GitHubProvider);
  });

  it("returns the GitHub App provider when a target is given and the App is configured", () => {
    const provider = createGitProviderFromEnv(
      { installationId: 42, repositoryFullName: "acme/app", baseBranch: "main" },
      {
        GITHUB_APP_ID: "12345",
        GITHUB_APP_PRIVATE_KEY: Buffer.from("dummy-private-key-pem", "utf8").toString("base64"),
      } as NodeJS.ProcessEnv,
    );
    expect(provider).toBeInstanceOf(GitHubAppProvider);
  });

  it("refuses the global PAT fallback when a target is given but the App is unconfigured", () => {
    // Routing every org's PRs to one globally-configured PAT repository would
    // be a cross-tenant write; it must fail loudly instead.
    expect(() =>
      createGitProviderFromEnv({ installationId: 42, repositoryFullName: "acme/app" }, {
        GITHUB_TOKEN: "ghp_x",
        GITHUB_REPOSITORY: "acme/app",
      } as NodeJS.ProcessEnv),
    ).toThrow(/refusing the global PAT fallback/);
  });

  it("refuses a target when no credentials exist at all", () => {
    expect(() =>
      createGitProviderFromEnv(
        { installationId: 42, repositoryFullName: "acme/app" },
        {} as NodeJS.ProcessEnv,
      ),
    ).toThrow(/refusing the global PAT fallback/);
  });

  it("falls back to the local provider without credentials", () => {
    const provider = createGitProviderFromEnv({} as NodeJS.ProcessEnv);
    expect(provider).toBeInstanceOf(LocalGitProvider);
  });
});
