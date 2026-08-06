import { prisma, type Prisma } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import { ActorType, notFound, unauthorized, validationFailed } from "@patchbay/domain";
import { agentIngestSchema } from "@patchbay/domain";
import { getConnector } from "@patchbay/vendor-connectors";
import { JobType, queue } from "@patchbay/queue";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk, parseBody, writeAuditEvent } from "@/lib/api";
import { verifyAgentKey } from "@/lib/agent-keys";

/**
 * POST /api/vendors/:slug/events
 *
 * Provider-agent ingest: a vendor signs change events with its agent API key
 * (Authorization: Bearer <key>) and Patchbay normalizes them through the
 * vendor's connector, persists the event + normalizations, and enqueues impact
 * analysis — the per-provider agent mode of the platform.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const correlationId = getCorrelationId(request);
  try {
    const { slug } = await params;
    const authorization = request.headers.get("authorization");
    const providedKey = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
    if (!providedKey) throw unauthorized("Agent API key required (Authorization: Bearer <key>)");

    const vendor = await prisma.vendor.findUnique({ where: { slug } });
    if (!vendor) throw notFound(`Vendor "${slug}" is not in the catalog`);
    if (!vendor.organizationId || !vendor.agentKeyHash) {
      throw unauthorized(`Agent mode is not enabled for vendor "${slug}"`);
    }
    if (!verifyAgentKey(providedKey, vendor.agentKeyHash)) {
      throw unauthorized("Invalid agent API key");
    }

    const input = await parseBody(request, agentIngestSchema);
    const connector = getConnector(slug);
    if (!connector) throw validationFailed(`No connector is registered for vendor "${slug}"`);

    const drafts = connector.normalizeChange({
      rawPayload: input.rawPayload,
      sourceType: input.sourceType,
    });
    if (drafts.length === 0) {
      throw validationFailed(
        `Connector "${slug}" could not normalize the submitted payload into a change`,
      );
    }

    const event = await prisma.vendorChangeEvent.create({
      data: {
        vendorId: vendor.id,
        organizationId: vendor.organizationId ?? undefined,
        externalReference: input.externalReference,
        sourceType: input.sourceType,
        sourceUrl: input.sourceUrl,
        title: `${vendor.name} agent change: ${drafts.map((d) => d.changeType).join(", ")}`,
        severity: input.severity,
        status: "DETECTED",
        rawPayload: input.rawPayload as Prisma.InputJsonValue,
      },
    });

    for (const draft of drafts) {
      await prisma.normalizedChange.create({
        data: {
          changeEventId: event.id,
          changeType: draft.changeType,
          oldValue: draft.oldValue,
          newValue: draft.newValue,
          description: draft.description,
          breaking: draft.breaking,
          evidence: (draft.evidence ?? {}) as Prisma.InputJsonValue,
        },
      });
    }

    await queue.add(JobType.ANALYZE_CHANGE, {
      changeEventId: event.id,
      organizationId: vendor.organizationId,
      correlationId,
    });

    await writeAuditEvent({
      organizationId: vendor.organizationId,
      actorType: ActorType.AGENT,
      actorId: `agent:${slug}`,
      action: AuditAction.AGENT_EVENT_RECEIVED,
      entityType: "vendorChangeEvent",
      entityId: event.id,
      correlationId,
      after: {
        vendorSlug: slug,
        title: event.title,
        changeCount: drafts.length,
        breakingCount: drafts.filter((d) => d.breaking).length,
      },
    });

    return jsonOk(
      { changeEventId: event.id, status: "QUEUED", normalizations: drafts.length },
      correlationId,
      201,
    );
  } catch (error) {
    return jsonError(error, correlationId);
  }
}
