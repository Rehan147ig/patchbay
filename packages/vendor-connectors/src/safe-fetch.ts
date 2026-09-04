import { existsSync, readFileSync } from "node:fs";
import { Agent, type Dispatcher } from "undici";
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
  | "rate_limited"
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
  /**
   * POST with a caller-constructed JSON body (e.g. OSV queries). Restricted
   * to POST only — no PUT/DELETE/PATCH — and the body must be built by the
   * caller, never from external text. GET remains the default.
   */
  method?: "POST";
  body?: string;
}

export interface CustomCaConfig {
  /** PEM bundle contents (one or more certificates). */
  bundle: string;
  /** Source the bundle was loaded from (env var name), for diagnostics. */
  source: string;
}

/**
 * Enterprise TLS: resolves an additional root CA bundle for corporate
 * forward-inspection proxies (Zscaler, Palo Alto, Blue Coat) inside customer
 * VPCs. Reads PATCHBAY_CUSTOM_CA_BUNDLE first, then NODE_EXTRA_CA_CERTS;
 * each must name an existing file containing PEM data. Returns null when
 * neither is configured (default platform roots apply).
 *
 * The bundle is memoized per path: CA rotation requires a process restart,
 * which also matches Node's native NODE_EXTRA_CA_CERTS semantics.
 */
const caBundleCache = new Map<string, string | null>();

export function resetCustomCaCache(): void {
  caBundleCache.clear();
  enterpriseDispatcher = null;
  enterpriseDispatcherKey = null;
}

export function resolveCustomCaBundle(env: NodeJS.ProcessEnv = process.env): CustomCaConfig | null {
  for (const variable of ["PATCHBAY_CUSTOM_CA_BUNDLE", "NODE_EXTRA_CA_CERTS"] as const) {
    const candidate = env[variable]?.trim();
    if (!candidate) continue;
    if (caBundleCache.has(candidate)) {
      const cached = caBundleCache.get(candidate);
      return cached ? { bundle: cached, source: variable } : null;
    }
    let bundle: string | null = null;
    try {
      if (existsSync(candidate)) {
        const contents = readFileSync(candidate, "utf8");
        if (contents.includes("-----BEGIN CERTIFICATE-----")) bundle = contents;
      }
    } catch {
      bundle = null;
    }
    caBundleCache.set(candidate, bundle);
    if (bundle) return { bundle, source: variable };
    // A named-but-unreadable bundle is a hard misconfiguration: proceeding
    // with platform roots would produce confusing TLS errors, so fail loudly.
    throw new TrustViolationError(
      "non_ok_status",
      `custom CA bundle ${variable} points at an unreadable file: ${candidate}`,
      null,
    );
  }
  return null;
}

export interface TlsConnectOptions {
  /** Additional root CAs appended to the platform roots. */
  ca: string[];
  /** Always true: verification is never disabled, custom CA or not. */
  rejectUnauthorized: true;
}

/**
 * TLS connect options for enterprise fetch: platform roots plus the custom
 * bundle when configured. Pure and unit-testable; the dispatcher below
 * consumes it. rejectUnauthorized is unconditionally true — a proxy CA must
 * be explicitly configured, never silently trusted.
 */
export function buildTlsConnectOptions(
  env: NodeJS.ProcessEnv = process.env,
): TlsConnectOptions | undefined {
  const custom = resolveCustomCaBundle(env);
  if (!custom) return undefined;
  return { ca: [custom.bundle], rejectUnauthorized: true };
}

let enterpriseDispatcher: Dispatcher | null = null;
let enterpriseDispatcherKey: string | null = null;

/**
 * Undici dispatcher carrying the enterprise CA bundle. Memoized per bundle
 * source+path; undefined when no custom CA is configured (default fetch
 * behavior). Pass to global fetch as `{ dispatcher }`.
 */
export function enterpriseDispatcherFor(
  env: NodeJS.ProcessEnv = process.env,
): Dispatcher | undefined {
  const options = buildTlsConnectOptions(env);
  if (!options) return undefined;
  const key = `${env.PATCHBAY_CUSTOM_CA_BUNDLE ?? ""}|${env.NODE_EXTRA_CA_CERTS ?? ""}`;
  if (!enterpriseDispatcher || enterpriseDispatcherKey !== key) {
    enterpriseDispatcher = new Agent({ connect: options });
    enterpriseDispatcherKey = key;
  }
  return enterpriseDispatcher;
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
  if (profile.allowedPathPrefixes && profile.allowedPathPrefixes.length > 0) {
    const matched = profile.allowedPathPrefixes.some((prefix) => url.pathname.startsWith(prefix));
    if (!matched) {
      throw new TrustViolationError(
        "domain_not_allowed",
        `path ${url.pathname} does not match the allowed path prefixes for ${profile.adapterPrefix || "unknown adapter"}`,
      );
    }
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
  // Enterprise CA bundle when configured; undefined preserves default fetch.
  const dispatcher = enterpriseDispatcherFor();
  let response: Response;
  try {
    response = await fetch(target, {
      headers: options.headers,
      redirect: profile.allowRedirects ? "follow" : "manual",
      signal: timeout,
      ...(options.method ? { method: options.method } : {}),
      ...(options.body !== undefined ? { body: options.body } : {}),
      ...(dispatcher ? { dispatcher } : {}),
    } as RequestInit & { dispatcher?: Dispatcher });
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

  if (response.status === 429) {
    const retryAfter = response.headers.get("retry-after");
    throw new TrustViolationError(
      "rate_limited",
      `rate limited (429)${retryAfter ? `, retry-after: ${retryAfter}` : ""}`,
      429,
    );
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
