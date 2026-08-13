import { createHash } from "node:crypto";
import { mkdtempSync, cpSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { RepositoryProvider, PullRequestStatus } from "@patchbay/domain";
import {
  LocalGitProvider,
  type CreateDraftPRInput,
  type GitProvider,
  type PullRequestResult,
  type CheckoutInput,
  type CheckoutResult,
} from "./local-provider";
import { createGitHubAppProviderFromEnv, isGitHubAppConfigured } from "./github-app-provider";

export interface GitHubConfig {
  /** Personal access token with `repo` scope. */
  token: string;
  /** Target repository in `owner/name` form. */
  repository: string;
  /** Base branch to branch off. Defaults to the repository default branch. */
  baseBranch?: string;
  /** GitHub API base URL. Defaults to https://api.github.com. */
  apiUrl?: string;
  /** Injectable fetch for tests. */
  fetchImpl?: typeof fetch;
}

interface GitHubRepo {
  default_branch: string;
}

interface GitHubRef {
  object: { sha: string };
}

interface GitHubContent {
  sha: string;
}

interface GitHubPullRequest {
  number: number;
  html_url: string;
}

const DEFAULT_API_URL = "https://api.github.com";

/**
 * Real GitHub provider: creates a branch off the base branch, writes each patch
 * through the contents API, and opens a draft pull request.
 */
export class GitHubProvider implements GitProvider {
  private readonly config: GitHubConfig;
  private readonly fetchImpl: typeof fetch;
  private readonly apiUrl: string;

  constructor(config: GitHubConfig) {
    if (!config.token) {
      throw new Error("GitHubProvider requires a token");
    }
    if (!/^[\w.-]+\/[\w.-]+$/.test(config.repository)) {
      throw new Error(
        `GitHubProvider requires a repository in owner/name form, got: ${config.repository}`,
      );
    }
    this.config = config;
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch;
    this.apiUrl = (config.apiUrl ?? DEFAULT_API_URL).replace(/\/+$/, "");
  }

  async createDraftPullRequest(input: CreateDraftPRInput): Promise<PullRequestResult> {
    const owner = this.config.repository.split("/")[0]!;
    const repo = this.config.repository.split("/")[1]!;
    const base = this.config.baseBranch ?? (await this.defaultBranch(owner, repo));
    await this.createBranch(owner, repo, input.branchName, base);
    await this.applyPatches(owner, repo, input.branchName, input.patches);
    const pullRequest = await this.openDraftPR(owner, repo, base, input);

    return {
      provider: RepositoryProvider.GITHUB,
      branchName: input.branchName,
      url: pullRequest.html_url,
      externalId: String(pullRequest.number),
      title: input.title,
      body: input.body,
      status: PullRequestStatus.DRAFT,
    };
  }

  async checkout(input: CheckoutInput): Promise<CheckoutResult> {
    const owner = this.config.repository.split("/")[0]!;
    const repo = this.config.repository.split("/")[1]!;
    const baseBranch = input.baseBranch ?? (await this.defaultBranch(owner, repo));

    const baseRef = await this.request<{ object: { sha: string } }>(
      `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(baseBranch)}`,
      { method: "GET" },
    );
    const baseSha = baseRef.object.sha;

    const workspace = mkdtempSync(path.join(tmpdir(), `patchbay-checkout-`));
    try {
      // Shallow clone using git CLI (faster than API for full checkout)
      const { execSync } = await import("node:child_process");
      execSync(
        `git clone --depth 1 --branch ${baseBranch} https://x-access-token:${this.config.token}@github.com/${owner}/${repo}.git ${workspace}`,
        {
          stdio: "ignore",
        },
      );

      // Verify the checked out HEAD matches the expected SHA
      const headOutput = execSync(`git rev-parse HEAD`, {
        cwd: workspace,
        encoding: "utf8",
      }).trim();
      if (headOutput !== baseSha) {
        throw new Error(`checkout HEAD ${headOutput} does not match expected base SHA ${baseSha}`);
      }

      return { workspaceDir: workspace, baseBranch, baseSha };
    } catch (error) {
      try {
        rmSync(workspace, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
      throw error;
    }
  }

  private async defaultBranch(owner: string, repo: string): Promise<string> {
    const data = await this.request<GitHubRepo>(`/repos/${owner}/${repo}`, { method: "GET" });
    return data.default_branch;
  }

  private async createBranch(
    owner: string,
    repo: string,
    branchName: string,
    base: string,
  ): Promise<void> {
    const baseRef = await this.request<GitHubRef>(
      `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(base)}`,
      { method: "GET" },
    );
    await this.request(`/repos/${owner}/${repo}/git/refs`, {
      method: "POST",
      body: JSON.stringify({
        ref: `refs/heads/${branchName}`,
        sha: baseRef.object.sha,
      }),
    });
  }

  private async applyPatches(
    owner: string,
    repo: string,
    branchName: string,
    patches: Array<{ filePath: string; patchedContent: string }>,
  ): Promise<void> {
    for (const patch of patches) {
      const path = patch.filePath.replace(/^\/+/, "");
      const existing = await this.request<GitHubContent | null>(
        `/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branchName)}`,
        { method: "GET", allowNotFound: true },
      );
      await this.request(`/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`, {
        method: "PUT",
        body: JSON.stringify({
          message: `Apply Patchbay patch: ${path}`,
          content: Buffer.from(patch.patchedContent, "utf8").toString("base64"),
          branch: branchName,
          ...(existing ? { sha: existing.sha } : {}),
        }),
      });
    }
  }

  private async openDraftPR(
    owner: string,
    repo: string,
    base: string,
    input: CreateDraftPRInput,
  ): Promise<GitHubPullRequest> {
    return this.request<GitHubPullRequest>(`/repos/${owner}/${repo}/pulls`, {
      method: "POST",
      body: JSON.stringify({
        title: input.title,
        body: input.body,
        head: input.branchName,
        base,
        draft: true,
      }),
    });
  }

  private async request<T>(
    path: string,
    init: { method: string; body?: string; allowNotFound?: boolean },
  ): Promise<T> {
    const response = await this.fetchImpl(`${this.apiUrl}${path}`, {
      method: init.method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.config.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
      ...(init.body ? { body: init.body } : {}),
    });

    if (response.status === 404 && init.allowNotFound) {
      return null as T;
    }
    if (!response.ok) {
      const raw = await response.text().catch(() => "");
      let detail = raw;
      try {
        const parsed = JSON.parse(raw) as { message?: string };
        if (parsed.message) {
          detail = parsed.message;
        }
      } catch {
        // Non-JSON error body; use the raw text.
      }
      throw new Error(
        `GitHub API ${init.method} ${path} failed: ${response.status} ${detail || response.statusText}`,
      );
    }
    return (await response.json()) as T;
  }
}

/**
 * Environment-driven provider selection: when GITHUB_TOKEN and GITHUB_REPOSITORY
 * are set, Patchbay opens real draft PRs; otherwise it falls back to the local
 * workspace mock so the demo keeps working offline.
 */
type GitHubAppTarget = {
  installationId: number;
  repositoryFullName: string;
  baseBranch?: string;
};

export function createGitProviderFromEnv(env?: NodeJS.ProcessEnv): GitProvider;
export function createGitProviderFromEnv(
  target: GitHubAppTarget,
  env?: NodeJS.ProcessEnv,
): GitProvider;
export function createGitProviderFromEnv(
  targetOrEnv: GitHubAppTarget | NodeJS.ProcessEnv = process.env,
  providedEnv?: NodeJS.ProcessEnv,
): GitProvider {
  const target = "repositoryFullName" in targetOrEnv ? (targetOrEnv as GitHubAppTarget) : undefined;
  const env: NodeJS.ProcessEnv = target
    ? (providedEnv ?? process.env)
    : (targetOrEnv as NodeJS.ProcessEnv);
  if (target && isGitHubAppConfigured(env)) {
    return createGitHubAppProviderFromEnv(target, env);
  }
  const token = env.GITHUB_TOKEN;
  const repository = env.GITHUB_REPOSITORY;
  if (token && repository) {
    return new GitHubProvider({ token, repository });
  }
  return new LocalGitProvider();
}
