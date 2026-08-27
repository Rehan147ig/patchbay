# Patch Security - Key Custody & Registry Signing

## HMAC Registry Signing

- **Primitive:** HMAC-SHA256 via `node:crypto` `createHmac`, verified with `timingSafeEqual` in `packages/vendor-connectors/src/registry-recipes.ts` and `packages/cli/src/index.ts`
- **Signed by whom:** Patch platform, key `PATCH_REGISTRY_SIGNING_KEY`
- **What is signed:** Canonical JSON of `MigrationRecipe` without `signature` field (deterministic `JSON.stringify`)
- **Verification:** CLI verifies before `--write`; on failure, fail-closed to `PLAN` preview, `--write` exits 1. Server also sets `x-patch-signature-verified` header.
- **Failure handling:** Unverified recipe is never applied as `DRAFT_PR`. User sees `Signature: FAILED` and must fetch from trusted registry.

## Key Custody

- **Storage (production):** `PATCH_REGISTRY_SIGNING_KEY` stored in platform secret manager (Railway/Vercel env secrets, restricted to `ADMIN` deploy role, never logged, never sent to browser). Local dev falls back to `dev-only-not-secure-change-in-production` with explicit warning.
- **Rotation policy:** Dual-key verification window. New key added as `PATCH_REGISTRY_SIGNING_KEY_NEXT`; CLI verifies against both current and next during rotation window (7 days). Recipes re-signed with new key, old key retired after window. Rotation is audited via `AuditAction` and requires `ADMIN` approval.
- **Compromise handling:** On suspected compromise, immediately rotate to new key, revoke old key, re-sign all certified recipes, and publish revocation notice via `GET /api/registry` `certifiedAt` bump. Clients with cached recipes fail verification and fetch fresh. Incident is recorded as `AuditEvent` with `reason: key_compromise`.

## What This Is Not

This is **not** a third-party security audit. It is a code-reviewed, security-conscious architecture with fail-closed design. Do not claim `security-audited` until an independent audit exists. Use `security-conscious` or `fail-closed design` in marketing and docs.

## GitHub App Trust Barrier & Ephemeral Sandbox (Gap #7)

**Why CLI first:** `npx patch-migrate` runs entirely on the user's machine/CI runner - code never leaves their environment, bypassing the GitHub App trust conversation. Continuous monitoring (recurring subscription) still requires the App.

**Ephemeral sandbox model (what we publish):**

- Clone to disposable temp directory (`$TMP/patchbay-*`), index usages via `repo-analysis`, run `tsc --noEmit` overlay, generate diff, purge filesystem immediately after. No persistent clone, no source stored in DB.
- Published in `docs/architecture.md:3.6` and this whitepaper - the trust argument for App cloning.
- Time-bound: architecture docs are day-1, public security whitepaper is week-2, SOC2 Type II is months (requires auditor, budget, and dedicated time - not fixable in code).

**Recurring revenue implication:** No engineering fix eliminates the trust conversation; docs + whitepaper + eventual SOC2 are the only answers.
