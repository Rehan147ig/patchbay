import { prisma, type Prisma, withOrgContext } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import { notFound, vendorChangeCreateSchema } from "@patchbay/domain";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk, parseBody, writeAuditEvent } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { assertCsrfToken } from "@/lib/csrf";

export async function GET(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  try {
    const user = await requireRole("VIEWER");
    const db = withOrgContext(prisma, user.organizationId);
    const events = await db.vendorChangeEvent.findMany({
      where: { organizationId: user.organizationId },
      orderBy: [{ status: "asc" }, { detectedAt: "desc" }],
      include: { vendor: true, normalizations: true },
      take: 100,
    });
    return jsonOk({ events }, correlationId);
  } catch (error) {
    return jsonError(error, correlationId);
  }
}

export async function POST(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  try {
    assertCsrfToken(request);
    const user = await requireRole("MEMBER");
    const input = await parseBody(request, vendorChangeCreateSchema);

    const vendor = await prisma.vendor.findUnique({ where: { slug: input.vendorSlug } });
    if (!vendor) throw notFound(`Vendor "${input.vendorSlug}" is not in the catalog`);

    const event = await prisma.vendorChangeEvent.create({
      data: {
        vendorId: vendor.id,
        organizationId: user.organizationId,
        externalReference: input.externalReference,
        sourceType: input.sourceType,
        effectiveAt: input.effectiveAt ? new Date(input.effectiveAt) : null,
        title: input.title,
        sourceUrl: input.sourceUrl,
        rawPayload: (input.rawPayload ?? {}) as Prisma.InputJsonValue,
        severity: input.severity,
        status: "DETECTED",
      },
    });

    await writeAuditEvent({
      organizationId: user.organizationId,
      actorType: "USER",
      actorId: user.id,
      action: AuditAction.CHANGE_DETECTED,
      entityType: "vendorChangeEvent",
      entityId: event.id,
      correlationId,
      after: { title: event.title, vendorSlug: vendor.slug, sourceType: event.sourceType },
    });

    return jsonOk({ event }, correlationId, 201);
  } catch (error) {
    return jsonError(error, correlationId);
  }
}
