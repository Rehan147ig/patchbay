# Agent Snapshot Pipeline (connected-repository AI patches)

## Trust chain

```
analyzed commit SHA (graph snapshot or match — never HEAD-resolved here)
  -> job-owned temp checkout (GitHub App installation token, org-bound)
  -> checkout EXACT expected SHA or fail closed (no HEAD fallback)
  -> verify FETCH_HEAD == SHA + `git write-tree` == treeHash
  -> manifest (sorted path + size + mode + sha256, manifestHash)
  -> RepositorySnapshot row (ids + hashes + timestamps + provenance ONLY)
  -> deterministic evidence packet (bounded excerpts, no shell/creds/network)
  -> AI PatchPlan (structured intent only, placeholder hashes)
  -> bindSnapshotHashes (missing/unsafe/stale -> INVALIDATED)
  -> pack budgets + approval-required forcing
  -> applyBoundPlanToCheckout (same snapshot, TOCTOU-checked, declared-only,
     single-anchor by default, explicit bounded expectedOccurrences for multi)
  -> isolated validation -> policy -> approval-required draft PR
```

Pinning rule (P0): the snapshot builder takes `expectedCommitSha` from the
graph snapshot the impact evidence was read from (fallbacks: latest READY
graph snapshot, then match dependency commit). Connected repositories with no
analyzed commit fail closed as pre-model `PLAN_ONLY/SNAPSHOT_UNAVAILABLE`
with zero model spend — HEAD is never resolved as a substitute, so a branch
advancing after analysis cannot shift the AI onto newer code.

Anchor rule (P0): every edit declares `expectedOccurrences` (default 1, max
10). Zero matches = stale, N≠expected = ambiguous — both fail closed with no
partial application. Multi-occurrence edits must set N explicitly and match
exactly N (deterministic, bounded); the prompt instructs single-match anchors
by default.

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
- Expiry is ENFORCED at runtime: `checkoutSnapshotForApply` refuses expired or
  non-READY rows (marks EXPIRED best-effort, throws `SnapshotUnavailableError`,
  no patch, no PR), and the 6-hour retention sweep flips past-due READY rows
  to EXPIRED (`expireRepositorySnapshots`, wired next to agent-run/artifact
  purges). Reuse of the same commit after expiry revives the row explicitly
  with a fresh window (manifest/tree re-verified, never silently reused).
- Checkout paths are temporary execution state, removed in `finally`
  (`withSnapshotCheckout`, job `finally` blocks). Cleanup runs after success
  AND failure (tested).
- The DB never stores source content — only commit SHA, tree hash, manifest
  hash, extractor/graph versions, timestamps, and provenance FKs
  (`AgentRun/PatchArtifact/ValidationRun/RemediationAttempt.repositorySnapshotId`).

## Eligibility boundary: manifest size

- `MAX_SNAPSHOT_FILES = 2000`, `MAX_SNAPSHOT_FILE_BYTES = 1 MiB` (skipped
  `.git`/`node_modules`, non-regular files, oversized files). Exceeding 2000
  files throws `SnapshotBudgetError` during manifest build.
- A budget-exceeded snapshot is NOT retried as a partial manifest: the job
  records pre-model `PLAN_ONLY/SNAPSHOT_UNAVAILABLE` with zero model spend
  (same path as missing sources). Large enterprise repositories therefore stay
  `PLAN_ONLY` until a safe sparse/targeted snapshot strategy lands (e.g.
  impacted-file subset pinned to the same commit with manifest-subset hashing).
  This is a current eligibility boundary, not a silent truncation.

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
- Snapshot failures (no analyzed commit, unbuildable source, expired row,
  budget-exceeded manifest) become pre-model `PLAN_ONLY/SNAPSHOT_UNAVAILABLE`:
  the planner/reviewer never run, zero tokens are spent, the attempt records
  `SKIPPED/SNAPSHOT_UNAVAILABLE`, and the case moves to `PLAN_ONLY` with audit
  evidence (never a paid call followed by invalidation).
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
