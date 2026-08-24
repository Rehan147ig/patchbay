# GROK HANDOFF — Patch post-security-audit state

Purpose: bring any new session to full working context WITHOUT re-exploring. Read this top to bottom.

Repo: `C:\Users\SHAIK MOHAMMAD REHAN\patchbay` (Next.js 15 + pnpm monorepo)
State: local `main` == `origin/main` @ `3a345cc` (security hardening sweep, all committed & pushed).
Bar: `pnpm format -> lint -> typecheck -> test -> test:corpus` — ALL GREEN at 3a345cc (~1038 tests, 28 corpus).

---

## 1. WHAT LANDED SINCE THE LAST HANDOFF (two work streams)

### A. Python openai draft-PR kit (certified DRAFT_PR)

- New connector slug **`openai-python`** (`packages/vendor-connectors/src/connectors/openai-python.ts`): v0→v1 module-call renames (`openai.ChatCompletion.create` → `client.chat.completions.create`), confidence 85. Capability entry: ecosystem `pypi`, language `python`, level `DRAFT_PR`, profile `python-tree-sitter-reparse + container-sandbox`.
- Remediation engine (`packages/remediation-engine/src/engine.ts`): `generatePlan` is now **async** and language-aware — `.py` files re-parse via tree-sitter (`pythonSyntaxCheck` in repo-analysis). Python client-based rewrites auto-insert an idempotent bootstrap (`from openai import OpenAI` + `client = OpenAI()`) in the import block, never inside functions.
- Fixture `fixtures/repositories/openai-python-legacy` converted to true v0 legacy style (module API, pins `openai>=0.27.0,<1.0.0`). Corpus entries `openai-python-0.28.1` (matched, patches src/chat.py) and `openai-python-1.0.0` (range-excluded negative). `fixturedDependency` reads python manifests + normalizes PEP 508 requirement strings.

### B. Security audit — every finding fixed (C1 critical, 5 high, 12 medium, 14 low, info batch)

Root cause class eliminated: **tenant-writable `repository.metadata` was treated as trusted operator config**. Now:

| Area                   | What correct looks like                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Git subprocesses       | `packages/git-provider/src/git-safe.ts`: argv-only via `runGit`, SHA grammar `/^[0-9a-f]{7,64}$/`, repo fullName grammar, token travels ONLY via `GIT_CONFIG_*` env (never URL/argv). No `execSync` template strings anywhere.                                                                                                                                                                                                                                                           |
| Commit SHAs            | NEVER read from metadata. `run-validation.ts` resolves HEAD via `provider.resolveHeadSha()` (GitHub API). `headShaOf()` is deleted.                                                                                                                                                                                                                                                                                                                                                      |
| Metadata schema        | `repositoryMetadataSchema` (domain) is `.strict()` — known keys only (`fixture`, `installationId`, `externalId`, `provider`, `demo`, `note`). Unknown keys rejected.                                                                                                                                                                                                                                                                                                                     |
| Installation ownership | `assertInstallationBelongsToOrganization(installationId, organizationId)` in `apps/worker/src/lib/repository-source.ts` — called by scan, graph-index, run-validation, create-pr. Cross-tenant installation ids fail loudly.                                                                                                                                                                                                                                                             |
| Fixtures               | `resolveFixtureDir` enforces name grammar `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$` + containment inside `fixtures/repositories`.                                                                                                                                                                                                                                                                                                                                                             |
| Patch writes           | Traversal guards everywhere patches are written: run-validation (realpath-based, symlink-hardened), LocalGitProvider, GitHub contents PUT.                                                                                                                                                                                                                                                                                                                                               |
| Org isolation          | `TaskParameter` is org-scoped end-to-end (migration `20260824000000_security_hardening_org_scope`); submission route passes `organizationId`; remediation routes scope INSIDE the query (`findFirst` + relation filter), not post-hoc.                                                                                                                                                                                                                                                   |
| Rate limiting          | Login walks XFF right-to-left skipping trusted-proxy CIDRs (IPv4 math); `x-real-ip` never trusted; per-account bucket added. Agent ingest rate-limits BEFORE argon2id.                                                                                                                                                                                                                                                                                                                   |
| Webhooks               | Body capped (streamed 5 MB) BEFORE HMAC; replay dedupe atomic via unique `payloadHash` (insert-first, P2002 ⇒ duplicate); install binding creates (never upserts over orgId) + audits `GITHUB_INSTALLATION_SYNCED`.                                                                                                                                                                                                                                                                      |
| Data wipe              | `DELETE /api/data` is one `$transaction`; audit rows are NEVER deleted (WORM trigger stays absolute) — DATA_DELETED marker written before the transaction.                                                                                                                                                                                                                                                                                                                               |
| Bodies                 | `parseBody` bounded by default (256 KB streamed cap); three ex-cast routes now have Zod schemas (connect, releases/[id]/plan, watchtower/detect); releases POST bounded.                                                                                                                                                                                                                                                                                                                 |
| AI                     | `sanitizeUntrustedText` credential-redacts before framing (sk_live_/PEM/etc. never reach the model vendor); planner prompt fields sanitized + UNTRUSTED-framed; legacy REST client has wall-clock timeout + host allowlist parity; provider instance cached per process so the circuit breaker accumulates failures.                                                                                                                                                                     |
| Ingest                 | Agent events idempotent via unique `(organizationId, vendorId, externalReference)` → duplicate returns original event id (status DUPLICATE, 200).                                                                                                                                                                                                                                                                                                                                        |
| Container/host         | Final Dockerfile runs as `node`; compose Redis requires password (`REDIS_PASSWORD`, default `patchbay_dev_only`) and binds 127.0.0.1 only; Windows kill helpers use `minimalChildEnv()`.                                                                                                                                                                                                                                                                                                 |
| Source-at-rest         | Evidence objects capped at 512 KB (`storeRawEvidence` throws above cap); retention sweep also nulls stale ValidationRun stdout/stderr. PatchArtifact contents remain BY DESIGN (diff feature) — revisit when real customer repos connect.                                                                                                                                                                                                                                                |
| Misc                   | PAT fallback refuses silently misrouting PRs when a target is supplied (throws); correlation IDs grammar-checked (`^[A-Za-z0-9._-]{8,128}$`); JSON logger redacts credential patterns; agent sha256 hashes refuse verification after 2026-12-31; watchtower runs/health ADMIN-only; model review summary markdown-escaped in PR bodies; worker has unhandledRejection/uncaughtException handlers + 30 s shutdown deadline; `SANDBOX_NPM_CACHE` actually wired into the container runner. |

## 2. REFERENCE / ENVIRONMENT

- Demo login: `demo@patchbay.dev` / `dev-only` (Docker Desktop must be running).
- Graphify graph at `graphify-out/graph.json` (3395 nodes) — pre-python-kit/pre-audit, regenerate if you rely on it.
- Shell alternates cmd.exe <> PowerShell 5.1: prefer plain commands / Edit tool; `SHAIKM~1` short path works everywhere.
- Python 64-bit is `py -V:3.13` (PATH python is 32-bit).
- `[id]` route tests: `pnpm vitest run --config vitest.wp10.config.ts`.
- Known flake: sandbox-runner timeout test fails under full-suite load — rerun that file alone before investigating.
- Migration `20260824000000_security_hardening_org_scope` IS APPLIED to the dev database.

## 3. VERIFICATION PROMPTS (in order)

```
pnpm format ; pnpm lint ; pnpm typecheck        # zero warnings/errors
pnpm test                                        # ~1038 passed; sandbox flake => rerun its file alone
pnpm vitest run --config vitest.wp10.config.ts   # [id] routes, 17 passed
pnpm test:corpus                                 # H8 gate, 28 passed incl. python kit
```

Security regression checks worth keeping green:

- `git grep -n "execSync(" packages/git-provider` must return NOTHING.
- `resolveFixtureDir("../../etc")` must throw (unit-covered in fixtures usage).
- `POST /api/repositories` with `metadata:{headSha:"..."}` must 422 (strict schema).

## 4. ACTIVE TODO (continue here)

1. **Demo scan transport**: `Rehan147ig/patch-demo-openai-legacy` cannot be scanned — `repository-source.ts` supports fixture OR installation only. Planned fix: CONTROLLED `cloneUrl` support (github.com HTTPS URLs only, grammar-checked, shallow argv clone, temp workspace cleaned by caller). Do NOT reintroduce arbitrary-URL cloning (that was the audit's RCE adjacent surface).
2. Real-DB integration test: WORM trigger rejects UPDATE/DELETE + `DELETE /api/data` transactional shape (the gap that let the old bug hide behind mocked Prisma).
3. `pnpm e2e` pass with Docker + worker running.
4. Operator task (NOT agent): rotate the OpenRouter key used during earlier AI testing.

## 5. KNOWN-INTENTIONAL STATES (do NOT "fix")

- `PatchArtifact.originalContent/patchedContent` store patched-file source — required by the diff UI; accepted trade-off until real customer repos.
- Remaining "Patchbay" strings in imports/error classes/comments — deliberate internal naming; user-facing brand is Patch.
- `ink-*` tokens in globals.css — required by agent-orbs-panel.
- Watchtower global release catalog is cross-org by design (runs/health endpoints are ADMIN-gated now).
- Per-scan cold shallow clone remains the transport (Option A webhook-incremental is the logged future direction; implementation trigger documented in the previous handoff revision).
