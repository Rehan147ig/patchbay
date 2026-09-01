# KMS & Registry Signing Key Rotation Drill (7-day, best-in-class)

**Applies to:** `PATCH_REGISTRY_SIGNING_KEY` (HMAC) + `KMS_KEY` (AES-GCM envelope `kms.ts:1` → future cloud KMS). Both use same 7-day dual-key window.

## Registry key (already shipped `5e46ff3`)

Current: `PATCH_REGISTRY_SIGNING_KEY=k1` `PATCH_REGISTRY_SIGNING_KEY_ID=k1`
Next: `PATCH_REGISTRY_SIGNING_KEY_NEXT=k2` `PATCH_REGISTRY_SIGNING_KEY_NEXT_ID=k2`

Drill steps:

1. Generate: `openssl rand -hex 32` → `k2`, derive `kid_k2=sha256(k2)[0:12]`
2. Deploy both: set `NEXT` + `NEXT_ID` alongside current — `getSigningKeys()` `registry-recipes.ts:22` now verifies both, `verifyRecipeSignatureWithDetails()` returns `{keyId, rotationWindowActive:true}` `route.ts:21` headers `x-patch-rotation-window`
3. Re-sign: `pnpm exec tsx -e "import {getSigningKeys,signRecipe} from './packages/vendor-connectors/src/registry-recipes.ts'; ..."` for all 8 recipes, bump `certifiedAt` `capabilities.ts:74`, publish `GET /api/registry` — clients fetch fresh, cached `k1` still verifies via current during window
4. Audit: `registry.key_rotation_started/completed` `audit/src/actions.ts:90` with `ADMIN` actor
5. Promote after 7d: `NEXT` → `PATCH_REGISTRY_SIGNING_KEY` (`k2` current), remove `NEXT` — old `k1` sigs now fail `registry-recipes.test.ts:120` post-rotation rejection

## KMS envelope (local AES → cloud KMS)

Local: `KMS_KEY=64hex` (32 bytes) `kms.ts:1` `encryptSecret/decryptSecret` `iv:tag:ciphertext` base64
Cloud: `GenerateDataKey` → encrypt payload with data key, store encrypted data key alongside, `Decrypt` on read. Swap is one-file: `kms.ts:1` `kmsKey()` → `KMS.GenerateDataKey`.

Drill steps mirror registry: generate `k2`, dual-decrypt (try `k2` then `k1`), re-encrypt all `agentKeyHash`/`WebhookDelivery` rows with `k2`, promote `k2` → `KMS_KEY`, drop `k1` after window. Verify: `isKmsConfigured()` true, `decryptSecret(encryptSecret("test"))==="test"` with both keys.

Run quarterly + on compromise. Record in `AuditEvent` `reason:key_compromise` per `security.md`.
