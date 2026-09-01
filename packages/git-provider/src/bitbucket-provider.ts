import type {
  GitProvider,
  CheckoutInput,
  CheckoutResult,
  CreateDraftPRInput,
  PullRequestResult,
} from "./local-provider";

/**
 * Bitbucket provider stub (GOVERNED DELIVERY — Internal Git).
 * Same pattern as GitLabProvider: implements GitProvider so delivery target
 * is pluggable, fails loudly until the API backend ships.
 */
export interface BitbucketConfig {
  bitbucketUrl: string;
  token: string;
  workspace: string;
  repoSlug: string;
}

export class BitbucketProvider implements GitProvider {
  constructor(private readonly config: BitbucketConfig) {}

  async createDraftPullRequest(_input: CreateDraftPRInput): Promise<PullRequestResult> {
    throw new Error(
      `BitbucketProvider not yet implemented — configure GIT_PROVIDER=bitbucket and set BITBUCKET_TOKEN/BITBUCKET_URL to enable in a future release (stub at packages/git-provider/src/bitbucket-provider.ts:1)`,
    );
  }

  async checkout(_input: CheckoutInput): Promise<CheckoutResult> {
    throw new Error("BitbucketProvider.checkout not yet implemented — roadmap stub");
  }

  async resolveHeadSha(_baseBranch?: string): Promise<string> {
    throw new Error("BitbucketProvider.resolveHeadSha not yet implemented — roadmap stub");
  }

  async isAvailable(): Promise<boolean> {
    return false;
  }
}

export function isBitbucketConfigured(): boolean {
  return Boolean(process.env.BITBUCKET_TOKEN && process.env.BITBUCKET_URL);
}

export function createBitbucketProviderFromEnv(): BitbucketProvider | null {
  const token = process.env.BITBUCKET_TOKEN;
  const bitbucketUrl = process.env.BITBUCKET_URL ?? "https://api.bitbucket.org/2.0";
  const workspace = process.env.BITBUCKET_WORKSPACE ?? "";
  const repoSlug = process.env.BITBUCKET_REPO_SLUG ?? "";
  if (!token) return null;
  return new BitbucketProvider({ token, bitbucketUrl, workspace, repoSlug });
}
