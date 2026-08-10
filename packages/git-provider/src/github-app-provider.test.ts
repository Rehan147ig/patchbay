import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { EnvSecretStore, type SecretStore } from "@patchbay/env";
import {
  GitHubAppProvider,
  createAppJwt,
  createGitHubAppProviderFromEnv,
  createGitHubAppProviderFromStore,
  fetchGitHubInstallationInfo,
  fetchGitHubInstallationInfoFromStore,
  getGitHubAppCredentials,
  isGitHubAppConfigured,
  redactGitHubSecrets,
} from "./github-app-provider";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PRIVATE_KEY_PEM = privateKey.export({ format: "pem", type: "pkcs1" }).toString();

function appStore(extra: Record<string, string> = {}): SecretStore {
  return new EnvSecretStore({
    source: {
      GITHUB_APP_ID: "12345",
      GITHUB_APP_PRIVATE_KEY: Buffer.from(PRIVATE_KEY_PEM, "utf8").toString("base64"),
      ...extra,
    },
  });
}

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
    // 10-minute TTL is the GitHub hard maximum.
    expect((payload.exp as number) - (payload.iat as number)).toBe(600);
  });
});

describe("redactGitHubSecrets", () => {
  it("masks PEM private keys, JWTs, and long base64 blobs", () => {
    const jwt = createAppJwt("12345", PRIVATE_KEY_PEM);
    const base64Key = Buffer.from(PRIVATE_KEY_PEM, "utf8").toString("base64");
    const input = `jwt=${jwt} key=${PRIVATE_KEY_PEM} env=${base64Key} keep=${"x".repeat(20)}`;
    const redacted = redactGitHubSecrets(input);
    expect(redacted).toContain("[REDACTED JWT]");
    expect(redacted).toContain("[REDACTED PRIVATE KEY]");
    expect(redacted).toContain("[REDACTED BASE64 SECRET]");
    expect(redacted).not.toContain("BEGIN RSA PRIVATE KEY");
    expect(redacted).toContain(`keep=${"x".repeat(20)}`);
  });

  it("leaves ordinary error text untouched", () => {
    expect(redactGitHubSecrets("GitHub API GET /repos/a/b failed: 404 Not Found")).toContain(
      "404 Not Found",
    );
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

  it("caches the installation token across calls within its TTL", async () => {
    let tokenExchanges = 0;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      if (url.endsWith("/app/installations/777/access_tokens")) {
        tokenExchanges += 1;
        return jsonResponse(201, { token: "inst-token", expires_at: "2030-01-01T00:00:00Z" });
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
        return jsonResponse(201, { number: 1, html_url: "https://github.com/acme/app/pull/1" });
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
    const input = {
      repositoryName: "app",
      fixtureDir: "",
      branchName: "patchbay/fix-1",
      title: "[Patchbay] Fix",
      body: "Automated.",
      patches: [{ filePath: "src/app.ts", patchedContent: "// patched" }],
    };
    await provider.createDraftPullRequest(input);
    await provider.createDraftPullRequest(input);
    expect(tokenExchanges).toBe(1);
  });

  it("invalidates the cached token and retries once after a 401", async () => {
    let tokenExchanges = 0;
    let pullRequests = 0;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      if (url.endsWith("/app/installations/777/access_tokens")) {
        tokenExchanges += 1;
        return jsonResponse(201, {
          token: `inst-token-${tokenExchanges}`,
          expires_at: "2030-01-01T00:00:00Z",
        });
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
        pullRequests += 1;
        if (pullRequests === 1) {
          return jsonResponse(401, { message: "Bad credentials" });
        }
        return jsonResponse(201, {
          number: 2,
          html_url: "https://github.com/acme/app/pull/2",
        });
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
    expect(result.status).toBe("DRAFT");
    expect(pullRequests).toBe(2);
    expect(tokenExchanges).toBe(2); // fresh token minted for the retry
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

describe("getGitHubAppCredentials", () => {
  it("returns credentials when both parts exist", async () => {
    const credentials = await getGitHubAppCredentials(appStore());
    expect(credentials?.appId).toBe("12345");
    expect(Buffer.from(credentials?.privateKey ?? "", "base64").toString("utf8")).toContain(
      "BEGIN",
    );
  });

  it("returns null when either part is missing", async () => {
    expect(await getGitHubAppCredentials(new EnvSecretStore({ source: {} }))).toBeNull();
    expect(
      await getGitHubAppCredentials(new EnvSecretStore({ source: { GITHUB_APP_ID: "1" } })),
    ).toBeNull();
  });
});

describe("createGitHubAppProviderFromStore", () => {
  it("decodes the base64 private key and builds a provider", async () => {
    const provider = await createGitHubAppProviderFromStore(
      { installationId: 777, repositoryFullName: "acme/app" },
      appStore(),
    );
    expect(provider).toBeInstanceOf(GitHubAppProvider);
  });

  it("throws a clear error without leaking values when unconfigured", async () => {
    await expect(
      createGitHubAppProviderFromStore(
        { installationId: 777, repositoryFullName: "acme/app" },
        new EnvSecretStore({ source: { GITHUB_APP_PRIVATE_KEY: "supersecret" } }),
      ),
    ).rejects.toThrow("GitHub App is not configured");
  });
});

describe("fetchGitHubInstallationInfoFromStore", () => {
  it("fetches installation metadata with an App JWT from the store", async () => {
    const authorizations: string[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      expect(url).toContain("/app/installations/777");
      const headers = (init?.headers ?? {}) as Record<string, string>;
      authorizations.push(headers.Authorization ?? "");
      return jsonResponse(200, {
        id: 777,
        account: { login: "acme", type: "Organization" },
        repository_selection: "all",
        permissions: { pull_requests: "write" },
        suspended_at: null,
      });
    }) as typeof fetch;

    const info = await fetchGitHubInstallationInfoFromStore(777, appStore(), fetchImpl);
    expect(info.accountLogin).toBe("acme");
    expect(info.repositorySelection).toBe("all");
    expect(authorizations[0]?.startsWith("Bearer ")).toBe(true);
  });

  it("rejects when the store has no App credentials", async () => {
    await expect(
      fetchGitHubInstallationInfoFromStore(777, new EnvSecretStore({ source: {} })),
    ).rejects.toThrow("GitHub App is not configured");
  });

  it("uses the store-provided API URL", async () => {
    const fetchImpl = (async (url: string) => {
      expect(url.startsWith("https://github.enterprise.local")).toBe(true);
      return jsonResponse(200, {
        id: 1,
        account: { login: "x", type: "User" },
        repository_selection: "selected",
        permissions: {},
        suspended_at: null,
      });
    }) as typeof fetch;
    await fetchGitHubInstallationInfoFromStore(
      1,
      appStore({ GITHUB_API_URL: "https://github.enterprise.local/" }),
      fetchImpl,
    );
  });

  it("mirrors the env-based path for equivalent inputs", async () => {
    const env = {
      GITHUB_APP_ID: "12345",
      GITHUB_APP_PRIVATE_KEY: Buffer.from(PRIVATE_KEY_PEM, "utf8").toString("base64"),
    } as NodeJS.ProcessEnv;
    const envInfo = await fetchGitHubInstallationInfo(1, env, async () =>
      jsonResponse(200, {
        id: 1,
        account: { login: "y", type: "User" },
        repository_selection: "selected",
        permissions: {},
        suspended_at: null,
      }),
    );
    const storeInfo = await fetchGitHubInstallationInfoFromStore(1, appStore(), async () =>
      jsonResponse(200, {
        id: 1,
        account: { login: "y", type: "User" },
        repository_selection: "selected",
        permissions: {},
        suspended_at: null,
      }),
    );
    expect(storeInfo).toEqual(envInfo);
  });
});
