# Agent Snapshot Pipeline (connected-repository AI patches)

## Trust chain

```
exact commit SHA (API-resolved, never a branch ref)
  -> job-owned temp checkout (GitHub App installation token, org-bound)
  -> verify FETCH_HEAD == SHA + `git write-tree` == treeHash
  -> manifest (sorted path + size + mode + sha256, manifestHash)
  -> RepositorySnapshot row (ids + hashes + timestamps + provenance ONLY)
  -> deterministic evidence packet (bounded excerpts, no shell/creds/network)
  -> AI PatchPlan (structured intent only, placeholder hashes)
  -> bindSnapshotHashes (missing/unsafe/stale -> INVALIDATED)
  -> pack budgets + approval-required forcing
  -> applyBoundPlanToCheckout (same snapshot, TOCTOU-checked, declared-only)
  -> isolated validation -> policy -> approval-required draft PR
```

- AI proposes intent. Deterministic code owns state, reads, hashes,
  mutation, validation, policy, approval, and delivery.
- No general shell agent, no autonomous merge, no reusable customer
  workspaces, no Mastra dependency. BullMQ/Postgres stay the durable
  authority; the Mastra-contract adapter sequences judgment inside one job.
- GitHub PR delivery consumes validated PatchArtifacts, never raw model output.
- Fixture repositories use the SAME snapshot contract (manifest built with
  identical path-safety rules). No fixture-only production path.

## Retention

- `RepositorySnapshot.expiresAt` defaults to 90 days (`SNAPSHOT_RETENTION_DAYS`).
- Rows are `READY | EXPIRED | CLEANED_UP | FAILED` (String, validated at writes).
- Checkout paths are temporary execution state, removed in `finally`
  (`withSnapshotCheckout`, job `finally` blocks). Cleanup runs after success
  AND failure (tested).
- The DB never stores source content — only commit SHA, tree hash, manifest
  hash, extractor/graph versions, timestamps, and provenance FKs
  (`AgentRun/PatchArtifact/ValidationRun/RemediationAttempt.repositorySnapshotId`).

## Replay

- Safe replay re-checks out the SAME exact commit into a fresh temp dir and
  re-verifies commit + tree + manifest identity. It never trusts an old path.
- Fixture replays derive the commit SHA from `sha256(fixture:manifestHash)`,
  so the same content always replays to the same identity; drift fails closed.
- Workflow replay carries COMPLETED analyst steps (digest-verified) and
  re-executes from the failure boundary with the fresh manifest. A moved HEAD
  re-binds (never silently patches stale content); invalidated edits stay
  `PLAN_ONLY`/`INVALIDATED`, never `PATCH_PROPOSED`.

## AI autonomy boundary

- Deterministic certified packs keep draft-PR eligibility via the rule-based
  path (`requireCertified`, capability gates, quotas).
- AI-generated connected-repo patches are ALWAYS `requiresHumanReview=true`:
  policy yields `REQUIRE_APPROVAL` until a covering approval exists. No
  auto-merge. Sensitive tags (`PAYMENT/AUTH/AUTHORIZATION/PII/SECRETS/
ENCRYPTION/WEBHOOK/INFRASTRUCTURE`) keep dual/human approval + quorum.
- Zero-edit -> `PLAN_ONLY`. Any invalidated edit -> `INVALIDATED` (fail closed
  even when some edits remain). No partial patch ever becomes a PR.
- Budgets: ONE total `AI_RUN_BUDGET_CENTS` across planner + reviewer
  (reserve-before-call; reviewer spends the remainder). Unknown model pricing
  throws `UnknownModelPriceError` (never zero). Provider errors persist only
  classified kind/status — never bodies or credentials.
- Evidence packet caps: 8 files, 2k chars/excerpt, 12k total, 3 hops. Repo
  files, release notes, and vendor payloads are untrusted (control-char
  stripped, instruction-neutralized, marker-wrapped). `AI_PROVIDER=mock`
  default has zero egress; `ai-sdk` follows the same advisory/planning path.

## Remaining staging gate (not claimed from mocks)

- Unit proof: `snapshot.test.ts`, `snapshot-binding.test.ts`,
  `error-safety.test.ts`, `repository-snapshot.test.ts`, updated
  `agent-workflow.test.ts` (all mock/FS, no network).
- DB/integration proof: `migrate deploy` the `20260908000000` migration,
  live `RepositorySnapshot` RLS + `organization-vendor-enrollment` + `worm-db`
  - `redis-conformance` + `wp13-drills` on PG15/Redis7.
- Still required: real GitHub App staging golden path
  (`E2E_STAGING=1 staging-golden-path`): signed webhook -> PG event/case ->
  Redis job -> snapshot -> bound AI plan -> validation -> second-human approve
  -> draft PR -> check_run -> duplicate/signature/RBAC negatives -> audit
  export -> dashboard, plus `pg_dump` restore with RTO. Until then:
  `STAGING_BLOCKED`; no unrestricted-production claim.
