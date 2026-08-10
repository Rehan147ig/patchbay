import { createSign } from "node:crypto";
import { GitHubProvider, type GitHubConfig } from "./github-provider";
import type { CreateDraftPRInput, GitProvider, PullRequestResult } from "./local-provider";

/**
 * GitHub App provider: authenticates as the App (RS256 JWT), exchanges for an
 * installation access token scoped to the customer's installation, then
 * delegates the branch/patch/PR flow to the PAT-based GitHubProvider, which
 * only needs a bearer token.
 *
 * No Octokit dependency: the App JWT is three base64url segments signed with
 * the App's PEM key, and the token exchange is a single POST.
 */
export interface GitHubAppConfig {
  /** GitHub App ID (from the App's settings page). */
  appId: string;
  /** PEM private key, already decoded (not base64). */
  privateKey: string;
  /** Installation to act as; determines which repositories are reachable. */
  installationId: number;
  /** Target repository in `owner/name` form (must be covered by the installation). */
  repositoryFullName: string;
  /** Base branch to branch off. Defaults to the repository default branch. */
  baseBranch?: string;
  /** GitHub API base URL. Defaults to https://api.github.com. */
  apiUrl?: string;
  /** Injectable fetch for tests. */
  fetchImpl?: typeof fetch;
}

export interface GitHubRepositoryInfo {
  externalId: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  isPrivate: boolean;
}

export interface GitHubInstallationInfo {
  id: number;
  accountLogin: string;
  accountType: string;
  repositorySelection: string;
  permissions: Record<string, string>;
  suspendedAt: string | null;
}

const DEFAULT_API_URL = "https://api.github.com";
const APP_JWT_TTL_SECONDS = 600; // GitHub accepts at most 10 minutes
const TOKEN_CACHE_TTL_MS = 50 * 60 * 1000; // installation tokens live 1h; refresh 10 min early

/**
 * Masks secret material that must never reach logs, audit events, or AI
 * prompts: PEM private keys, JWT signatures, and long base64 blobs (the
 * single-line base64 form of the App key used in env files).
 */
export function redactGitHubSecrets(value: string): string {
  return value
    .replace(
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
      "[REDACTED PRIVATE KEY]",
    )
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "[REDACTED JWT]")
    .replace(/[A-Za-z0-9+/]{500,}={0,2}/g, "[REDACTED BASE64 SECRET]");
}

/** Mints a GitHub App JWT: RS256 over { iss, iat, exp } with a 10-minute TTL. */
export function createAppJwt(appId: string, privateKeyPem: string, now = new Date()): string {
  const issuedAt = Math.floor(now.getTime() / 1000) - 60; // clock-skew allowance
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
    iss: appId,
    iat: issuedAt,
    exp: issuedAt + APP_JWT_TTL_SECONDS,
  })}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(privateKeyPem, "base64url");
  return `${unsigned}.${signature}`;
}

function isUnauthorized(error: unknown): boolean {
  return error instanceof Error && /failed: 401\b/.test(error.message);
}

export class GitHubAppProvider implements GitProvider {
  private readonly config: GitHubAppConfig;
  private readonly fetchImpl: typeof fetch;
  private readonly apiUrl: string;
  private readonly tokenCache = new Map<number, { token: string; expiresAt: number }>();

  constructor(config: GitHubAppConfig) {
    if (!config.appId) {
      throw new Error("GitHubAppProvider requires an appId");
    }
    if (!config.privateKey) {
      throw new Error("GitHubAppProvider requires a privateKey (PEM)");
    }
    if (!Number.isInteger(config.installationId) || config.installationId <= 0) {
      throw new Error("GitHubAppProvider requires a positive integer installationId");
    }
    if (!/^[\w.-]+\/[\w.-]+$/.test(config.repositoryFullName)) {
      throw new Error(
        `GitHubAppProvider requires repositoryFullName in owner/name form, got: ${config.repositoryFullName}`,
      );
    }
    this.config = config;
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch;
    this.apiUrl = (config.apiUrl ?? DEFAULT_API_URL).replace(/\/+$/, "");
  }

  async createDraftPullRequest(input: CreateDraftPRInput): Promise<PullRequestResult> {
    const token = await this.createInstallationToken();
    try {
      const delegate = new GitHubProvider(this.delegateConfig(token));
      return await delegate.createDraftPullRequest(input);
    } catch (error) {
      // A 401 usually means the installation token was revoked or expired
      // mid-flight: drop the cached token and retry once with a fresh one.
      if (isUnauthorized(error) && this.tokenCache.delete(this.config.installationId)) {
        const freshToken = await this.createInstallationToken();
        const delegate = new GitHubProvider(this.delegateConfig(freshToken));
        return delegate.createDraftPullRequest(input);
      }
      throw error;
    }
  }

  /**
   * Fetches repository metadata through an installation token. Used by the
   * "connect repository" endpoint to register real GitHub repos.
   */
  async fetchRepositoryInfo(): Promise<GitHubRepositoryInfo> {
    const token = await this.createInstallationToken();
    const [owner, repo] = this.config.repositoryFullName.split("/");
    const response = await this.fetchImpl(`${this.apiUrl}/repos/${owner}/${repo}`, {
      method: "GET",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!response.ok) {
      if (response.status === 401) this.tokenCache.delete(this.config.installationId);
      const detail = await response.text().catch(() => "");
      throw new Error(
        redactGitHubSecrets(
          `GitHub API GET /repos/${owner}/${repo} failed: ${response.status} ${detail || response.statusText}`,
        ),
      );
    }
    const data = (await response.json()) as {
      id: number;
      name: string;
      full_name: string;
      default_branch: string;
      private: boolean;
    };
    return {
      externalId: String(data.id),
      name: data.name,
      fullName: data.full_name,
      defaultBranch: data.default_branch,
      isPrivate: data.private,
    };
  }

  private delegateConfig(token: string): GitHubConfig {
    return {
      token,
      repository: this.config.repositoryFullName,
      ...(this.config.baseBranch ? { baseBranch: this.config.baseBranch } : {}),
      apiUrl: this.apiUrl,
      fetchImpl: this.fetchImpl,
    };
  }

  private async createInstallationToken(): Promise<string> {
    const cached = this.tokenCache.get(this.config.installationId);
    if (cached && cached.expiresAt > Date.now()) return cached.token;

    const jwt = createAppJwt(this.config.appId, this.config.privateKey);
    const url = `${this.apiUrl}/app/installations/${this.config.installationId}/access_tokens`;
    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${jwt}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        redactGitHubSecrets(
          `GitHub App token exchange failed for installation ${this.config.installationId}: ${response.status} ${detail || response.statusText}`,
        ),
      );
    }
    const data = (await response.json()) as { token?: string; expires_at?: string };
    if (!data.token) {
      throw new Error("GitHub App token exchange returned no token");
    }
    let ttlMs = TOKEN_CACHE_TTL_MS;
    if (data.expires_at) {
      const serverTtlMs = new Date(data.expires_at).getTime() - Date.now();
      if (Number.isFinite(serverTtlMs) && serverTtlMs > 0) {
        ttlMs = Math.min(ttlMs, serverTtlMs - 10 * 60 * 1000);
      }
    }
    this.tokenCache.set(this.config.installationId, {
      token: data.token,
      expiresAt: Date.now() + Math.max(ttlMs, 60_000),
    });
    return data.token;
  }
}

/** True when the GitHub App credentials needed for installation tokens exist. */
export function isGitHubAppConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY);
}

/** Fetches installation metadata using an App JWT before binding it to a tenant. */
export async function fetchGitHubInstallationInfo(
  installationId: number,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<GitHubInstallationInfo> {
  if (!isGitHubAppConfigured(env)) {
    throw new Error("GitHub App is not configured");
  }
  if (!Number.isSafeInteger(installationId) || installationId <= 0) {
    throw new Error("installationId must be a positive safe integer");
  }
  const apiUrl = (env.GITHUB_API_URL ?? DEFAULT_API_URL).replace(/\/+$/, "");
  const jwt = createAppJwt(
    env.GITHUB_APP_ID as string,
    Buffer.from(env.GITHUB_APP_PRIVATE_KEY as string, "base64").toString("utf8"),
  );
  const response = await fetchImpl(`${apiUrl}/app/installations/${installationId}`, {
    method: "GET",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${jwt}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub installation lookup failed: ${response.status}`);
  }
  const data = (await response.json()) as {
    id: number;
    account?: { login?: string; type?: string };
    repository_selection?: string;
    permissions?: Record<string, string>;
    suspended_at?: string | null;
  };
  if (!data.account?.login || !data.account.type) {
    throw new Error("GitHub installation lookup returned incomplete account data");
  }
  return {
    id: data.id,
    accountLogin: data.account.login,
    accountType: data.account.type,
    repositorySelection: data.repository_selection ?? "selected",
    permissions: data.permissions ?? {},
    suspendedAt: data.suspended_at ?? null,
  };
}

export interface GitHubAppTarget {
  installationId: number;
  repositoryFullName: string;
  baseBranch?: string;
}

/**
 * Builds an App provider from process env. GITHUB_APP_PRIVATE_KEY is stored
 * base64-encoded (PEM files contain newlines that env files cannot hold).
 * Throws when the App is not configured — guard with isGitHubAppConfigured().
 */
export function createGitHubAppProviderFromEnv(
  target: GitHubAppTarget,
  env: NodeJS.ProcessEnv = process.env,
): GitHubAppProvider {
  if (!isGitHubAppConfigured(env)) {
    throw new Error(
      "GitHub App is not configured: set GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY (base64 PEM)",
    );
  }
  const privateKey = Buffer.from(env.GITHUB_APP_PRIVATE_KEY as string, "base64").toString("utf8");
  return new GitHubAppProvider({
    appId: env.GITHUB_APP_ID as string,
    privateKey,
    installationId: target.installationId,
    repositoryFullName: target.repositoryFullName,
    ...(target.baseBranch ? { baseBranch: target.baseBranch } : {}),
    ...(env.GITHUB_API_URL ? { apiUrl: env.GITHUB_API_URL } : {}),
  });
}
