import { prisma, type Prisma } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import {
  ActorType,
  badRequest,
  notFound,
  payloadTooLarge,
  unauthorized,
  validationFailed,
} from "@patchbay/domain";
import { agentIngestSchema } from "@patchbay/domain";
import { getConnector } from "@patchbay/vendor-connectors";
import { JobType, queue } from "@patchbay/queue";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk, parseBodyBounded, writeAuditEvent } from "@/lib/api";
import { verifyAgentKey } from "@/lib/agent-keys";
import { checkRateLimit } from "@/lib/rate-limit";

const MAX_AGENT_BODY_BYTES = 256 * 1024;

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
    // Content-Length is advisory, never trusted: it must be a plain integer
    // (reject NaN/negative/`Infinity` forms), and the real enforcement is the
    // byte cap on the streamed body below.
    const contentLengthHeader = request.headers.get("content-length");
    if (contentLengthHeader !== null && contentLengthHeader.trim() !== "") {
      if (!/^\d+$/.test(contentLengthHeader.trim())) {
        throw badRequest("Content-Length must be a non-negative integer");
      }
      if (Number(contentLengthHeader.trim()) > MAX_AGENT_BODY_BYTES) {
        throw payloadTooLarge("Agent payload exceeds the 256 KB limit");
      }
    }
    const authorization = request.headers.get("authorization");
    const providedKey = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
    if (!providedKey) throw unauthorized("Agent API key required (Authorization: Bearer <key>)");

    const vendor = await prisma.vendor.findUnique({ where: { slug } });
    if (!vendor) throw notFound(`Vendor "${slug}" is not in the catalog`);
    if (!vendor.organizationId || !vendor.agentKeyHash) {
      throw unauthorized(`Agent mode is not enabled for vendor "${slug}"`);
    }
    const keyValid =
      (await verifyAgentKey(providedKey, vendor.agentKeyHash)) ||
      (vendor.agentKeyHashPrevious
        ? await verifyAgentKey(providedKey, vendor.agentKeyHashPrevious)
        : false);
    if (!keyValid) {
      throw unauthorized("Invalid agent API key");
    }
    const rate = checkRateLimit(`agent:${vendor.organizationId}:${slug}`);
    if (!rate.allowed) {
      throw unauthorized("Agent rate limit exceeded");
    }

    const input = await parseBodyBounded(request, agentIngestSchema, MAX_AGENT_BODY_BYTES);
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
