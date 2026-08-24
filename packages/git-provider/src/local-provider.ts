import { createHash } from "node:crypto";
import {
  mkdtempSync,
  cpSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { RepositoryProvider, PullRequestStatus } from "@patchbay/domain";
import { assertSafeRepoFullName, assertSafeSha, runGit } from "./git-safe";

/** Resolves `filePath` inside `workspaceAbs`, rejecting absolute paths and traversal. */
export function resolveInsideWorkspace(workspaceAbs: string, filePath: string): string {
  const target = path.resolve(workspaceAbs, filePath);
  if (target !== workspaceAbs && !target.startsWith(workspaceAbs + path.sep)) {
    throw new Error(`patch file path escapes the workspace: ${filePath}`);
  }
  return target;
}

export interface CreateBranchInput {
  repositoryDir: string;
  branchName: string;
}

export interface ApplyPatchInput {
  workspaceDir: string;
  patches: Array<{ filePath: string; patchedContent: string }>;
}

export interface CreateDraftPRInput {
  repositoryName: string;
  fixtureDir: string;
  branchName: string;
  title: string;
  body: string;
  patches: Array<{ filePath: string; patchedContent: string }>;
}

export interface PullRequestResult {
  provider: RepositoryProvider;
  branchName: string;
  url: string;
  title: string;
  body: string;
  status: PullRequestStatus;
  localWorkspaceDir?: string;
  /** Provider-side identifier, e.g. the GitHub PR number. */
  externalId?: string;
}

export interface GitProvider {
  createDraftPullRequest(input: CreateDraftPRInput): Promise<PullRequestResult>;
  /**
   * Checks out a repository at an exact commit SHA to a disposable workspace.
   * The caller is responsible for cleanup. Token is never persisted; workspace is
   * always removed on success, failure, cancellation, or stale job recovery.
   */
  checkout(input: CheckoutInput): Promise<CheckoutResult>;
  /**
   * Resolves the HEAD commit SHA of a branch through the provider API, so
   * callers never take a commit sha from tenant-writable metadata.
   */
  resolveHeadSha(baseBranch?: string): Promise<string>;
}

export interface CheckoutInput {
  /** Local fixture directory for offline/demo mode (LocalGitProvider only). */
  repositoryDir?: string;
  /** Organization or owner name */
  organization?: string;
  /** Repository full name in "owner/name" form */
  repositoryFullName?: string;
  /** GitHub App installation ID (short-lived token obtained inside the worker) */
  installationId?: number;
  /** Exact commit SHA to checkout (not a branch reference). Required for real checkouts. */
  sha?: string;
  /** Optional base branch for context; defaults to the repository default branch. */
  baseBranch?: string;
  /** Fixture mode: only enabled when explicitly activated via environment flag.
   *  Prevents fixture mode in production by default. */
  fixtureMode?: boolean;
}

export interface CheckoutResult {
  /** Disposable workspace directory (must be cleaned by the caller) */
  workspaceDir: string;
  /** Base branch the repository belongs to */
  baseBranch: string;
  /** SHA of the tree at the checked-out commit */
  treeHash: string;
  /** Optional source archive/hash if the checkout came from a packaged artifact */
  sourceHash: string | null;
  /** True when the checkout was recorded for graph snapshot provenance */
  snapshotRecorded: boolean;
}

/**
 * Local (mock) GitProvider for offline demos and local workspace validation.
 * Copies the repository fixture to a temp directory, applies patches over a new branch context,
 * and generates a mock pull request record.
 */
export class LocalGitProvider implements GitProvider {
  async createDraftPullRequest(input: CreateDraftPRInput): Promise<PullRequestResult> {
    const { repositoryName, fixtureDir, branchName, title, body, patches } = input;

    const workspace = mkdtempSync(path.join(tmpdir(), `patchbay-pr-${repositoryName}-`));
    const workspaceAbs = path.resolve(workspace);

    try {
      cpSync(fixtureDir, workspace, {
        recursive: true,
        filter: (source) => !source.includes("node_modules"),
      });

      for (const patch of patches) {
        const target = resolveInsideWorkspace(workspaceAbs, patch.filePath);
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, patch.patchedContent, "utf8");
      }

      const mockUrl = `file:///${workspace.replace(/\\/g, "/")}`;

      return {
        provider: RepositoryProvider.LOCAL,
        branchName,
        url: mockUrl,
        title,
        body,
        status: PullRequestStatus.DRAFT,
        localWorkspaceDir: workspace,
      };
    } catch (error) {
      try {
        rmSync(workspace, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors on failure
      }
      throw error;
    }
  }

  /**
   * The local provider has no remote to resolve a HEAD from: fixture-mode
   * checkouts always carry an explicit sha, and the demo copy path uses the
   * workspace as-is. Never called on the validation path (github-only).
   */
  async resolveHeadSha(_baseBranch?: string): Promise<string> {
    throw new Error("LocalGitProvider cannot resolve a remote HEAD sha");
  }

  async checkout(input: CheckoutInput): Promise<CheckoutResult> {
    const { repositoryDir, baseBranch = "main", fixtureMode = false } = input;

    if (repositoryDir) {
      // Offline demo path: copy the fixture to a disposable workspace.
      const workspace = mkdtempSync(path.join(tmpdir(), `patchbay-checkout-`));
      try {
        cpSync(repositoryDir, workspace, {
          recursive: true,
          filter: (source) => !source.includes("node_modules"),
        });
        const { treeHash, sourceHash } = hashTree(workspace);
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
        throw error;
      }
    }

    // Fixture mode: only allowed when explicitly activated; prevent in production
    if (!fixtureMode) {
      throw new Error("Fixture mode is not allowed; use the GitHub App checkout path");
    }

    const { repositoryFullName, installationId, sha } = input;
    if (!sha) {
      throw new Error("LocalGitProvider.checkout requires an exact commit sha in fixture mode");
    }
    const safeSha = assertSafeSha(sha);
    if (!repositoryFullName) {
      throw new Error("LocalGitProvider.checkout requires a repository full name in fixture mode");
    }
    assertSafeRepoFullName(repositoryFullName);

    const workspace = mkdtempSync(path.join(tmpdir(), `patchbay-checkout-`));
    try {
      runGit(
        [
          "clone",
          "--depth",
          "1",
          `https://x-access-token:${installationId ?? 0}@github.com/${repositoryFullName}.git`,
          workspace,
        ],
        { cwd: workspace },
      );
      runGit(["checkout", "--no-detach", safeSha], { cwd: workspace });
      const headSha = runGit(["rev-parse", "HEAD"], { cwd: workspace, capture: true }) ?? "";
      if (headSha !== safeSha) {
        throw new Error(
          `Local fixture checkout HEAD ${headSha} does not match expected SHA ${safeSha}`,
        );
      }
      const treeHash = runGit(["write-tree"], { cwd: workspace, capture: true }) ?? "";
      const sourceHash = createHash("sha256")
        .update(`${safeSha}:${treeHash}`)
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
      throw error;
    }
  }
}

/**
 * Deterministic content hash over a directory tree: relative path + NUL + file
 * content for every file, excluding node_modules and .git.
 */
function hashTree(root: string): { treeHash: string; sourceHash: string } {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        walk(full);
      } else {
        files.push(path.relative(root, full));
      }
    }
  };
  walk(root);
  files.sort();
  const digest = createHash("sha256");
  for (const relative of files) {
    digest.update(relative);
    digest.update("\0");
    digest.update(readFileSync(path.join(root, relative)));
    digest.update("\0");
  }
  const treeHash = digest.digest("hex").slice(0, 16);
  const sourceHash = createHash("sha256").update(treeHash).digest("hex").slice(0, 16);
  return { treeHash, sourceHash };
}

export const localGitProvider = new LocalGitProvider();
