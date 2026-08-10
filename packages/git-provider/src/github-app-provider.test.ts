import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  GitHubAppProvider,
  createAppJwt,
  createGitHubAppProviderFromEnv,
  isGitHubAppConfigured,
} from "./github-app-provider";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PRIVATE_KEY_PEM = privateKey.export({ format: "pem", type: "pkcs1" }).toString();

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const parts = jwt.split(".");
  expect(parts).toHaveLength(3);
  return JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as Record<
    string,
    unknown
  >;
}

describe("createAppJwt", () => {
  it("mints an RS256 JWT with the app id and a 10 minute expiry", () => {
    const now = new Date("2026-08-09T12:00:00Z");
    const jwt = createAppJwt("12345", PRIVATE_KEY_PEM, now);
    const [header] = jwt.split(".");
    expect(JSON.parse(Buffer.from(header!, "base64url").toString("utf8"))).toEqual({
      alg: "RS256",
      typ: "JWT",
    });
    const payload = decodeJwtPayload(jwt);
    const nowSec = Math.floor(now.getTime() / 1000);
    expect(payload.iss).toBe("12345");
    expect(payload.iat).toBe(nowSec - 60);
    expect(payload.exp).toBe(nowSec - 60 + 600);
  });
});

describe("GitHubAppProvider", () => {
  it("exchanges a JWT for an installation token, then opens a draft PR", async () => {
    const authHeaders: string[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      if (headers.Authorization) authHeaders.push(headers.Authorization);
      if (url.endsWith("/app/installations/777/access_tokens")) {
        expect(init?.method).toBe("POST");
        return jsonResponse(201, { token: "inst-token", expires_at: "2026-08-09T13:00:00Z" });
      }
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
        return jsonResponse(404, { message: "Not Found" });
      }
      if (url.includes("/contents/") && init?.method === "PUT") {
        return jsonResponse(201, {});
      }
      if (url.endsWith("/pulls")) {
        return jsonResponse(201, { number: 7, html_url: "https://github.com/acme/app/pull/7" });
      }
      throw new Error(`unexpected request: ${init?.method} ${url}`);
    }) as typeof fetch;

    const provider = new GitHubAppProvider({
      appId: "12345",
      privateKey: PRIVATE_KEY_PEM,
      installationId: 777,
      repositoryFullName: "acme/app",
      fetchImpl,
    });

    const result = await provider.createDraftPullRequest({
      repositoryName: "app",
      fixtureDir: "",
      branchName: "patchbay/fix-1",
      title: "[Patchbay] Fix",
      body: "Automated.",
      patches: [{ filePath: "src/app.ts", patchedContent: "// patched" }],
    });

    expect(result).toMatchObject({
      provider: "GITHUB",
      url: "https://github.com/acme/app/pull/7",
      externalId: "7",
      status: "DRAFT",
    });
    // First call is the token exchange (App JWT), the rest use the installation token.
    expect(decodeJwtPayload(authHeaders[0]!.replace("Bearer ", "")).iss).toBe("12345");
    expect(authHeaders.slice(1).every((h) => h === "Bearer inst-token")).toBe(true);
  });

  it("fetches repository metadata through the installation token", async () => {
    const fetchImpl = (async (url: string) => {
      if (url.endsWith("/app/installations/777/access_tokens")) {
        return jsonResponse(201, { token: "inst-token" });
      }
      if (url.endsWith("/repos/acme/app")) {
        return jsonResponse(200, {
          id: 98765,
          name: "app",
          full_name: "acme/app",
          default_branch: "main",
          private: true,
        });
      }
      throw new Error(`unexpected request: ${url}`);
    }) as typeof fetch;

    const provider = new GitHubAppProvider({
      appId: "12345",
      privateKey: PRIVATE_KEY_PEM,
      installationId: 777,
      repositoryFullName: "acme/app",
      fetchImpl,
    });

    await expect(provider.fetchRepositoryInfo()).resolves.toEqual({
      externalId: "98765",
      name: "app",
      fullName: "acme/app",
      defaultBranch: "main",
      isPrivate: true,
    });
  });

  it("surfaces a clear error when the token exchange is rejected", async () => {
    const fetchImpl = (async () => jsonResponse(404, { message: "Not Found" })) as typeof fetch;

    const provider = new GitHubAppProvider({
      appId: "12345",
      privateKey: PRIVATE_KEY_PEM,
      installationId: 999,
      repositoryFullName: "acme/app",
      fetchImpl,
    });

    await expect(provider.fetchRepositoryInfo()).rejects.toThrow(
      "GitHub App token exchange failed for installation 999: 404",
    );
  });

  it("rejects invalid configuration", () => {
    const base = {
      appId: "1",
      privateKey: PRIVATE_KEY_PEM,
      installationId: 1,
      repositoryFullName: "acme/app",
    };
    expect(() => new GitHubAppProvider({ ...base, appId: "" })).toThrow("requires an appId");
    expect(() => new GitHubAppProvider({ ...base, privateKey: "" })).toThrow(
      "requires a privateKey",
    );
    expect(() => new GitHubAppProvider({ ...base, installationId: 0 })).toThrow("installationId");
    expect(() => new GitHubAppProvider({ ...base, repositoryFullName: "no-slash" })).toThrow(
      "owner/name form",
    );
  });
});

describe("createGitHubAppProviderFromEnv", () => {
  it("decodes the base64 private key and builds a provider", () => {
    const env = {
      GITHUB_APP_ID: "12345",
      GITHUB_APP_PRIVATE_KEY: Buffer.from(PRIVATE_KEY_PEM, "utf8").toString("base64"),
    } as NodeJS.ProcessEnv;
    const provider = createGitHubAppProviderFromEnv(
      { installationId: 777, repositoryFullName: "acme/app" },
      env,
    );
    expect(provider).toBeInstanceOf(GitHubAppProvider);
  });

  it("throws a clear error when the App is not configured", () => {
    expect(() =>
      createGitHubAppProviderFromEnv(
        { installationId: 777, repositoryFullName: "acme/app" },
        {} as NodeJS.ProcessEnv,
      ),
    ).toThrow("GitHub App is not configured");
  });
});

describe("isGitHubAppConfigured", () => {
  it("requires both the app id and private key", () => {
    expect(isGitHubAppConfigured({} as NodeJS.ProcessEnv)).toBe(false);
    expect(isGitHubAppConfigured({ GITHUB_APP_ID: "1" } as NodeJS.ProcessEnv)).toBe(false);
    expect(
      isGitHubAppConfigured({
        GITHUB_APP_ID: "1",
        GITHUB_APP_PRIVATE_KEY: "x",
      } as NodeJS.ProcessEnv),
    ).toBe(true);
  });
});
