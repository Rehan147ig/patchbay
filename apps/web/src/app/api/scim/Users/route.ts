import { prisma, withOrgContext } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import { ActorType, PatchbayError } from "@patchbay/domain";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk, writeAuditEvent } from "@/lib/api";

/**
 * Stage 5B: SCIM 2.0 provisioning — POST /api/scim/Users, GET /api/scim/Users
 * Bearer token from SCIM_TOKEN (per-org). Creates/Lists users via withOrgContext.
 * Minimal SCIM shape: { userName: email, name: { givenName, familyName }, active: boolean }
 */
function scimOrgId(request: NextRequest): string | null {
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token || token !== (process.env.SCIM_TOKEN ?? "")) return null;
  return process.env.SCIM_ORGANIZATION_ID ?? null;
}

export async function GET(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  try {
    const orgId = scimOrgId(request);
    if (!orgId)
      return jsonError(
        new PatchbayError("unauthorized", { statusCode: 401, code: "UNAUTHORIZED" }),
        correlationId,
      );
    const db = withOrgContext(prisma, orgId);
    const users = await db.user.findMany({
      select: { id: true, email: true, name: true, role: true },
    });
    return jsonOk(
      {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
        totalResults: users.length,
        Resources: users.map((u) => ({
          id: u.id,
          userName: u.email,
          name: { givenName: u.name },
          active: true,
          meta: { resourceType: "User" },
        })),
      },
      correlationId,
    );
  } catch (error) {
    return jsonError(error, correlationId);
  }
}

export async function POST(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  try {
    const orgId = scimOrgId(request);
    if (!orgId)
      return jsonError(
        new PatchbayError("unauthorized", { statusCode: 401, code: "UNAUTHORIZED" }),
        correlationId,
      );
    const body = (await request.json()) as Record<string, unknown>;
    const email = String((body.userName as string) ?? (body.email as string) ?? "").trim();
    const givenName = String(
      ((body.name as Record<string, unknown>)?.givenName as string) ??
        email.split("@")[0] ??
        "SCIM user",
    );
    if (!email.includes("@"))
      return jsonError(
        new PatchbayError("userName must be an email", { statusCode: 400, code: "BAD_REQUEST" }),
        correlationId,
      );
    const db = withOrgContext(prisma, orgId);
    const existing = await db.user.findFirst({ where: { email } });
    if (existing) return jsonOk({ id: existing.id, userName: existing.email }, correlationId, 201);
    const user = await db.user.create({
      data: { email, name: givenName, organizationId: orgId, role: "MEMBER" },
    });
    await writeAuditEvent({
      organizationId: orgId,
      actorType: ActorType.SYSTEM,
      actorId: null,
      action: AuditAction.SCIM_USER_CREATED,
      entityType: "user",
      entityId: user.id,
      correlationId,
      after: { email, scim: true },
    });
    return jsonOk({ id: user.id, userName: user.email, active: true }, correlationId, 201);
  } catch (error) {
    return jsonError(error, correlationId);
  }
}
