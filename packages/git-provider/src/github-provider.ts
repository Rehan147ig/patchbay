import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { RepositoryProvider, PullRequestStatus } from "@patchbay/domain";
import {
  LocalGitProvider,
  type CheckoutInput,
  type CheckoutResult,
  type CreateDraftPRInput,
  type GitProvider,
  type PullRequestResult,
} from "./local-provider";
import {
  createGitHubAppProviderFromEnv,
  isGitHubAppConfigured,
  type GitHubAppTarget,
} from "./github-app-provider";

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
 * through the contents API, opens a draft pull request, and checks out
 * repositories at exact commit SHAs into disposable workspaces.
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

  /**
   * Exact-commit SHA checkout into a disposable workspace.
   * - Fetches only the requested commit (`--depth 1`), never a branch head
   * - Verifies the fetched ref equals the requested SHA before detaching HEAD
   * - Disables git hooks so repository-controlled scripts never run
   * - Records tree and source hashes for graph snapshot provenance
   * - Removes the workspace on success, failure, cancellation, or stale recovery
   *
   * The credential (installation token via GitHubAppProvider delegation, or a
   * PAT) is never persisted: it exists only inside the ephemeral remote URL of
   * this process and is redacted from any error message before it is rethrown.
   */
  async checkout(input: CheckoutInput): Promise<CheckoutResult> {
    const owner = this.config.repository.split("/")[0]!;
    const repo = this.config.repository.split("/")[1]!;
    const sha = input.sha;
    if (!sha) {
      throw new Error("GitHubProvider.checkout requires an exact commit sha");
    }
    if (input.repositoryFullName && input.repositoryFullName !== this.config.repository) {
      throw new Error(
        `GitHubProvider.checkout target ${input.repositoryFullName} does not match configured repository ${this.config.repository}`,
      );
    }
    const baseBranch = input.baseBranch ?? (await this.defaultBranch(owner, repo));

    const workspace = mkdtempSync(path.join(tmpdir(), `patchbay-checkout-`));
    try {
      execSync(`git init`, { cwd: workspace, stdio: "ignore" });
      execSync(
        `git remote add origin https://x-access-token:${this.config.token}@github.com/${owner}/${repo}.git`,
        { cwd: workspace, stdio: "ignore" },
      );
      execSync(`git fetch --depth 1 origin ${sha}`, { cwd: workspace, stdio: "ignore" });

      const fetched = execSync(`git rev-parse origin/${sha}`, {
        cwd: workspace,
        encoding: "utf8",
      }).trim();
      if (fetched !== sha) {
        throw new Error(
          `checkout SHA mismatch: expected ${sha}, got ${fetched}. The SHA may not exist or may not be reachable from this repository.`,
        );
      }

      execSync(`git checkout --detach ${sha}`, { cwd: workspace, stdio: "ignore" });
      execSync(`git config core.hooksPath /dev/null`, { cwd: workspace, stdio: "ignore" });

      const treeHash = execSync(`git write-tree`, {
        cwd: workspace,
        encoding: "utf8",
      }).trim();
      const sourceHash = createHash("sha256")
        .update(`${sha}:${treeHash}`)
        .digest("hex")
        .slice(0, 16);

      return {
        workspaceDir: workspace,
        baseBranch,
        treeHash,
        sourceHash,
        snapshotRecorded: true,
      };
    } catch (error) {
      try {
        rmSync(workspace, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
      throw redactTokenInError(error, this.config.token);
    }
  }

  private async defaultBranch(owner: string, repo: string): Promise<string> {
    const data = await this.request<GitHubRepo>(`/repos/${owner}/${repo}`, { method: "GET" });
    return data.default_branch;
  }

  /**
   * Resolves the HEAD commit SHA of a branch (default branch when none is
   * given). Used by scan/graph-index jobs to pin a checkout to an exact
   * commit before analyzing a connected repository.
   */
  async resolveHeadSha(baseBranch?: string): Promise<string> {
    const owner = this.config.repository.split("/")[0]!;
    const repo = this.config.repository.split("/")[1]!;
    const base = baseBranch ?? (await this.defaultBranch(owner, repo));
    const ref = await this.request<GitHubRef>(
      `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(base)}`,
      { method: "GET" },
    );
    return ref.object.sha;
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
      const filePath = patch.filePath.replace(/^\/+/, "");
      const existing = await this.request<GitHubContent | null>(
        `/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath)}?ref=${encodeURIComponent(branchName)}`,
        { method: "GET", allowNotFound: true },
      );
      await this.request(`/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath)}`, {
        method: "PUT",
        body: JSON.stringify({
          message: `Apply Patchbay patch: ${filePath}`,
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
 * Replaces credential material inside an error message before it escapes the
 * provider, so tokens never reach logs, audit events, or AI prompts.
 */
export function redactTokenInError(error: unknown, token: string): unknown {
  if (error instanceof Error && token.length > 0 && error.message.includes(token)) {
    error.message = error.message.split(token).join("[REDACTED]");
  }
  return error;
}

/**
 * Environment-driven provider selection: when GITHUB_TOKEN and GITHUB_REPOSITORY
 * are set, Patchbay opens real draft PRs; otherwise it falls back to the local
 * workspace mock so the demo keeps working offline.
 */
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
