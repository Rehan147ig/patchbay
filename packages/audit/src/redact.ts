/**
 * Secret redaction helpers. Applied before persisting audit events, before logging, and
 * before assembling AI context. Redaction is intentionally conservative: when a value
 * smells like a secret it is replaced wholesale.
 */

const SENSITIVE_KEY_PATTERN =
  /(secret|token|password|passwd|api[_-]?key|apikey|authorization|auth[_-]?header|private[_-]?key|credential|bearer|signature|signing[_-]?secret|webhook[_-]?secret|client[_-]?secret|jwt|otp|mfa|captcha|verification[_-]?code|\bsid\b|session[_-]?id)/i;

/** Common credential formats found in free text (logs, stderr, prompts). */
const SECRET_VALUE_PATTERN =
  /(sk-[a-zA-Z0-9_-]{12,}|sk_live_[a-zA-Z0-9]{16,}|gh[pousr]_[a-zA-Z0-9]{20,}|xox[baprs]-[a-zA-Z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|ya29\.[0-9A-Za-z_-]{20,}|npm_[a-zA-Z0-9]{30,}|whsec_[a-zA-Z0-9_]{16,}|eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{10,}|-----BEGIN [A-Z ]+ PRIVATE KEY-----|(Basic|Digest)\s+[A-Za-z0-9+/=]{8,}|Bearer\s+[a-zA-Z0-9._-]{10,})/g;

const REDACTED = "[REDACTED]";

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}

/** Redacts sensitive string patterns in free text. */
export function sanitizeText(input: string): string {
  return input.replace(SECRET_VALUE_PATTERN, REDACTED);
}

/**
 * Recursively redacts any value whose key is sensitive, plus known credential patterns in
 * string values. Preserves the structure otherwise. Returns a plain-JSON-safe clone.
 */
export function redactSecrets(input: unknown): unknown {
  if (typeof input === "string") {
    return sanitizeText(input);
  }
  if (Array.isArray(input)) {
    return input.map((item) => redactSecrets(item));
  }
  if (input !== null && typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      out[key] = isSensitiveKey(key) ? REDACTED : redactSecrets(value);
    }
    return out;
  }
  return input;
}
