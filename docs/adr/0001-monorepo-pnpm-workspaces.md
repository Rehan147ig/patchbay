# ADR-0001: Monorepo with pnpm workspaces, no Turborepo

Status: accepted

## Context

Two apps (web, worker) share ten engine packages with strict dependency layering. A single
package manager must keep the graph simple.

## Decision

pnpm workspaces (apps/_, packages/_), no Turborepo. Root scripts run per-package tooling via
`pnpm -r`. All tooling (ESLint 9 flat config, Prettier, Vitest, tsc) lives at the root; each
package declares its own runtime deps and a `typecheck` script.

## Consequences

- Simpler mental model; no task-runner config drift.
- `pnpm run` PATH includes ancestor `node_modules/.bin`, so root tools work in package scripts.
- A single root `.env` is loaded via `dotenv-cli` in all scripts.
