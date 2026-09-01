import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Stage 3: KMS envelope encryption stub.
 * Local dev uses AES-256-GCM with KMS_KEY (32 bytes hex). Production should
 * replace this with cloud KMS (AWS KMS / GCP KMS / Azure Key Vault) envelope:
 *   1. Generate data key via KMS GenerateDataKey
 *   2. Encrypt payload with data key (AES-GCM)
 *   3. Store encrypted data key alongside ciphertext, decrypt via KMS Decrypt
 *
 * This stub preserves the envelope shape so swapping to cloud KMS is a single
 * function swap in this file.
 */

function kmsKey(): Buffer {
  const hex = process.env.KMS_KEY;
  if (!hex || hex.length < 64) {
    // Dev fallback — NOT for production. Set KMS_KEY=64 hex chars (32 bytes).
    return Buffer.alloc(32, 0);
  }
  return Buffer.from(hex.slice(0, 64), "hex");
}

export function encryptSecret(plaintext: string): string {
  const key = kmsKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // envelope: iv:tag:ciphertext (base64)
  return `${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

export function decryptSecret(envelope: string): string {
  const [ivB64, tagB64, encB64] = envelope.split(":");
  if (!ivB64 || !tagB64 || !encB64) throw new Error("invalid envelope");
  const key = kmsKey();
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const enc = Buffer.from(encB64, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString("utf8");
}

/** Returns true when a real KMS_KEY is configured (not the dev zero key). */
export function isKmsConfigured(): boolean {
  const hex = process.env.KMS_KEY;
  return Boolean(hex && hex.length >= 64 && !/^0+$/.test(hex));
}
