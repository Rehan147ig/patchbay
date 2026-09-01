import { prisma, withOrgContext } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import { ActorType } from "@patchbay/domain";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk, writeAuditEvent } from "@/lib/api";
import { requireRole } from "@/lib/auth";

/**
 * GET /api/audit/export — alias of /api/export with audit-centric path.
 * Admin-only JSONL export of the organization's audit trail + operational records.
 * Single audit event per export; respects RLS + withOrgContext tenant isolation.
 */
export async function GET(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  try {
    const user = await requireRole("ADMIN");
    const db = withOrgContext(prisma, user.organizationId);

    const [auditEvents, remediationCases, outcomes] = await Promise.all([
      db.auditEvent.findMany({
        where: { organizationId: user.organizationId },
        orderBy: { createdAt: "asc" },
        take: 10000,
      }),
      db.remediationCase.findMany({
        where: { organizationId: user.organizationId },
        orderBy: { createdAt: "asc" },
        take: 1000,
        select: { id: true, scopeKey: true, status: true, reasonCode: true, createdAt: true },
      }),
      db.prOutcome.findMany({
        where: { organizationId: user.organizationId },
        orderBy: { createdAt: "asc" },
        take: 1000,
      }),
    ]);

    await writeAuditEvent({
      organizationId: user.organizationId,
      actorType: ActorType.USER,
      actorId: user.id,
      action: AuditAction.DATA_EXPORTED,
      entityType: "audit_export",
      entityId: user.organizationId,
      correlationId,
      after: {
        counts: {
          auditEvents: auditEvents.length,
          cases: remediationCases.length,
          outcomes: outcomes.length,
        },
      },
    });

    const format = request.nextUrl.searchParams.get("format");
    // Stage 5C: SIEM formats — Splunk HEC JSON per event, CEF per event
    if (format === "splunk") {
      const body = auditEvents
        .map((e) =>
          JSON.stringify({
            time: Math.floor(e.createdAt.getTime() / 1000),
            event: e,
            source: "patchbay",
          }),
        )
        .join("\n");
      return new Response(body, {
        headers: {
          "content-type": "application/x-ndjson",
          "x-patch-signed-export": await signExport(body),
          "x-correlation-id": correlationId,
        },
      });
    }
    if (format === "cef") {
      const body = auditEvents
        .map(
          (e) =>
            `CEF:0|Patchbay|Audit|1.0|${e.action}|${e.entityType} ${e.entityId ?? ""}|5|src=${e.actorId ?? "system"} msg=${(e.afterJson as Record<string, unknown> | null)?.toString?.() ?? ""}`,
        )
        .join("\n");
      return new Response(body, {
        headers: {
          "content-type": "text/plain",
          "x-patch-signed-export": await signExport(body),
          "x-correlation-id": correlationId,
        },
      });
    }

    const payload = {
      exportedAt: new Date().toISOString(),
      organizationId: user.organizationId,
      counts: {
        auditEvents: auditEvents.length,
        cases: remediationCases.length,
        outcomes: outcomes.length,
      },
      data: { auditEvents, remediationCases, outcomes },
    };
    const body = JSON.stringify(payload);
    const res = jsonOk(payload, correlationId);
    res.headers.set("x-patch-signed-export", await signExport(body));
    return res;
  } catch (error) {
    return jsonError(error, correlationId);
  }
}

async function signExport(body: string): Promise<string> {
  try {
    const { createHmac } = await import("node:crypto");
    const key =
      process.env.PATCH_REGISTRY_SIGNING_KEY ?? "dev-only-not-secure-change-in-production";
    return createHmac("sha256", key).update(body).digest("hex").slice(0, 32);
  } catch {
    return "unsigned";
  }
}
