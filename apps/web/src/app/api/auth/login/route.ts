import { prisma } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import { loginRequestSchema, notFound, tooManyRequests, unauthorized } from "@patchbay/domain";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk, parseBody, writeAuditEvent } from "@/lib/api";
import { env } from "@/lib/env";
import { checkGlobalRateLimit, checkRateLimit } from "@/lib/rate-limit";
import { assertCsrfToken } from "@/lib/csrf-server";
import { createSessionCookie } from "@/lib/session";

export async function POST(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  try {
    assertCsrfToken(request);
    // Password login is a local-development convenience. In production it
    // must not exist at all — respond 404 so the endpoint is indistinguishable
    // from a route that was never deployed.
    if (env.NODE_ENV === "production") {
      throw notFound("This endpoint is not available");
    }
    // Brute-force protection: two independent fixed-window buckets.
    // 1) Per-client bucket. The key is ONLY derived from x-forwarded-for when
    //    TRUSTED_PROXY_CIDRS is configured, walking the chain RIGHT to LEFT:
    //    entries appended by trusted proxies are skipped until the first
    //    untrusted address (the real client as seen by our ingress). Anything
    //    an attacker prepends sits left of the proxy-appended tail and can
    //    never influence the key. No trusted proxy configured -> every client
    //    shares the "unknown" bucket, so spoofed headers gain nothing.
    //    x-real-ip is never consulted: Next.js route handlers cannot see the
    //    socket peer, so that header is indistinguishable from a spoof.
    // 2) Per-account bucket (below, after body parse) so rotating IPs cannot
    //    distribute guesses for one identity. The global burst cap still bounds
    //    total load.
    const globalRate = await checkGlobalRateLimit();
    if (!globalRate.allowed) {
      return tooManyRequestsResponse(globalRate.retryAfterMs, correlationId);
    }
    const clientKey = loginClientBucket(request);
    const { allowed, retryAfterMs } = await checkRateLimit(clientKey);
    if (!allowed) {
      return tooManyRequestsResponse(retryAfterMs, correlationId);
    }

    const input = await parseBody(request, loginRequestSchema);

    const accountRate = await checkRateLimit(`login-acct:${input.email.toLowerCase()}`);
    if (!accountRate.allowed) {
      return tooManyRequestsResponse(accountRate.retryAfterMs, correlationId);
    }

    const user = await prisma.user.findUnique({ where: { email: input.email } });
    if (!user) throw unauthorized("Invalid email or password");

    // Local-development credential check only. Replaced by a real identity
    // provider later. Fail closed: no hardcoded fallback password — a single
    // shared default would let anyone authenticate as any user.
    const expectedPassword = env.DEMO_USER_PASSWORD;
    if (!expectedPassword) {
      throw unauthorized("Invalid email or password");
    }
    if (input.password !== expectedPassword) throw unauthorized("Invalid email or password");

    const cookie = await createSessionCookie(user.id, user.email, user.sessionVersion);
    await writeAuditEvent({
      organizationId: user.organizationId,
      actorType: "USER",
      actorId: user.id,
      action: AuditAction.USER_LOGIN,
      entityType: "user",
      entityId: user.id,
      correlationId,
      after: { email: user.email },
    });

    const response = jsonOk(
      { user: { id: user.id, email: user.email, name: user.name, role: user.role } },
      correlationId,
    );
    response.headers.set("set-cookie", serializeCookie(cookie));
    return response;
  } catch (error) {
    return jsonError(error, correlationId);
  }
}

function serializeCookie(cookie: {
  name: string;
  value: string;
  options: Record<string, unknown>;
}): string {
  const parts = [`${cookie.name}=${cookie.value}`];
  if (cookie.options.httpOnly) parts.push("HttpOnly");
  if (cookie.options.sameSite) parts.push(`SameSite=${String(cookie.options.sameSite)}`);
  if (cookie.options.path) parts.push(`Path=${String(cookie.options.path)}`);
  if (cookie.options.maxAge !== undefined) parts.push(`Max-Age=${String(cookie.options.maxAge)}`);
  if (cookie.options.secure) parts.push("Secure");
  return parts.join("; ");
}

function tooManyRequestsResponse(retryAfterMs: number, correlationId: string): Response {
  const response = jsonError(
    tooManyRequests("Too many login attempts, try again shortly"),
    correlationId,
  );
  response.headers.set("retry-after", String(Math.ceil(retryAfterMs / 1000)));
  return response;
}

function loginClientBucket(request: NextRequest): string {
  const derived = deriveClientIpFromForwardedFor(request.headers.get("x-forwarded-for"));
  return `login:${derived ?? "unknown"}`;
}

/**
 * Derives the rate-limit identity from x-forwarded-for by trusting only the
 * proxy-appended tail of the chain: walking right to left, entries covered by
 * TRUSTED_PROXY_CIDRS are proxies we operate and get skipped; the first
 * address NOT covered is the client as observed by our ingress. Returns null
 * (shared bucket) when no trusted proxy is configured or the chain is fully
 * trusted — a forged left-side entry can therefore never mint fresh buckets.
 */
function deriveClientIpFromForwardedFor(forwardedFor: string | null): string | null {
  if (!forwardedFor) return null;
  const chain = forwardedFor
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (chain.length === 0) return null;
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    const candidate = chain[i]!;
    if (!isIpInTrustedProxyCidrs(candidate)) return candidate;
  }
  return null;
}

function isIpInTrustedProxyCidrs(ip: string): boolean {
  const cidrs = env.TRUSTED_PROXY_CIDRS.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (cidrs.length === 0) return false;
  return cidrs.some((cidr) => cidrContainsIp(cidr, ip));
}

/** IPv4 CIDR matching; non-IPv4 addresses compare as exact strings. */
function cidrContainsIp(cidr: string, ip: string): boolean {
  if (ip.includes(":") || cidr.includes(":")) return cidr === ip;
  const [range, bitsRaw] = cidr.split("/");
  if (!range || !bitsRaw) return false;
  const bits = Number(bitsRaw);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const rangeValue = ipv4ToNumber(range);
  const ipValue = ipv4ToNumber(ip);
  if (rangeValue === null || ipValue === null) return false;
  if (bits === 0) return true;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return (rangeValue & mask) === (ipValue & mask);
}

function ipv4ToNumber(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!/^\d+$/.test(part) || !Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    value = ((value << 8) | octet) >>> 0;
  }
  return value;
}
