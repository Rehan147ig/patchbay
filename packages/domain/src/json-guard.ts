/**
 * Depth and size bounding for untrusted JSON payloads (webhook/agent bodies,
 * manually supplied change payloads).
 *
 * A malicious or buggy client can send a deeply nested JSON object that
 * exhausts the call stack in normalizers or the UI renderer, or a payload
 * whose serialized size is huge. This module rewrites the value so it stays
 * JSON-serializable, flat enough to walk safely, and under a byte cap —
 * deterministically, with no evaluation.
 */

export const MAX_RAW_PAYLOAD_DEPTH = 12;
export const MAX_RAW_PAYLOAD_BYTES = 128 * 1024;
export const MAX_STRING_CHARS = 1_024;

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function truncateString(value: string): string {
  if (value.length <= MAX_STRING_CHARS) return value;
  return `${value.slice(0, MAX_STRING_CHARS)}...[truncated]`;
}

/**
 * Recursively normalize an untrusted value:
 * - only JSON-compatible types survive (undefined/functions/NaN dropped),
 * - strings are capped at MAX_STRING_CHARS,
 * - nesting beyond maxDepth is replaced by a marker string,
 * - arrays keep their bounds (truncated per maxDepth level too).
 */
export function boundJsonDepth(
  value: unknown,
  maxDepth = MAX_RAW_PAYLOAD_DEPTH,
): JsonValue | null | undefined {
  if (value === null) return null;
  switch (typeof value) {
    case "string":
      return truncateString(value);
    case "number":
      return Number.isFinite(value) ? value : undefined;
    case "boolean":
      return value;
    case "object":
      break;
    default:
      // undefined, functions, symbols, bigints: not JSON-compatible, drop.
      return undefined;
  }

  if (Array.isArray(value)) {
    if (maxDepth <= 0) return "<depth limit exceeded>";
    const out: JsonValue[] = [];
    for (const item of value) {
      const bounded = boundJsonDepth(item, maxDepth - 1);
      if (bounded !== undefined) out.push(bounded);
    }
    return out;
  }

  if (maxDepth <= 0) return "<depth limit exceeded>";
  const out: Record<string, JsonValue> = {};
  for (const [key, item] of Object.entries(value)) {
    const bounded = boundJsonDepth(item, maxDepth - 1);
    if (bounded !== undefined) out[key] = bounded;
  }
  return out;
}

/** Serialized byte cap for the normalized payload, truncating long strings first. */
export function boundJsonBytes(value: JsonValue, maxBytes = MAX_RAW_PAYLOAD_BYTES): JsonValue {
  if (serializedSize(value) <= maxBytes) return value;

  const remaining = { value: value as JsonValue, bytes: serializedSize(value) };

  // Iteratively halve the longest strings until the payload fits. Bounded
  // loop: each pass removes at least the longest string's half-length.
  for (let pass = 0; pass < 12; pass++) {
    const longest = findLongestString(remaining.value);
    if (longest === null) break;
    const truncated = longest.value.slice(0, Math.max(64, Math.floor(longest.value.length / 2)));
    const replacement = `${truncated}...[truncated]`;
    replaceString(remaining.value, longest.path, replacement);
    remaining.bytes = serializedSize(remaining.value);
    if (remaining.bytes <= maxBytes) break;
  }

  // Pathological fallback: a single string larger than the cap.
  if (serializedSize(remaining.value) > maxBytes) {
    return {
      __patchbay_trimmed__: "payload exceeds size limit",
    };
  }
  return remaining.value;
}

function serializedSize(value: JsonValue): number {
  return JSON.stringify(value)?.length ?? 0;
}

function findLongestString(
  value: JsonValue,
  path: string[] = [],
): { value: string; path: string[] } | null {
  if (typeof value === "string") return { value, path };
  if (Array.isArray(value)) {
    let best: { value: string; path: string[] } | null = null;
    value.forEach((item, index) => {
      const candidate = findLongestString(item, [...path, String(index)]);
      if (candidate && (!best || candidate.value.length > best.value.length)) best = candidate;
    });
    return best;
  }
  if (isPlainObject(value)) {
    let best: { value: string; path: string[] } | null = null;
    for (const [key, item] of Object.entries(value)) {
      const candidate = findLongestString(item as JsonValue, [...path, key]);
      if (candidate && (!best || candidate.value.length > best.value.length)) best = candidate;
    }
    return best;
  }
  return null;
}

function replaceString(root: JsonValue, path: string[], replacement: string): void {
  let node: JsonValue = root;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i]!;
    node = (
      Array.isArray(node) ? node[Number(key)] : (node as Record<string, JsonValue>)[key]
    ) as JsonValue;
  }
  const lastKey = path[path.length - 1]!;
  if (Array.isArray(node)) node[Number(lastKey)] = replacement;
  else (node as Record<string, JsonValue>)[lastKey] = replacement;
}

/** Full pipeline: depth bound, then byte cap. */
export function boundRawPayload(value: unknown): JsonValue | null {
  return boundJsonBytes(boundJsonDepth(value) ?? null);
}
