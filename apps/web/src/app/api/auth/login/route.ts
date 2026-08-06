import { prisma } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import { unauthorized } from "@patchbay/domain";
import { loginRequestSchema } from "@patchbay/domain";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk, parseBody, writeAuditEvent } from "@/lib/api";
import { createSessionCookie } from "@/lib/session";

export async function POST(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  try {
    const input = await parseBody(request, loginRequestSchema);

    const user = await prisma.user.findUnique({ where: { email: input.email } });
    if (!user) throw unauthorized("Invalid email or password");

    // Local-development credential check only. Replaced by a real identity provider later.
    const expectedPassword = process.env.DEMO_USER_PASSWORD ?? "dev-only";
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
