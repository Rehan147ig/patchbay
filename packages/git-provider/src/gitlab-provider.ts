import { RepositoryProvider } from "@patchbay/domain";
import type {
  GitProvider,
  CheckoutInput,
  CheckoutResult,
  CreateDraftPRInput,
  PullRequestResult,
} from "./local-provider";

/**
 * GitLab provider stub (GOVERNED DELIVERY — Internal Git).
 * Implements GitProvider so switching delivery target is a config change,
 * not a code fork. All methods fail loudly until the GitLab API backend ships.
 * Tagged as roadmap: see docs/adding-connector-ecosystem.md.
 */
export interface GitLabConfig {
  gitlabUrl: string;
  token: string;
  projectPath: string;
}

export class GitLabProvider implements GitProvider {
  readonly provider = RepositoryProvider.GITLAB;
  constructor(private readonly config: GitLabConfig) {}

  async createDraftPullRequest(_input: CreateDraftPRInput): Promise<PullRequestResult> {
    throw new Error(
      `GitLabProvider not yet implemented — configure GIT_PROVIDER=gitlab and set GITLAB_TOKEN/GITLAB_URL to enable in a future release (stub at packages/git-provider/src/gitlab-provider.ts:1)`,
    );
  }

  async checkout(_input: CheckoutInput): Promise<CheckoutResult> {
    throw new Error("GitLabProvider.checkout not yet implemented — roadmap stub");
  }

  async resolveHeadSha(_baseBranch?: string): Promise<string> {
    throw new Error("GitLabProvider.resolveHeadSha not yet implemented — roadmap stub");
  }

  /** Stub health probe: always unavailable until backend ships. */
  async isAvailable(): Promise<boolean> {
    return false;
  }
}

export function isGitLabConfigured(): boolean {
  return Boolean(process.env.GITLAB_TOKEN && process.env.GITLAB_URL);
}

export function createGitLabProviderFromEnv(): GitLabProvider | null {
  const token = process.env.GITLAB_TOKEN;
  const gitlabUrl = process.env.GITLAB_URL ?? "https://gitlab.com";
  const projectPath = process.env.GITLAB_PROJECT_PATH ?? "";
  if (!token) return null;
  return new GitLabProvider({ token, gitlabUrl, projectPath });
}
