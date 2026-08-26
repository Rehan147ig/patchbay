# Patchbay Changelog — Post-Verification Session Log

Baseline: f99dfed (verified by external reviewer / Cursor agent)
Current: bcaa97a on main (all pushed)
Scope: everything after the Cursor agent's pass verdict

---

## 1. Watchtower Hardening (f99dfed)

| Bug                                                   | Fix                                                                   |
| ----------------------------------------------------- | --------------------------------------------------------------------- |
| `prev.seenVersions` crash on legacy cursors           | Defensive `normalizeCursor()` in npm/github-releases/openapi adapters |
| auth0 repo mapping wrong (`auth0/auth0-nodejs` = 404) | Corrected to `auth0/node-auth0`                                       |
| Stripe OpenAPI spec URL was 404                       | Moved to raw.githubusercontent.com with path-prefix pinning           |

Also: `describeError()` cause-chain serializer, evidence cap 12MB, cursor growth bounded at 50.

Live verification: all 9 watchtower adapters COMPLETED. openapi:stripe observed Stripe spec v2026-07-29.dahlia.

---

## 2. cloneUrl Transport + Shared Resolver (fcfa021 + f8243d7)

New `cloneUrl` field in repositoryMetadataSchema (strict grammar). Shared resolver moved to packages/git-provider/src/repository-source.ts with DI. All consumers route through it. Disposable workspace cleanup via try/finally source.cleanup().

Also fixed: dead headShaOf removed, LocalGitProvider traversal guard, GitHub contents PUT path check, worker unhandledRejection handlers, SANDBOX_NPM_CACHE wired.

GHES support confirmed already present via GITHUB_API_URL env.

---

## 3. Security Re-audit Fixes (180147f)

- HIGH: Linear pom dependency scanner replaces quadratic ReDoS regex
- MED: Cursor gate relaxed to present-only type checks (legacy cursors self-heal)
- MED: Store cap aligned to fetch cap via per-call maxBytes
- LOW: Per-evidence try/catch in detect-releases, describeError redacted, correlation-ID grammar validation

---

## 4. Private Vendor Mode (643d003)

Vendor model now has proper Organization relation. New route POST /api/vendors/private (ADMIN). Settings UI registration form. Vendor listing scoped global + own private. Scan vendor map includes org privates. Org-scope drift test updated.

---

## 5. Auto-scan on Install (643d003)

GET /api/github/callback on FIRST binding auto-registers accessible repos and enqueues scans. Capacity-respecting. Best-effort (failures never block redirect).

---

## 6. Semantic Validation Gate (a3fed10)

New file packages/remediation-engine/src/semantic-gate.ts. Replaces syntax-only reparseCheck with real ts.createProgram type-checking. Baseline-relative error diffing (line-shift safe). Overlay host serves patched content in-memory without writing to disk.

Kit survival audit result: 5/6 pass. aws-sdk FAILS (renames without imports = TS2304).

Kit survival audit result: 5/6 pass. aws-sdk FAILS (renames without imports = TS2304).

**Status: WIRED INTO ENGINE.** `generatePlan` now runs `runSemanticGate` over the full patched file set after per-file syntax checks. Files with new semantic errors are moved to skippedFiles. Cross-file errors (missing imports) caught because all patched files are checked together as one overlay.

---

## 7. Java L1 Support (aeefbb8)

New packages/repo-analysis/src/java.ts — tree-sitter-java WASM extractor. pom.xml and build.gradle manifest parsing. javaSyntaxCheck wired into engine dispatch for .java files. Fixture stripe-java-legacy added.

---

## 8. Vendor Registration + Agent Key Improvements (bcaa97a)

- **Agent-key route**: proper argon2id rotation semantics documented; issuing a key CLAIMS the vendor for the org (known MVP limitation: shared catalog vendors become org-bound on first key issue)
- **Agent-key revocation**: DELETE endpoint clears both hashes; WORM audit event written
- **Anti-enumeration decoy**: burnDecoyVerification runs argon2id on rejected requests so response latency doesn't reveal whether a slug exists
- **Private vendor generic ASSESS ingest**: when no catalog connector exists for a private vendor slug, events are accepted via a generic normalizer at ASSESS level (no certified patches, no DRAFT_PR path)

---

## 9. Launch Gate Run

Full pipeline executed on Rehan147ig/patch-demo-openai-legacy:

- Scan COMPLETED (4 usages from src/chat-service.ts)
- Analyze AFFECTED (score 55)
- Plan 1 patch confidence 90
- Approval APPROVED
- Validate PASSED (after lockfile push)
- Draft PR opened at github.com/Rehan147ig/patch-demo-openai-legacy/pull/1

---

## Known Remaining Items

- aws-sdk connector DEMOTED to PLAN (renames without imports produce TS2304; re-certify only after adding import-aware rules that pass runSemanticGate)
- openai-python DEMOTED to ASSESS (no certified Python patch kit)
- Shared catalog agent-key "claim" model: issuing a key sets organizationId on the Vendor row — one org per shared catalog vendor. Proper VendorAgentCredential join table deferred
- SSO/SAML deferred
- Helm/VPC packaging deferred
- Kotlin/Swift/Go extractors not built
- Java DRAFT_PR certification pending (needs rule packs + corpus entries)
- OpenRouter key rotation (user action)
