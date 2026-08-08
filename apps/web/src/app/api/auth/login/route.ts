import { prisma } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import { loginRequestSchema, tooManyRequests, unauthorized } from "@patchbay/domain";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk, parseBody, writeAuditEvent } from "@/lib/api";
import { checkRateLimit } from "@/lib/rate-limit";
import { createSessionCookie } from "@/lib/session";

export async function POST(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  try {
    // Brute-force protection: keyed by client IP. Do NOT trust
    // x-forwarded-for blindly — it is client-spoofable unless set by a
    // trusted proxy. Prefer x-real-ip (set by most reverse proxies) and
    // treat anything else as an unidentifiable client that shares the
    // global bucket, so spoofing the header cannot bypass the limit.
    const clientIp =
      request.headers.get("x-real-ip")?.trim() ||
      (isTrustedProxyIp(request.headers.get("x-forwarded-for"))
        ? request.headers.get("x-forwarded-for")!.split(",")[0]!.trim()
        : null) ||
      "unknown";
    const { allowed, retryAfterMs } = checkRateLimit(`login:${clientIp}`);
    if (!allowed) {
      const response = jsonError(
        tooManyRequests("Too many login attempts, try again shortly"),
        correlationId,
      );
      response.headers.set("retry-after", String(Math.ceil(retryAfterMs / 1000)));
      return response;
    }

    const input = await parseBody(request, loginRequestSchema);

    const user = await prisma.user.findUnique({ where: { email: input.email } });
    if (!user) throw unauthorized("Invalid email or password");

    // Local-development credential check only. Replaced by a real identity
    // provider later. Fail closed: no hardcoded fallback password — a single
    // shared default would let anyone authenticate as any user.
    const expectedPassword = process.env.DEMO_USER_PASSWORD;
    if (!expectedPassword) {
      throw unauthorized("Invalid email or password");
    }
    if (input.password !== expectedPassword) throw unauthorized("Invalid email or password");

    const cookie = await createSessionCookie(user.id, user.email);
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

/**
 * Only trust x-forwarded-for when the request came through a proxy we
 * control. Locally (dev) there is no such proxy, so this returns false and
 * the header is ignored — clients cannot spoof a fresh rate-limit bucket.
 */
function isTrustedProxyIp(forwardedFor: string | null): boolean {
  if (!forwardedFor) return false;
  const trustedProxies = (process.env.TRUSTED_PROXY_CIDRS ?? "").split(",").map((s) => s.trim());
  if (trustedProxies.length === 0) return false;
  const forwardedIp = forwardedFor.split(",")[0]?.trim();
  if (!forwardedIp) return false;
  // No CIDR math in the MVP: an empty allowlist means "trust no proxy".
  // A real deployment sets TRUSTED_PROXY_CIDRS to its ingress ranges.
  return trustedProxies.some((cidr) => cidr === forwardedIp || cidr === "0.0.0.0/0");
}
