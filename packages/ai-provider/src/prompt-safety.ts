/**
 * Prompt-injection hardening for AI calls.
 *
 * Everything that reaches the model from repository analysis or vendor
 * payloads is UNTRUSTED: a malicious repo comment or vendor field can try to
 * override the system prompt ("ignore previous instructions..."). We never
 * filter instructions out of untrusted text by deletion alone (an attacker
 * can rephrase); instead every untrusted field is (1) stripped of control
 * characters, (2) syntax-neutralized so it cannot close or spoof the
 * boundary markers, and (3) wrapped in explicit data-only markers that the
 * system prompt tells the model to treat as data, never instructions.
 * Output is still Zod-validated before it can affect state.
 */

export const UNTRUSTED_OPEN = "<<<UNTRUSTED-DATA-START>>>";
export const UNTRUSTED_CLOSE = "<<<UNTRUSTED-DATA-END>>>";

export const MAX_UNTRUSTED_FIELD_CHARS = 2_000;
const MAX_UNTAGGED_FIELD_CHARS = 1_000;

const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const INSTRUCTION_PATTERNS = [
  /\b(?:ignore|disregard|forget|overwrite|forget about)\b[^.\n]{0,80}\b(?:instructions?|prompts?|messages?|rules?|system)\b/gi,
  /\b(?:you are|you're|from now on|now you are|act as)\b[^.\n]{0,80}\b(?:assistant|agent|system|admin|developer)\b/gi,
  /\b(?:repeat|print|reveal|show|expose)\b[^.\n]{0,60}\b(?:system|prompt|instructions?|secret|key)\b/gi,
];

/**
 * Strip control characters and neutralize instruction-override phrasing so a
 * snippet cannot hijack the conversation. Neutralized text is kept (with a
 * marker) rather than deleted, so analysis still sees it as content.
 */
export function sanitizeUntrustedText(text: string): string {
  let cleaned = text.replace(CONTROL_CHARS, " ").trim();
  for (const pattern of INSTRUCTION_PATTERNS) {
    cleaned = cleaned.replace(pattern, "[instruction-like content neutralized]");
  }
  // Boundary markers inside untrusted content would break framing.
  cleaned = cleaned.split(UNTRUSTED_OPEN).join("[marker-stripped]");
  cleaned = cleaned.split(UNTRUSTED_CLOSE).join("[marker-stripped]");
  return cleaned;
}

export function boundUntrusted(text: string, maxChars = MAX_UNTRUSTED_FIELD_CHARS): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n[truncated ${text.length - maxChars} chars]`;
}

/** Sanitize, bound and frame a single untrusted field (not wrapped). */
export function sanitizeField(text: string): string {
  return boundUntrusted(sanitizeUntrustedText(text), MAX_UNTAGGED_FIELD_CHARS);
}

/** Sanitize, bound and frame an untrusted block (usages, snippets). */
export function wrapUntrusted(text: string): string {
  return `${UNTRUSTED_OPEN}\n${boundUntrusted(sanitizeUntrustedText(text))}\n${UNTRUSTED_CLOSE}`;
}
