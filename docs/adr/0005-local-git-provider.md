# ADR-0005: Draft PRs via a local (mock) git provider by default

Status: accepted

## Context

The MVP must demo the full PR workflow offline; real GitHub requires credentials and network.

## Decision

- `GitProvider` interface: `listRepositories`, `getRepositorySnapshot`, `createBranch`,
  `applyPatch`, `createDraftPullRequest`.
- `LocalGitProvider` (default): copies fixture repos into a temp workspace, applies the patch,
  creates a branch + commit, and returns a stored mock `PullRequest` with a mock URL.
- `GitHubProvider`: PAT-based single-repository mode (legacy fallback).
- `GitHubAppProvider`: real GitHub App mode behind env vars (`GITHUB_APP_ID`, base64 PEM key,
  install flow, webhook secret) — RS256 App JWT, installation access tokens, draft PRs,
  HMAC-verified webhook receiver, org-bound installations. Never required for the demo.

## Consequences

- Full offline demo; acceptance test "local provider creates draft PR" runs in CI without network.
- The real App provider is a drop-in behind the same interface; the local provider remains the
  default until GitHub credentials are configured.
