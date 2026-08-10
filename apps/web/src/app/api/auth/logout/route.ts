import { AuditAction } from "@patchbay/audit";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk, writeAuditEvent } from "@/lib/api";
import { readSessionCookie, SESSION_COOKIE } from "@/lib/session";
import { assertCsrfToken } from "@/lib/csrf";

export async function POST(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  try {
    assertCsrfToken(request);
    const session = await readSessionCookie(request.cookies.get(SESSION_COOKIE)?.value);
    if (session) {
      const user = await import("@patchbay/db").then(({ prisma }) =>
        prisma.user.findUnique({ where: { id: session.sub } }),
      );
      if (user) {
        await writeAuditEvent({
          organizationId: user.organizationId,
          actorType: "USER",
          actorId: user.id,
          action: AuditAction.USER_LOGOUT,
          entityType: "user",
          entityId: user.id,
          correlationId,
        });
      }
    }
    const response = jsonOk({ signedOut: true }, correlationId);
    response.headers.set(
      "set-cookie",
      `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
    );
    return response;
  } catch (error) {
    return jsonError(error, correlationId);
  }
}
