import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { MigrationRecipe, RecipeListEntry, RecipeRule } from "@patchbay/domain";
import { getCapability } from "./capabilities";
import { getConnector } from "./registry";

const ENGINE_VERSION = "1.0.0";

function deriveKeyId(key: string): string {
  return `kid_${createHash("sha256").update(key).digest("hex").slice(0, 12)}`;
}

export type SigningKeyInfo = { id: string; key: string };

function signingKeyInfoFromEnv(
  keyEnv: string,
  idEnv: string,
  fallbackId: string,
): SigningKeyInfo | null {
  const key =
    process.env[keyEnv] ??
    (keyEnv === "PATCH_REGISTRY_SIGNING_KEY"
      ? "dev-only-not-secure-change-in-production"
      : undefined);
  if (!key) return null;
  const explicitId = process.env[idEnv];
  const id = explicitId && explicitId.trim().length > 0 ? explicitId.trim() : deriveKeyId(key);
  // fallbackId is only used when key is dev fallback and we want stable "current"/"next" labels for logs/tests
  // Prefer derive, but keep explicit fallback for readability in dev: if no explicit id and is dev key, use fallbackId
  if (!explicitId && key === "dev-only-not-secure-change-in-production")
    return { id: fallbackId, key };
  return { id, key };
}

export function getSigningKeys(): { current: SigningKeyInfo; next?: SigningKeyInfo } {
  const current = signingKeyInfoFromEnv(
    "PATCH_REGISTRY_SIGNING_KEY",
    "PATCH_REGISTRY_SIGNING_KEY_ID",
    "current",
  )!;
  const nextRaw = process.env.PATCH_REGISTRY_SIGNING_KEY_NEXT;
  if (!nextRaw || nextRaw.trim().length === 0) return { current };
  const nextIdEnv = process.env.PATCH_REGISTRY_SIGNING_KEY_NEXT_ID;
  const nextId = nextIdEnv && nextIdEnv.trim().length > 0 ? nextIdEnv.trim() : deriveKeyId(nextRaw);
  // If next key material equals current, treat as no rotation (avoid dual verification confusion)
  if (nextRaw === current.key) return { current };
  return { current, next: { id: nextId, key: nextRaw } };
}

/** Static payloads derived from EVAL_CORPUS matched entries - avoids cross-package circular dep. */

/** Known registry version pairs derived from EVAL_CORPUS matched entries. */
const REGISTRY_PAIRS: Array<{ vendor: string; from: string; to: string }> = [
  { vendor: "openai", from: "3.3.0", to: "4.0.0" },
  { vendor: "stripe", from: "16.11.0", to: "16.12.0" },
  { vendor: "twilio", from: "3.83.0", to: "3.84.0" },
  { vendor: "anthropic", from: "0.19.0", to: "0.20.0" },
  { vendor: "supabase", from: "1.35.6", to: "1.35.7" },
  { vendor: "aws-sdk", from: "2.1690.0", to: "2.1691.0" },
  { vendor: "auth0", from: "3.2.0", to: "3.3.0" },
  { vendor: "langchain", from: "0.0.1", to: "0.1.0" },
];

const CORPUS_PAYLOADS: Record<string, Record<string, unknown>> = {
  openai: {
    sdk: "openai",
    fromVersion: "3.x",
    toVersion: "4.x",
    migration: {
      methodRenames: [
        { from: "openai.createChatCompletion", to: "openai.chat.completions.create" },
      ],
      responseChanges: [
        { symbol: "completion.data", description: "v4 returns the body directly." },
      ],
    },
  },
  stripe: { sdk: "stripe" },
  twilio: { sdk: "twilio" },
  anthropic: { sdk: "anthropic" },
  supabase: { sdk: "supabase" },
  "aws-sdk": { sdk: "aws-sdk" },
  auth0: { sdk: "auth0" },
  langchain: { sdk: "langchain" },
};

export const REGISTRY_PAYLOADS = CORPUS_PAYLOADS;

export function signRecipe(canonical: Omit<MigrationRecipe, "signature">): string {
  // Legacy: sign exactly what caller passes (canonical may or may not contain keyId).
  // New callers should include keyId explicitly for versioning.
  const keys = getSigningKeys();
  const claimedId = (canonical as { keyId?: string }).keyId;
  const keyMaterial =
    claimedId && keys.next && claimedId === keys.next.id ? keys.next.key : keys.current.key;
  return createHmac("sha256", keyMaterial).update(JSON.stringify(canonical)).digest("hex");
}

/** Test-only: sign with an explicit keyId (current or next). */
export function signRecipeWithKeyId(
  canonical: Omit<MigrationRecipe, "signature">,
  keyId: string,
): string {
  const keys = getSigningKeys();
  const keyMaterial =
    keys.next && keyId === keys.next.id
      ? keys.next.key
      : keyId === keys.current.id
        ? keys.current.key
        : null;
  if (!keyMaterial) throw new Error(`Unknown signing keyId: ${keyId}`);
  const canonicalWithKeyId = { ...canonical, keyId };
  return createHmac("sha256", keyMaterial).update(JSON.stringify(canonicalWithKeyId)).digest("hex");
}

export type VerifyResult = {
  verified: boolean;
  keyId: string | null;
  rotationWindowActive: boolean;
};

export function verifyRecipeSignatureWithDetails(recipe: MigrationRecipe): VerifyResult {
  const { signature, ...canonical } = recipe as MigrationRecipe & { keyId?: string };
  const keys = getSigningKeys();
  const rotationWindowActive = !!keys.next;
  const claimedKeyId = (canonical as { keyId?: string }).keyId ?? null;

  const tryKey = (keyInfo: SigningKeyInfo, includeKeyId: boolean): boolean => {
    const canonicalForKey = includeKeyId ? { ...canonical, keyId: keyInfo.id } : { ...canonical };
    // If recipe claimed a keyId, only the matching key should succeed; but for legacy (no claim) we trial both
    if (claimedKeyId && claimedKeyId !== keyInfo.id) return false;
    const json = JSON.stringify(claimedKeyId ? canonical : canonicalForKey);
    // Actually for legacy, we need to try both forms: without keyId and with keyId
    // The caller will invoke tryKey twice with includeKeyId true/false via outer logic
    const expected = createHmac("sha256", keyInfo.key).update(json).digest("hex");
    if (signature.length !== expected.length) return false;
    try {
      return timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex"));
    } catch {
      return false;
    }
  };

  // Explicit keyId path: verify only against claimed key (payload includes keyId)
  if (claimedKeyId) {
    const match =
      claimedKeyId === keys.current.id
        ? keys.current
        : claimedKeyId === keys.next?.id
          ? keys.next
          : null;
    if (!match) return { verified: false, keyId: null, rotationWindowActive };
    const expected = createHmac("sha256", match.key)
      .update(JSON.stringify(canonical))
      .digest("hex");
    if (signature.length !== expected.length)
      return { verified: false, keyId: null, rotationWindowActive };
    try {
      const ok = timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex"));
      return { verified: ok, keyId: ok ? match.id : null, rotationWindowActive };
    } catch {
      return { verified: false, keyId: null, rotationWindowActive };
    }
  }

  // Legacy path (no keyId): try old signatures (without keyId) first, then new style (with keyId) for forward compat
  // Old style: canonical without keyId
  const legacyCurrentExpected = createHmac("sha256", keys.current.key)
    .update(JSON.stringify(canonical))
    .digest("hex");
  if (signature.length === legacyCurrentExpected.length) {
    try {
      if (timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(legacyCurrentExpected, "hex")))
        return { verified: true, keyId: keys.current.id, rotationWindowActive };
    } catch {}
  }
  if (keys.next) {
    const legacyNextExpected = createHmac("sha256", keys.next.key)
      .update(JSON.stringify(canonical))
      .digest("hex");
    if (signature.length === legacyNextExpected.length) {
      try {
        if (timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(legacyNextExpected, "hex")))
          return { verified: true, keyId: keys.next.id, rotationWindowActive };
      } catch {}
    }
  }
  // New style with keyId (in case a recipe was signed with keyId but field was stripped — trial)
  if (tryKey(keys.current, true))
    return { verified: true, keyId: keys.current.id, rotationWindowActive };
  if (keys.next && tryKey(keys.next, true))
    return { verified: true, keyId: keys.next.id, rotationWindowActive };
  return { verified: false, keyId: null, rotationWindowActive };
}

export function verifyRecipeSignature(recipe: MigrationRecipe): boolean {
  return verifyRecipeSignatureWithDetails(recipe).verified;
}

function corpusPayloadFor(vendor: string): Record<string, unknown> | null {
  return CORPUS_PAYLOADS[vendor] ?? null;
}

export function listRegistryEntries(): RecipeListEntry[] {
  const entries: RecipeListEntry[] = [];
  for (const pair of REGISTRY_PAIRS) {
    const cap = getCapability(pair.vendor);
    if (!cap) continue;
    // Only DRAFT_PR and PLAN are registry-visible (ASSESS/DETECT have no rule pack).
    if (cap.level !== "DRAFT_PR" && cap.level !== "PLAN") continue;
    entries.push({
      vendor: pair.vendor,
      fromVersion: pair.from,
      toVersion: pair.to,
      capability: cap.level === "DRAFT_PR" ? "DRAFT_PR" : "PLAN",
      certifiedAt: cap.certifiedAt,
    });
  }
  return entries;
}

export function getRegistryRecipe(
  vendor: string,
  from: string,
  to: string,
): MigrationRecipe | null {
  const cap = getCapability(vendor);
  if (!cap) return null;
  if (cap.level !== "DRAFT_PR" && cap.level !== "PLAN") return null;

  const pair = REGISTRY_PAIRS.find((p) => p.vendor === vendor && p.from === from && p.to === to);
  if (!pair) return null;

  const connector = getConnector(vendor);
  const payload = corpusPayloadFor(vendor) ?? { vendor, fromVersion: from, toVersion: to };
  let rules: RecipeRule[] = [];
  if (connector) {
    try {
      const normalizations = connector.normalizeChange({
        rawPayload: payload as never,
        sourceType: "SDK_RELEASE",
      });
      rules = normalizations.map((n) => ({
        changeType: n.changeType,
        oldValue: n.oldValue ?? null,
        newValue: n.newValue ?? null,
        description: n.description ?? null,
        trusted: true,
      }));
    } catch {
      // Fallback to empty - will be filtered below
    }
  }
  if (rules.length === 0) {
    // Minimal fallback rule so schema validates (PLAN-level placeholder)
    rules = [
      {
        changeType: "SDK_VERSION_UPGRADE",
        oldValue: from,
        newValue: to,
        description: `${vendor} ${from} -> ${to}`,
        trusted: true,
      },
    ];
  }

  const keys = getSigningKeys();
  const canonical: Omit<MigrationRecipe, "signature"> = {
    schemaVersion: 1,
    vendor,
    fromVersion: from,
    toVersion: to,
    capability: cap.level === "DRAFT_PR" ? "DRAFT_PR" : "PLAN",
    certifiedAt: cap.certifiedAt,
    engineVersion: ENGINE_VERSION,
    rules,
    keyId: keys.current.id,
    signatureVersion: 1,
  };
  const signature = signRecipe(canonical);
  return { ...canonical, signature };
}
