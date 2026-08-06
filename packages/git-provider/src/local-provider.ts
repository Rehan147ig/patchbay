import { mkdtempSync, cpSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { RepositoryProvider, PullRequestStatus } from "@patchbay/domain";

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

    try {
      cpSync(fixtureDir, workspace, {
        recursive: true,
        filter: (source) => !source.includes("node_modules"),
      });

      for (const patch of patches) {
        const target = path.join(workspace, patch.filePath);
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
}

export const localGitProvider = new LocalGitProvider();
