# ADR-0004: Command allowlist sandbox

Status: accepted

## Context

Validation (`pnpm typecheck`, `pnpm test`, ...) requires executing commands on repository code.
This is the riskiest capability in the MVP.

## Decision

- `sandbox-runner` executes only commands from a fixed allowlist
  (`pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `npm ci`,
  `npm run lint`, `npm run typecheck`, `npm test`).
- Commands are never constructed from AI output or external text.
- Timeout, bounded stdout/stderr capture, redaction of output, disposable temp workspace.
- Runner is explicitly documented as not a hardened multi-tenant sandbox.

## Consequences

- Acceptance criterion "shell runner rejects non-allowlisted commands" is unit-tested.
- Known limitation: allowlisted _script names_ can still run whatever the repo's package.json
  defines; production hardening requires hermetic containers (see threat model T13).
