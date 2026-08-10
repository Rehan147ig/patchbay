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

/** Mints a GitHub App JWT: RS256 over { iss: appId, iat: now-60s, exp: now+10m }. */
export function createAppJwt(appId: string, privateKeyPem: string, now = new Date()): string {
  const issuedAt = Math.floor(now.getTime() / 1000) - 60; // clock-skew allowance
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
    iss: appId,
    iat: issuedAt,
    exp: issuedAt + 600,
  })}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(privateKeyPem, "base64url");
  return `${unsigned}.${signature}`;
}

export class GitHubAppProvider implements GitProvider {
  private readonly config: GitHubAppConfig;
  private readonly fetchImpl: typeof fetch;
  private readonly apiUrl: string;

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
    const delegate = new GitHubProvider(this.delegateConfig(token));
    return delegate.createDraftPullRequest(input);
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
      const detail = await response.text().catch(() => "");
      throw new Error(
        `GitHub API GET /repos/${owner}/${repo} failed: ${response.status} ${detail || response.statusText}`,
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
        `GitHub App token exchange failed for installation ${this.config.installationId}: ${response.status} ${detail || response.statusText}`,
      );
    }
    const data = (await response.json()) as { token?: string };
    if (!data.token) {
      throw new Error("GitHub App token exchange returned no token");
    }
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
