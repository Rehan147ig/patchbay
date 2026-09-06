import { describe, expect, it, vi } from "vitest";
import {
  GitHubApiError,
  GitHubProvider,
  classifyGitHubFailure,
  createGitProviderFromEnv,
} from "./github-provider";
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

describe("WP9 delivery reliability", () => {
  function failureResponse(status: number, message: string, headers: Record<string, string> = {}) {
    return new Response(JSON.stringify({ message }), {
      status,
      headers: { "Content-Type": "application/json", ...headers },
    });
  }

  it("classifies provider failures into retryable and terminal codes", () => {
    const cases: Array<{
      status: number;
      message: string;
      headers?: Record<string, string>;
      code: string;
      retryable: boolean;
    }> = [
      { status: 401, message: "Bad credentials", code: "GITHUB_UNAUTHORIZED", retryable: false },
      {
        status: 403,
        message: "Resource not accessible by integration",
        code: "GITHUB_PERMISSION_LOSS",
        retryable: false,
      },
      {
        status: 403,
        message: "API rate limit exceeded for installation",
        headers: { "retry-after": "30" },
        code: "GITHUB_RATE_LIMITED",
        retryable: true,
      },
      {
        status: 429,
        message: "You have exceeded a secondary rate limit",
        code: "GITHUB_RATE_LIMITED",
        retryable: true,
      },
      { status: 404, message: "Not Found", code: "GITHUB_NOT_FOUND", retryable: false },
      {
        status: 422,
        message: "A pull request already exists for acme:patchbay/x.",
        code: "GITHUB_ALREADY_EXISTS",
        retryable: false,
      },
      {
        status: 422,
        message: "Reference already exists",
        code: "GITHUB_ALREADY_EXISTS",
        retryable: false,
      },
      {
        status: 422,
        message: "Update is not a fast forward",
        code: "GITHUB_CONFLICT",
        retryable: true,
      },
      { status: 409, message: "Conflict: tip moved", code: "GITHUB_CONFLICT", retryable: true },
      { status: 500, message: "Internal Server Error", code: "GITHUB_HTTP_ERROR", retryable: true },
      { status: 502, message: "Bad Gateway", code: "GITHUB_HTTP_ERROR", retryable: true },
      { status: 418, message: "I'm a teapot", code: "GITHUB_HTTP_ERROR", retryable: false },
    ];
    for (const { status, message, headers, code, retryable } of cases) {
      const error = classifyGitHubFailure(
        failureResponse(status, message, headers ?? {}),
        "POST",
        "/repos/acme/app/pulls",
        message,
      );
      expect(error).toBeInstanceOf(GitHubApiError);
      expect(error.code).toBe(code);
      expect(error.retryable).toBe(retryable);
    }
  });

  it("reads rate-limit backoff from headers and keeps the legacy message format", () => {
    const error = classifyGitHubFailure(
      failureResponse(403, "API rate limit exceeded", { "retry-after": "30" }),
      "POST",
      "/repos/acme/app/pulls",
      "API rate limit exceeded",
    );
    expect(error.retryAfterMs).toBe(30_000);
    expect(error.message).toMatch(/GitHub API POST \/repos\/acme\/app\/pulls failed: 403/);
    const resetError = classifyGitHubFailure(
      failureResponse(429, "slow down", {
        "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 60),
      }),
      "GET",
      "/repos/acme/app",
      "slow down",
    );
    expect(resetError.retryAfterMs).toBeGreaterThan(0);
    expect(resetError.retryAfterMs).toBeLessThanOrEqual(60_000);
  });

  it("treats a remaining-quota of zero as rate-limited even on 200-shaped 403s", () => {
    const error = classifyGitHubFailure(
      failureResponse(403, "forbidden", { "x-ratelimit-remaining": "0" }),
      "GET",
      "/repos/acme/app",
      "forbidden",
    );
    expect(error.code).toBe("GITHUB_RATE_LIMITED");
    expect(error.retryable).toBe(true);
  });

  it("wraps network failures as retryable and redacts tokens from messages", async () => {
    const network = new GitHubProvider({
      token: "ghp_test",
      repository: "acme/app",
      fetchImpl: (async () => {
        throw new Error("socket hang up");
      }) as typeof fetch,
    });
    const error = await network.resolveHeadSha("main").then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(GitHubApiError);
    expect((error as GitHubApiError).code).toBe("GITHUB_NETWORK");
    expect((error as GitHubApiError).retryable).toBe(true);

    const leaky = new GitHubProvider({
      token: "ghp_secret-token",
      repository: "acme/app",
      fetchImpl: (async () =>
        failureResponse(401, "Bad credentials for ghp_secret-token")) as typeof fetch,
    });
    const authError = await leaky.resolveHeadSha("main").then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(authError).toBeInstanceOf(GitHubApiError);
    expect((authError as Error).message).not.toContain("ghp_secret-token");
    expect((authError as Error).message).toContain("[REDACTED]");
    // Legacy 401 message match (App provider fresh-token retry) is preserved.
    expect((authError as Error).message).toMatch(/failed: 401/);
  });

  it("syncs new patches onto an existing branch and returns the new tip", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? "GET" });
      if (url.endsWith("/repos/acme/app")) return jsonResponse(200, { default_branch: "main" });
      if (url.includes("/git/ref/heads/main"))
        return jsonResponse(200, { object: { sha: "base-sha" } });
      if (url.endsWith("/git/refs") && init?.method === "POST") {
        const body = JSON.parse(init?.body as string);
        // Idempotent create: an existing branch returns "already exists" and
        // the sync proceeds to commit on the current tip.
        if (body.ref === "refs/heads/patchbay/existing") {
          return failureResponse(422, "Reference already exists");
        }
        return jsonResponse(201, {});
      }
      if (url.includes("/git/ref/heads/patchbay%2Fexisting")) {
        return jsonResponse(200, { object: { sha: "tip-sha" } });
      }
      if (url.endsWith("/git/commits/tip-sha")) {
        return jsonResponse(200, { sha: "tip-sha", tree: { sha: "tip-tree" } });
      }
      if (url.endsWith("/git/blobs")) return jsonResponse(201, { sha: "blob-sha" });
      if (url.endsWith("/git/trees")) return jsonResponse(201, { sha: "tree-sha" });
      if (url.endsWith("/git/commits")) return jsonResponse(201, { sha: "new-sha" });
      if (url.includes("/git/refs/heads/patchbay%2Fexisting") && init?.method === "PATCH") {
        const body = JSON.parse(init?.body as string);
        // Never forced: exactly the new SHA, no `force: true`.
        expect(body).toEqual({ sha: "new-sha" });
        return jsonResponse(200, {});
      }
      throw new Error(`unexpected request: ${init?.method} ${url}`);
    }) as typeof fetch;
    const provider = new GitHubProvider({ token: "ghp_test", repository: "acme/app", fetchImpl });
    const result = await provider.syncBranchWithPatches({
      branchName: "patchbay/existing",
      title: "[Patch] v2",
      patches: PATCHES,
    });
    expect(result).toEqual({ commitSha: "new-sha" });
    expect(calls.some((call) => call.url.endsWith("/git/trees"))).toBe(true);
  });

  it("refuses an empty sync instead of shipping a no-op commit", async () => {
    const provider = new GitHubProvider({
      token: "ghp_test",
      repository: "acme/app",
      fetchImpl: (async () => jsonResponse(200, {})) as typeof fetch,
    });
    await expect(
      provider.syncBranchWithPatches({ branchName: "patchbay/x", title: "t", patches: [] }),
    ).rejects.toThrow(/at least one patch/);
  });

  it("updates a PR body and validates its inputs", async () => {
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      if (url.endsWith("/repos/acme/app/pulls/42") && init?.method === "PATCH") {
        const body = JSON.parse(init?.body as string);
        expect(body).toEqual({ title: "[Patch] v2", body: "evidence" });
        return jsonResponse(200, { number: 42, html_url: "https://github.com/acme/app/pull/42" });
      }
      throw new Error(`unexpected request: ${init?.method} ${url}`);
    }) as typeof fetch;
    const provider = new GitHubProvider({ token: "ghp_test", repository: "acme/app", fetchImpl });
    await expect(
      provider.updatePullRequest({ number: 42, title: "[Patch] v2", body: "evidence" }),
    ).resolves.toEqual({ number: 42, htmlUrl: "https://github.com/acme/app/pull/42" });
    await expect(provider.updatePullRequest({ number: 0, body: "x" })).rejects.toThrow(
      /positive PR number/,
    );
    await expect(provider.updatePullRequest({ number: 42 })).rejects.toThrow(/title or body/);
  });

  it("creates check runs with validation evidence and validates its inputs", async () => {
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      if (url.endsWith("/repos/acme/app/check-runs") && init?.method === "POST") {
        const body = JSON.parse(init?.body as string);
        expect(body).toMatchObject({
          name: "patchbay-validation",
          head_sha: "a".repeat(40),
          status: "completed",
          conclusion: "success",
        });
        expect(body.output.title).toBe("patchbay-validation");
        expect(body.output.summary).toContain("PASSED");
        return jsonResponse(201, { id: 777, html_url: "https://github.com/acme/app/runs/777" });
      }
      throw new Error(`unexpected request: ${init?.method} ${url}`);
    }) as typeof fetch;
    const provider = new GitHubProvider({ token: "ghp_test", repository: "acme/app", fetchImpl });
    await expect(
      provider.createCheckRun({
        headSha: "a".repeat(40),
        name: "patchbay-validation",
        conclusion: "success",
        summary: "Patchbay validation PASSED",
        text: "details",
      }),
    ).resolves.toEqual({ id: 777, htmlUrl: "https://github.com/acme/app/runs/777" });
    await expect(
      provider.createCheckRun({
        headSha: "not-a-sha",
        name: "patchbay-validation",
        conclusion: "success",
        summary: "x",
      }),
    ).rejects.toThrow();
    await expect(
      provider.createCheckRun({
        headSha: "a".repeat(40),
        name: "",
        conclusion: "success",
        summary: "x",
      }),
    ).rejects.toThrow(/check name/);
  });

  it("posts status comments and validates its inputs", async () => {
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      if (url.endsWith("/repos/acme/app/issues/42/comments") && init?.method === "POST") {
        expect(JSON.parse(init?.body as string)).toEqual({ body: "hello" });
        return jsonResponse(201, {
          id: 99,
          html_url: "https://github.com/acme/app/pull/42#issuecomment-99",
        });
      }
      throw new Error(`unexpected request: ${init?.method} ${url}`);
    }) as typeof fetch;
    const provider = new GitHubProvider({ token: "ghp_test", repository: "acme/app", fetchImpl });
    await expect(provider.createIssueComment({ number: 42, body: "hello" })).resolves.toEqual({
      id: 99,
      htmlUrl: "https://github.com/acme/app/pull/42#issuecomment-99",
    });
    await expect(provider.createIssueComment({ number: -1, body: "x" })).rejects.toThrow(
      /positive PR number/,
    );
    await expect(provider.createIssueComment({ number: 42, body: "" })).rejects.toThrow(
      /requires a body/,
    );
  });

  it("returns the delivery tip SHA on creation for check-run reporting", async () => {
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      if (url.endsWith("/repos/acme/app")) return jsonResponse(200, { default_branch: "main" });
      if (url.includes("/pulls") && init?.method === "GET") return jsonResponse(200, []);
      if (url.includes("/git/ref/heads/main"))
        return jsonResponse(200, { object: { sha: "base-sha" } });
      if (url.endsWith("/git/refs")) return jsonResponse(201, {});
      if (url.includes("/git/ref/heads/patchbay%2Ftip")) {
        return jsonResponse(200, { object: { sha: "base-sha" } });
      }
      if (url.endsWith("/git/commits/base-sha")) {
        return jsonResponse(200, { sha: "base-sha", tree: { sha: "base-tree-sha" } });
      }
      if (url.endsWith("/git/blobs")) return jsonResponse(201, { sha: "blob-sha" });
      if (url.endsWith("/git/trees")) return jsonResponse(201, { sha: "new-tree-sha" });
      if (url.endsWith("/git/commits")) return jsonResponse(201, { sha: "tip-commit-sha" });
      if (url.includes("/git/refs/heads/patchbay%2Ftip") && init?.method === "PATCH") {
        return jsonResponse(200, {});
      }
      if (url.endsWith("/pulls") && init?.method === "POST") {
        return jsonResponse(201, { number: 43, html_url: "https://github.com/acme/app/pull/43" });
      }
      throw new Error(`unexpected request: ${init?.method} ${url}`);
    }) as typeof fetch;
    const provider = new GitHubProvider({ token: "ghp_test", repository: "acme/app", fetchImpl });
    const result = await provider.createDraftPullRequest({
      repositoryName: "app",
      fixtureDir: "",
      branchName: "patchbay/tip",
      title: "[Patch] Fix",
      body: "Automated.",
      patches: PATCHES,
    });
    expect(result.headSha).toBe("tip-commit-sha");
    expect(result.externalId).toBe("43");
  });
});
