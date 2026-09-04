import { createHmac, randomBytes } from "node:crypto";
import { prisma, withOrgContext } from "@patchbay/db";
import { AuditAction, formatAuditCef, normalizeAuditEvent } from "@patchbay/audit";
import { ActorType, tooManyRequests, unauthorized, validationFailed } from "@patchbay/domain";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, writeAuditEvent } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { checkGlobalRateLimit } from "@/lib/rate-limit";
import { hashApiToken, verifyApiToken } from "@/lib/api-tokens";
import { auditExportTokenLookupPrefix, verifyAuditExportToken } from "@/lib/audit-export-tokens";

/**
 * GET /api/audit/export — tamper-evident, cursor-paginated audit export for
 * enterprise SOCs. ADMIN session cookie OR per-org `pb_audit_` bearer token.
 *
 * Query params: format=jsonl (default) | cef | json | splunk, since=ISO
 * (default 24h ago), until=ISO, limit (default 1000, cap 10000),
 * cursor=`<iso>|<id>` from the previous page's nextCursor.
 *
 * The body streams as newline-delimited lines; `x-patch-export-signature` is
 * an HMAC-SHA256 over `<orgId>\n<body>` so transit tampering is detectable.
 * One AUDIT_LOG_EXPORTED event is recorded per request.
 */

type ExportFormat = "jsonl" | "cef" | "json" | "splunk";

const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 10000;
const DEFAULT_SINCE_MS = 24 * 60 * 60 * 1000;

/** Decoy verification for unresolvable bearer tokens (no org enumeration). */
const DECOY_EXPORT_VERIFY = hashApiToken(`pb_audit_decoy_${randomBytes(24).toString("base64url")}`);

interface ExportAuth {
  organizationId: string;
  actorType: ActorType;
  actorId: string | null;
  tokenPrefix: string | null;
}

async function resolveExportAuth(request: NextRequest): Promise<ExportAuth> {
  const auth = request.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (bearer.length > 0) {
    const globalRate = await checkGlobalRateLimit();
    if (!globalRate.allowed) throw tooManyRequests("Export rate limit exceeded");
    const prefix = auditExportTokenLookupPrefix(bearer);
    const candidate = await prisma.organization.findFirst({
      where: { auditExportTokenPrefix: prefix, NOT: { auditExportTokenHash: null } },
      select: {
        id: true,
        auditExportTokenHash: true,
        auditExportTokenHashPrevious: true,
      },
    });
    if (candidate?.auditExportTokenHash) {
      const match = await verifyAuditExportToken(
        bearer,
        candidate.auditExportTokenHash,
        candidate.auditExportTokenHashPrevious,
      );
      if (match) {
        return {
          organizationId: candidate.id,
          actorType: ActorType.SYSTEM,
          actorId: null,
          tokenPrefix: prefix,
        };
      }
    }
    try {
      await verifyApiToken(bearer, await DECOY_EXPORT_VERIFY, null);
    } catch {
      // Discarded: timing cover only.
    }
    throw unauthorized("Invalid audit export token");
  }
  const user = await requireRole("ADMIN");
  return {
    organizationId: user.organizationId,
    actorType: ActorType.USER,
    actorId: user.id,
    tokenPrefix: null,
  };
}

interface ExportCursor {
  createdAt: Date;
  id: string;
}

function parseCursor(raw: string | null): ExportCursor | null {
  if (!raw) return null;
  const separator = raw.lastIndexOf("|");
  if (separator <= 0) throw validationFailed("Malformed cursor (expected <iso>|<id>)");
  const createdAt = new Date(raw.slice(0, separator));
  const id = raw.slice(separator + 1);
  if (Number.isNaN(createdAt.getTime()) || id.length === 0) {
    throw validationFailed("Malformed cursor (expected <iso>|<id>)");
  }
  return { createdAt, id };
}

function parseBound(raw: string | null, name: string, fallback: Date | null): Date | null {
  if (!raw) return fallback;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) throw validationFailed(`Malformed ${name} timestamp`);
  return parsed;
}

export async function GET(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  try {
    const auth = await resolveExportAuth(request);
    const params = request.nextUrl.searchParams;

    const formatParam = (params.get("format") ?? "jsonl").toLowerCase();
    if (!["jsonl", "cef", "json", "splunk"].includes(formatParam)) {
      throw validationFailed("format must be jsonl, cef, json, or splunk");
    }
    const format = formatParam as ExportFormat;
    const since = parseBound(params.get("since"), "since", new Date(Date.now() - DEFAULT_SINCE_MS));
    const until = parseBound(params.get("until"), "until", null);
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, Number(params.get("limit") ?? DEFAULT_LIMIT) || DEFAULT_LIMIT),
    );
    const cursor = parseCursor(params.get("cursor"));

    const db = withOrgContext(prisma, auth.organizationId);
    const rows = await db.auditEvent.findMany({
      where: {
        organizationId: auth.organizationId,
        ...(since ? { createdAt: { gte: since, ...(until ? { lte: until } : {}) } } : {}),
        ...(cursor
          ? {
              OR: [
                { createdAt: { gt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { gt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    const lastCreatedAt =
      last && last.createdAt instanceof Date
        ? last.createdAt
        : last
          ? new Date(last.createdAt)
          : null;
    const nextCursor =
      hasMore && last && lastCreatedAt ? `${lastCreatedAt.toISOString()}|${last.id}` : null;

    const lines = page.map((event) =>
      format === "cef"
        ? formatAuditCef(event)
        : format === "splunk"
          ? JSON.stringify({
              time: Math.floor(new Date(event.createdAt).getTime() / 1000),
              event: normalizeAuditEvent(event),
              source: "patchbay",
            })
          : null,
    );
    const normalized = page.map((event) => normalizeAuditEvent(event));
    const body =
      format === "json"
        ? JSON.stringify(normalized)
        : format === "jsonl"
          ? normalized.map((event) => JSON.stringify(event)).join("\n")
          : lines.join("\n");
    const contentType =
      format === "cef"
        ? "text/plain; charset=utf-8"
        : format === "json"
          ? "application/json; charset=utf-8"
          : "application/x-ndjson; charset=utf-8";

    await writeAuditEvent({
      organizationId: auth.organizationId,
      actorType: auth.actorType,
      actorId: auth.actorId,
      action: AuditAction.AUDIT_LOG_EXPORTED,
      entityType: "audit_export",
      entityId: auth.organizationId,
      correlationId,
      after: {
        format,
        since: since?.toISOString() ?? null,
        until: until?.toISOString() ?? null,
        limit,
        eventCount: page.length,
        hasMore,
        via: auth.tokenPrefix ? "bearer-token" : "admin-session",
        ...(auth.tokenPrefix ? { tokenPrefix: auth.tokenPrefix } : {}),
      },
    });

    const signature = createHmac(
      "sha256",
      process.env.PATCH_REGISTRY_SIGNING_KEY ?? "dev-only-not-secure-change-in-production",
    )
      .update(`${auth.organizationId}\n${body}`)
      .digest("hex");

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        // Bounded pages (<=10k lines) stream in 64KB slices: constant memory
        // on the wire while the signature above covers the whole batch.
        for (let i = 0; i < body.length; i += 65536) {
          controller.enqueue(encoder.encode(body.slice(i, i + 65536)));
        }
        controller.close();
      },
    });

    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(stream, {
      headers: {
        "content-type": contentType,
        "content-disposition": `attachment; filename="patchbay-audit-${stamp}.${format === "cef" ? "cef" : format === "json" ? "json" : "jsonl"}"`,
        "x-patch-export-signature": signature,
        ...(nextCursor ? { "x-patch-export-next-cursor": nextCursor } : {}),
        "x-correlation-id": correlationId,
      },
    });
  } catch (error) {
    return jsonError(error, correlationId);
  }
}
