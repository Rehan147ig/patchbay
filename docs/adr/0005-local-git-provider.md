# ADR-0005: Draft PRs via a local (mock) git provider by default

Status: accepted

## Context

The MVP must demo the full PR workflow offline; real GitHub requires credentials and network.

## Decision

- `GitProvider` interface: `listRepositories`, `getRepositorySnapshot`, `createBranch`,
  `applyPatch`, `createDraftPullRequest`.
- `LocalGitProvider` (default): copies fixture repos into a temp workspace, applies the patch,
  creates a branch + commit, and returns a stored mock `PullRequest` with a mock URL.
- `GitHubProvider`: scaffolded behind env vars (`GITHUB_APP_ID`, private key, installation id),
  GitHub-App style, tokens server-side only; never required for the demo.

## Consequences

- Full offline demo; acceptance test "local provider creates draft PR" runs in CI without network.
- The interface makes the real provider a drop-in later.
