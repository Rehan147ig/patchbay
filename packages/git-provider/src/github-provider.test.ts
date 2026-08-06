import { describe, expect, it } from "vitest";
import { GitHubProvider, createGitProviderFromEnv } from "./github-provider";
import { LocalGitProvider } from "./index";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const PATCHES = [{ filePath: "src/chat/chat-service.ts", patchedContent: "// patched" }];

describe("GitHubProvider", () => {
  it("creates a draft PR via the GitHub API with branch + patch writes", async () => {
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const call = { url, method: init?.method ?? "GET", body: init?.body as string | undefined };
      calls.push(call);

      if (url.endsWith("/repos/acme/app")) {
        return jsonResponse(200, { default_branch: "main" });
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
      if (url.includes("/contents/") && init?.method === "GET") {
        return jsonResponse(404, { message: "Not Found" });
      }
      if (url.includes("/contents/") && init?.method === "PUT") {
        const body = JSON.parse(init?.body as string);
        expect(body.branch).toBe("patchbay/fix-1");
        expect(body.sha).toBeUndefined();
        expect(body.content).toBe(Buffer.from("// patched", "utf8").toString("base64"));
        return jsonResponse(201, { content: { sha: "file-sha" } });
      }
      if (url.endsWith("/pulls")) {
        const body = JSON.parse(init?.body as string);
        expect(body).toMatchObject({
          title: "[Patchbay] Fix",
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
      title: "[Patchbay] Fix",
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
    expect(calls).toHaveLength(6);
    expect(calls.every((c) => c.url.startsWith("https://api.github.com"))).toBe(true);
  });

  it("reuses an existing file sha when the target file already exists on the branch", async () => {
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      if (url.endsWith("/repos/acme/app")) {
        return jsonResponse(200, { default_branch: "main" });
      }
      if (url.includes("/git/ref/heads/main")) {
        return jsonResponse(200, { object: { sha: "base-sha" } });
      }
      if (url.endsWith("/git/refs")) {
        return jsonResponse(201, {});
      }
      if (url.includes("/contents/") && init?.method === "GET") {
        return jsonResponse(200, { sha: "existing-file-sha" });
      }
      if (url.includes("/contents/") && init?.method === "PUT") {
        const body = JSON.parse(init?.body as string);
        expect(body.sha).toBe("existing-file-sha");
        return jsonResponse(201, {});
      }
      if (url.endsWith("/pulls")) {
        return jsonResponse(201, { number: 1, html_url: "https://github.com/acme/app/pull/1" });
      }
      throw new Error(`unexpected request: ${init?.method} ${url}`);
    }) as typeof fetch;

    const provider = new GitHubProvider({
      token: "ghp_test",
      repository: "acme/app",
      fetchImpl,
    });

    await provider.createDraftPullRequest({
      repositoryName: "app",
      fixtureDir: "",
      branchName: "patchbay/fix-1",
      title: "Fix",
      body: "body",
      patches: PATCHES,
    });
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
});

describe("createGitProviderFromEnv", () => {
  it("returns a GitHub provider when credentials are configured", () => {
    const provider = createGitProviderFromEnv({
      GITHUB_TOKEN: "ghp_x",
      GITHUB_REPOSITORY: "acme/app",
    } as NodeJS.ProcessEnv);
    expect(provider).toBeInstanceOf(GitHubProvider);
  });

  it("falls back to the local provider without credentials", () => {
    const provider = createGitProviderFromEnv({} as NodeJS.ProcessEnv);
    expect(provider).toBeInstanceOf(LocalGitProvider);
  });
});
