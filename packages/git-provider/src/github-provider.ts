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
import { assertSafeSha, gitAuthEnv, runGit } from "./git-safe";

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

interface GitHubCommit {
  sha: string;
  tree: { sha: string };
}

interface GitHubBlob {
  sha: string;
}

interface GitHubPullRequest {
  number: number;
  html_url: string;
}

const DEFAULT_API_URL = "https://api.github.com";

/**
 * Real GitHub provider: creates a branch off the base branch, commits every
 * patch as ONE commit through the Git Database API, opens a draft pull
 * request, and checks out repositories at exact commit SHAs into disposable
 * workspaces.
 *
 * Commit signing: the single commit is created without an explicit
 * author/committer, so when the token is a GitHub App installation token
 * GitHub attributes it to the App bot and cryptographically signs it
 * (green "Verified" badge). This also satisfies "require signed commits"
 * branch protection. One commit per PR keeps history clean and halves API
 * calls versus per-file Contents API writes.
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

    // Fail closed on empty changesets: an empty tree produces a no-op commit
    // that still opens a PR. Refuse instead of shipping nothing.
    if (input.patches.length === 0) {
      throw new Error(
        "createDraftPullRequest requires at least one patch; refusing an empty commit",
      );
    }

    const base = this.config.baseBranch ?? (await this.defaultBranch(owner, repo));

    // Idempotency: if a PR already exists for this deterministic branch, return it immediately
    const existing = await this.findExistingPullRequest(owner, repo, input.branchName);
    if (existing) {
      return {
        provider: RepositoryProvider.GITHUB,
        branchName: input.branchName,
        url: existing.html_url,
        externalId: String(existing.number),
        title: input.title,
        body: input.body,
        status: PullRequestStatus.DRAFT,
      };
    }

    await this.createBranch(owner, repo, input.branchName, base);
    await this.applyPatches(owner, repo, input.branchName, input.title, input.patches);
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
   * PAT) is never persisted and never appears in argv or the remote URL: it is
   * injected per-invocation through GIT_CONFIG_* environment variables and
   * redacted from any error message before it is rethrown.
   */
  async checkout(input: CheckoutInput): Promise<CheckoutResult> {
    if (!input.sha) {
      throw new Error("GitHubProvider.checkout requires an exact commit sha");
    }
    const owner = this.config.repository.split("/")[0]!;
    const repo = this.config.repository.split("/")[1]!;
    const sha = assertSafeSha(input.sha);
    if (input.repositoryFullName && input.repositoryFullName !== this.config.repository) {
      throw new Error(
        `GitHubProvider.checkout target ${input.repositoryFullName} does not match configured repository ${this.config.repository}`,
      );
    }
    const baseBranch = input.baseBranch ?? (await this.defaultBranch(owner, repo));

    const workspace = mkdtempSync(path.join(tmpdir(), `patchbay-checkout-`));
    try {
      const authEnv = gitAuthEnv(this.config.token);
      runGit(["init"], { cwd: workspace });
      runGit(["remote", "add", "origin", `https://github.com/${owner}/${repo}.git`], {
        cwd: workspace,
      });
      runGit(["fetch", "--depth", "1", "origin", sha], { cwd: workspace, env: authEnv });

      // Fetching a raw SHA does not create a remote-tracking ref; verify via
      // FETCH_HEAD (which git populates with the fetched commit) instead.
      const fetched = runGit(["rev-parse", "FETCH_HEAD"], {
        cwd: workspace,
        capture: true,
      });
      if (fetched !== sha) {
        throw new Error(
          `checkout SHA mismatch: expected ${sha}, got ${fetched}. The SHA may not exist or may not be reachable from this repository.`,
        );
      }

      runGit(["checkout", "--detach", sha], { cwd: workspace });
      runGit(["config", "core.hooksPath", "/dev/null"], { cwd: workspace });

      const treeHash = runGit(["write-tree"], { cwd: workspace, capture: true }) ?? "";
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
    try {
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
    } catch (error) {
      // Idempotency: if reference already exists on retry, proceed safely
      if (error instanceof Error && error.message.includes("Reference already exists")) {
        return;
      }
      throw error;
    }
  }

  /**
   * Commits every patch as a single commit via the Git Database API
   * (blobs → tree → commit → ref update). No explicit author/committer is
   * sent: with a GitHub App installation token GitHub signs the commit as the
   * App bot (Verified badge). The ref update is never forced — if the branch
   * tip moved unexpectedly the call fails loudly instead of clobbering work.
   */
  private async applyPatches(
    owner: string,
    repo: string,
    branchName: string,
    message: string,
    patches: Array<{ filePath: string; patchedContent: string }>,
  ): Promise<void> {
    const filePaths = patches.map((patch) => {
      const filePath = patch.filePath.replace(/^\/+/, "");
      if (filePath.split("/").includes("..") || path.isAbsolute(patch.filePath)) {
        throw new Error(`patch file path escapes the repository: ${patch.filePath}`);
      }
      return filePath;
    });

    const branchRef = await this.request<GitHubRef>(
      `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branchName)}`,
      { method: "GET" },
    );
    const tipCommit = await this.request<GitHubCommit>(
      `/repos/${owner}/${repo}/git/commits/${branchRef.object.sha}`,
      { method: "GET" },
    );

    const treeEntries: Array<{ path: string; mode: "100644"; type: "blob"; sha: string }> = [];
    for (let i = 0; i < patches.length; i += 1) {
      const blob = await this.request<GitHubBlob>(`/repos/${owner}/${repo}/git/blobs`, {
        method: "POST",
        body: JSON.stringify({
          content: Buffer.from(patches[i]!.patchedContent, "utf8").toString("base64"),
          encoding: "base64",
        }),
      });
      treeEntries.push({ path: filePaths[i]!, mode: "100644", type: "blob", sha: blob.sha });
    }

    const tree = await this.request<{ sha: string }>(`/repos/${owner}/${repo}/git/trees`, {
      method: "POST",
      body: JSON.stringify({ base_tree: tipCommit.tree.sha, tree: treeEntries }),
    });
    const commit = await this.request<GitHubCommit>(`/repos/${owner}/${repo}/git/commits`, {
      method: "POST",
      body: JSON.stringify({
        message,
        tree: tree.sha,
        parents: [branchRef.object.sha],
      }),
    });
    await this.request(`/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branchName)}`, {
      method: "PATCH",
      body: JSON.stringify({ sha: commit.sha }),
    });
  }

  private async openDraftPR(
    owner: string,
    repo: string,
    base: string,
    input: CreateDraftPRInput,
  ): Promise<GitHubPullRequest> {
    try {
      return await this.request<GitHubPullRequest>(`/repos/${owner}/${repo}/pulls`, {
        method: "POST",
        body: JSON.stringify({
          title: input.title,
          body: input.body,
          head: input.branchName,
          base,
          draft: true,
        }),
      });
    } catch (error) {
      // Idempotency: if a pull request already exists for this branch, query and return it
      if (error instanceof Error && error.message.includes("A pull request already exists")) {
        const existing = await this.findExistingPullRequest(owner, repo, input.branchName);
        if (existing) {
          return existing;
        }
      }
      throw error;
    }
  }

  async findExistingPullRequest(
    owner: string,
    repo: string,
    branchName: string,
  ): Promise<GitHubPullRequest | null> {
    try {
      const headQuery = `${owner}:${branchName}`;
      const pulls = await this.request<GitHubPullRequest[]>(
        `/repos/${owner}/${repo}/pulls?head=${encodeURIComponent(headQuery)}&state=all`,
        { method: "GET", allowNotFound: true },
      );
      if (Array.isArray(pulls) && pulls.length > 0 && pulls[0]) {
        return pulls[0];
      }
      return null;
    } catch {
      return null;
    }
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
 * are set, Patch opens real draft PRs; otherwise it falls back to the local
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
  if (target) {
    // A per-repository target (create-pr / run-validation) MUST NOT silently
    // fall back to a single global PAT repository: every org's PRs would land
    // on the wrong repo. Fail loudly instead.
    throw new Error(
      `GitHub App is not configured, so no provider can serve installation ` +
        `${target.installationId} for ${target.repositoryFullName}; refusing the global PAT fallback`,
    );
  }
  if (token && repository) {
    return new GitHubProvider({ token, repository });
  }
  return new LocalGitProvider();
}
