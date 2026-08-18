import type { TrustProfile } from "./trust";

/**
 * Trust-enforcing fetch wrapper (WP6).
 *
 * Every Watchtower adapter poll goes through fetchWithTrust, which enforces
 * the adapter's trust profile: exact-domain allowlist (checked before the
 * request AND on every redirect), redirect policy, maximum response body
 * size, and timeout. Violations throw TrustViolationError with a machine
 * readable `reason` so the worker can fail the DetectionRun, audit it, and
 * keep polling the other adapters.
 */

export type TrustViolationReason =
  | "domain_not_allowed"
  | "redirect_rejected"
  | "response_too_large"
  | "request_timeout"
  | "non_ok_status";

export class TrustViolationError extends Error {
  readonly reason: TrustViolationReason;
  readonly status: number | null;

  constructor(reason: TrustViolationReason, message: string, status: number | null = null) {
    super(message);
    this.name = "TrustViolationError";
    this.reason = reason;
    this.status = status;
  }
}

export interface TrustedFetchOptions {
  headers?: Record<string, string>;
  /** When true (default), a 304 response is returned as-is for conditional polls. */
  allowNotModified?: boolean;
}

export interface TrustedFetchResult {
  status: number;
  headers: Headers;
  /** Fully read response body, already capped at the profile maximum. */
  text: string;
}

function assertAllowedDomain(url: URL, profile: TrustProfile): void {
  if (!profile.allowedDomains.includes(url.hostname)) {
    throw new TrustViolationError(
      "domain_not_allowed",
      `domain ${url.hostname} is not in the trust profile allowlist for ${profile.adapterPrefix || "unknown adapter"}`,
    );
  }
}

/**
 * Fetch with profile enforcement. Redirects are followed only when
 * profile.allowRedirects is true, and every hop is domain-checked. The body is
 * read fully but capped at profile.maxResponseBytes.
 */
export async function fetchWithTrust(
  url: string,
  profile: TrustProfile,
  options: TrustedFetchOptions = {},
): Promise<TrustedFetchResult> {
  const target = new URL(url);
  assertAllowedDomain(target, profile);

  const timeout = AbortSignal.timeout(profile.timeoutMs);
  let response: Response;
  try {
    response = await fetch(target, {
      headers: options.headers,
      redirect: profile.allowRedirects ? "follow" : "manual",
      signal: timeout,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new TrustViolationError(
        "request_timeout",
        `request to ${target.hostname} timed out after ${profile.timeoutMs}ms`,
      );
    }
    throw error;
  }

  // Manual redirect policy returns 3xx (other than the conditional 304, which
  // is a valid not-modified answer, not a redirect); the profile rejects them.
  if (response.status === 304) {
    if (options.allowNotModified === false) {
      throw new TrustViolationError("non_ok_status", "unexpected 304 response", 304);
    }
    return { status: 304, headers: response.headers, text: "" };
  }

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    throw new TrustViolationError(
      "redirect_rejected",
      `redirect to ${location ?? "unknown"} is not allowed by trust profile`,
      response.status,
    );
  }

  if (!response.ok) {
    throw new TrustViolationError(
      "non_ok_status",
      `fetch failed with status ${response.status}`,
      response.status,
    );
  }

  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && Number(declaredLength) > profile.maxResponseBytes) {
    throw new TrustViolationError(
      "response_too_large",
      `declared content-length ${declaredLength} exceeds profile maximum ${profile.maxResponseBytes}`,
      response.status,
    );
  }

  // Stream the body, aborting once the profile maximum is exceeded.
  const reader = response.body?.getReader();
  if (!reader) {
    return { status: response.status, headers: response.headers, text: "" };
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > profile.maxResponseBytes) {
      await reader.cancel();
      throw new TrustViolationError(
        "response_too_large",
        `response body exceeds profile maximum ${profile.maxResponseBytes} bytes`,
        response.status,
      );
    }
    chunks.push(value);
  }

  const body = new TextDecoder().decode(concat(chunks));
  return { status: response.status, headers: response.headers, text: body };
}

function concat(chunks: Uint8Array[]): Uint8Array {
  let size = 0;
  for (const chunk of chunks) size += chunk.byteLength;
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
