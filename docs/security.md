# Patch Security - Key Custody & Registry Signing

## HMAC Registry Signing

- **Primitive:** HMAC-SHA256 via `node:crypto` `createHmac`, verified with `timingSafeEqual` in `packages/vendor-connectors/src/registry-recipes.ts` and `packages/cli/src/index.ts`
- **Signed by whom:** Patch platform, key `PATCH_REGISTRY_SIGNING_KEY`
- **What is signed:** Canonical JSON of `MigrationRecipe` without `signature` field (deterministic `JSON.stringify`)
- **Verification:** CLI verifies before `--write`; on failure, fail-closed to `PLAN` preview, `--write` exits 1. Server also sets `x-patch-signature-verified` header.
- **Failure handling:** Unverified recipe is never applied as `DRAFT_PR`. User sees `Signature: FAILED` and must fetch from trusted registry.

## Key Custody & Rotation

- **Storage (production):** `PATCH_REGISTRY_SIGNING_KEY` stored in platform secret manager (Railway/Vercel env secrets, restricted to `ADMIN` deploy role, never logged, never sent to browser). Local dev falls back to `dev-only-not-secure-change-in-production` with explicit warning.
- **Key identifiers:** Each key has an explicit `keyId` (`PATCH_REGISTRY_SIGNING_KEY_ID` / `PATCH_REGISTRY_SIGNING_KEY_NEXT_ID`). If not set, `kid_<sha256(key).slice(0,12)>` is derived deterministically. Recipes carry `keyId` and `signatureVersion:1`; the HMAC is over canonical JSON _including_ `keyId`, binding signature to key identity.
- **Verification (dual-key):** `verifyRecipeSignatureWithDetails()` `packages/vendor-connectors/src/registry-recipes.ts:99` returns `{verified, keyId, rotationWindowActive}`. If `recipe.keyId` is present, only that key is tried (prevents cross-key acceptance); if absent (legacy), current then next are tried with `timingSafeEqual`. During a rotation window (`NEXT` set) both `current` and `next` verify; `CLI` `packages/cli/src/index.ts:176` prints `keyId=<id> (rotation window active)` and `GET /api/registry/:vendor/:from/:to` `apps/web/src/app/api/registry/[vendor]/[from]/[to]/route.ts:21` sets `x-patch-signature-key-id` / `x-patch-verified-key-id` / `x-patch-rotation-window`.
- **Rotation window (7 days) overlap:**
  1. Generate new key (e.g., `openssl rand -hex 32`), assign `PATCH_REGISTRY_SIGNING_KEY_NEXT` + `NEXT_ID` (e.g., `k2`) alongside `current` (`k1`). Deploy — both keys verify (old recipes `kid_old` via current, new recipes `kid_new` via next).
  2. Re-sign all `8` certified recipes with `next` (`keyId=k2`, `POST /api/registry` `certifiedAt` bump). Deploy. Clients fetch fresh; cached old recipes still verify via current during window.
  3. After window, promote: `NEXT` → `PATCH_REGISTRY_SIGNING_KEY` (`k2` becomes current), remove `NEXT`/`NEXT_ID`. Old `k1` signatures then fail (`post-rotation rejection` test `registry-recipes.test.ts:120`).
- **Audit:** Verification emits `registry.recipe_verified` `packages/audit/src/actions.ts:87` with `metadata: {keyId, rotationWindowActive, vendor, from, to}`; rotation start/completion emit `registry.key_rotation_started/completed` with `ADMIN` actor. Legacy recipes without `keyId` verify via backward-compat path but are re-signed on next rotation.
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
