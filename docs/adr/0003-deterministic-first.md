# ADR-0003: Deterministic-first remediation

Status: accepted

## Context

AI can draft plausible migrations, but Patchbay must never ship unverifiable patches.

## Decision

- Only deterministic migration rules (exact AST preconditions, known target pattern, scoped file
  impact) may produce patches and PRs.
- AI output is advisory: a labeled "AI-assisted, not automatically applicable" plan, parsed by
  Zod, and it can never execute commands or bypass policy gates.
- Every remediation records the rule used and its evidence (Explainability requirement).

## Consequences

- Bounded, testable behavior. Demo fixtures are fully deterministic.
- AI adds value in interpretation, not execution.
