# Pilot Scope & Metrics (P2)

## P2-11 — 3 high-confidence change types (depth > breadth)

1. **npm semver upgrades** — `package.json` manifest bumps (`semver-bump/1.0.0`, `autonomous-generic` DRAFT_PR). Deterministic, sandbox-proven per PR, majors stay PLAN-only.
2. **OpenAPI breaking changes** — `generic-openapi` ASSESS→PLAN via `openapi-spec` diff (endpoint/parameter removed/required). Plan-only, human-authored migration.
3. **Internal SDK release events** — `RELEASE-WATCHTOWER` npm/GitHub release poll → `VendorChangeEvent` → `ReleaseRecord` → `RemediationCase`. Providers: OpenAI, Stripe, Twilio (DRAFT_PR-certified) as reference implementations.

All other connectors remain at `ASSESS` (impact-analysis) per `docs/capability-matrix.md` — no silent promotion.

## P2-12 — Language / package-manager scoping

**Supported well for design partners:** TypeScript/JavaScript (`pnpm` + `npm`) and Python (`openai-python`, tree-sitter reparse). Depth beats a long support list.

Out of scope for pilot: `pnpm` workspace `maven`/`gradle`/`go.mod` lockfile-wide refactors beyond `INFRASTRUCTURE` gating (plan-only).

## P2-13 — Unified workflow (same path, every change)

`detect → explain impact → draft PR → sandbox validation → human approval → customer CI result`

- Detect: `poll-npm-registry` / `ContractSource` sync
- Explain: `blast-radius` + `remediation-explainability.md` chain
- Draft PR: `create-pr` via `DeliveryAttempt` ledger, `<!-- patchbay:evidence -->`
- Validation: `VALIDATION_COMMAND_REGISTRY` in `node:20-slim` container (`--network none` etc.)
- Approval: `Approval` hash-bound, quorum for sensitive tags
- CI result: `check_run` ingest → `ValidationRun` SKIPPED/PASSED/FAILED

Onboarding wizard (`/onboarding`) walks this path: install → fleet → sources → shadow scan → first case blast preview → policy tier.

## P2-14 — Pilot metrics (tracked)

| Metric               | Source                                                                      | Target (pilot)  |
| -------------------- | --------------------------------------------------------------------------- | --------------- |
| Detection latency    | `ContractChange`/`ReleaseRecord` `observedAt` → `RemediationCase.createdAt` | < 1h            |
| False-positive rate  | `PrOutcome.classification` ∈ `WRONG_IMPACT/WRONG_PATCH` / total             | < 10%           |
| PR acceptance rate   | `PullRequest.status=MERGED` / `DRAFT`                                       | > 50%           |
| Validation pass rate | `ValidationRun.status=PASSED` / total                                       | > 80%           |
| Time saved           | `hoursSaved = mergedPRs * 4` (overview)                                     | report, no gate |
| Rollback incidents   | `PrOutcome.classification=ROLLBACK` + audit                                 | 0               |

Dashboard: `/overview` (merge rate, hours saved, stale sources), `/operations` (queues, gates), `/outcomes` (classifications). Exportable via `/api/audit/export`.

## 8 maintenance views (P1-7 / WP12)

Overview, Changes, Repositories, Cases, Sources, Policies, Operations, Settings — all navigable, no dead links, every data view has loading/empty/error/stale/denied states.
