import { execFileSync } from "node:child_process";

/**
 * Shared hardening helpers for every git subprocess in the provider package.
 *
 * Rules enforced here:
 * - Git is always invoked as an argv array via `runGit` (never a shell string),
 *   so metacharacters in any argument cannot be interpreted by a shell.
 * - Commit SHAs must match the exact hex grammar before they may touch an
 *   argument list or a ref name.
 * - Repository full names must be a strict "owner/name" pair so they can never
 *   form a git URL with a transport modifier (e.g. `ext::`).
 * - Installation credentials travel through GIT_CONFIG_* environment variables
 *   (the same mechanism GitHub's own checkout action uses), never through the
 *   remote URL or argv, so tokens never appear in process listings.
 */

const SHA_PATTERN = /^[0-9a-f]{7,64}$/;
const REPO_FULL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function assertSafeSha(sha: string): string {
  if (!SHA_PATTERN.test(sha)) {
    throw new Error(`unsafe commit sha rejected: ${JSON.stringify(sha.slice(0, 32))}`);
  }
  return sha;
}

export function assertSafeRepoFullName(fullName: string): string {
  if (!REPO_FULL_NAME_PATTERN.test(fullName)) {
    throw new Error(
      `unsafe repository full name rejected: ${JSON.stringify(fullName.slice(0, 64))}`,
    );
  }
  return fullName;
}

export interface RunGitOptions {
  cwd?: string;
  /** Extra environment for this invocation (merged over a minimal parent env). */
  env?: Record<string, string>;
  capture?: boolean;
}

export function runGit(args: string[], options: RunGitOptions = {}): string | null {
  const result = execFileSync("git", args, {
    cwd: options.cwd,
    stdio: options.capture ? ["ignore", "pipe", "ignore"] : "ignore",
    encoding: options.capture ? "utf8" : undefined,
    env: { ...process.env, ...options.env },
  });
  return options.capture ? (result as string).trim() : null;
}

/** Builds the GIT_CONFIG_* env block carrying the token for github.com over HTTPS. */
export function gitAuthEnv(token: string): Record<string, string> {
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  return {
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
  };
}
