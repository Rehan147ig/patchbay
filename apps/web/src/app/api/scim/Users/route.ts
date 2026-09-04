import { prisma, withOrgContext } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import { ActorType, PatchbayError, tooManyRequests } from "@patchbay/domain";
import type { NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { getCorrelationId, jsonError, jsonOk, writeAuditEvent } from "@/lib/api";
import { checkGlobalRateLimit } from "@/lib/rate-limit";
import { hashScimToken, scimTokenLookupPrefix, verifyScimToken } from "@/lib/scim-tokens";

/**
 * Stage 5B: SCIM 2.0 provisioning — POST /api/scim/Users, GET /api/scim/Users
 * Bearer token is per-organization: the token's plaintext prefix selects the
 * single candidate org, then its argon2id hash is verified (current, then
 * previous-rotation). Only one expensive verification runs per request, and a
 * token for org A can never resolve org B. Minimal SCIM shape:
 * { userName: email, name: { givenName, familyName }, active: boolean }
 */

/** Decoy verification for unresolvable tokens (see vendors/[slug]/events). */
const DECOY_SCIM_VERIFY = hashScimToken(`pb_scim_decoy_${randomBytes(24).toString("base64url")}`);

async function burnDecoyVerification(providedToken: string): Promise<void> {
  try {
    await verifyScimToken(providedToken, await DECOY_SCIM_VERIFY, null);
  } catch {
    // Never surfaces: the outcome is discarded either way.
  }
}

function bearerToken(request: NextRequest): string | null {
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  return token.length > 0 ? token : null;
}

/**
 * Resolves the requesting organization from its SCIM bearer token.
 * Transitional fallback: organizations without an enrolled per-org token still
 * authenticate via the legacy global SCIM_TOKEN/SCIM_ORGANIZATION_ID env pair.
 */
export async function resolveScimOrganizationId(request: NextRequest): Promise<string | null> {
  const token = bearerToken(request);
  if (!token) return null;

  // Rate limits run BEFORE argon2id verification: hashing is deliberately
  // expensive, so an unauthenticated flood must be rejected cheaply first.
  const globalRate = await checkGlobalRateLimit();
  if (!globalRate.allowed) throw tooManyRequests("SCIM rate limit exceeded");

  const prefix = scimTokenLookupPrefix(token);
  const candidate = await prisma.organization.findFirst({
    where: { scimTokenPrefix: prefix, NOT: { scimTokenHash: null } },
    select: { id: true, scimTokenHash: true, scimTokenHashPrevious: true },
  });
  if (candidate?.scimTokenHash) {
    const match = await verifyScimToken(
      token,
      candidate.scimTokenHash,
      candidate.scimTokenHashPrevious,
    );
    if (match) return candidate.id;
  }
  await burnDecoyVerification(token);

  // Legacy global-token fallback for orgs not yet enrolled in per-org tokens.
  const legacyToken = process.env.SCIM_TOKEN ?? "";
  const legacyOrgId = process.env.SCIM_ORGANIZATION_ID ?? "";
  if (legacyToken.length > 0 && legacyOrgId.length > 0 && token === legacyToken) {
    return legacyOrgId;
  }
  return null;
}

export async function GET(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  try {
    const orgId = await resolveScimOrganizationId(request);
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
    const orgId = await resolveScimOrganizationId(request);
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
