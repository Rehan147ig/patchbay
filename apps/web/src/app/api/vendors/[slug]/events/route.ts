import { prisma, Prisma } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import {
  ActorType,
  ChangeType,
  badRequest,
  notFound,
  payloadTooLarge,
  tooManyRequests,
  unauthorized,
  validationFailed,
} from "@patchbay/domain";
import { agentIngestSchema, boundRawPayload } from "@patchbay/domain";
import { getConnector } from "@patchbay/vendor-connectors";
import { enqueue, JobType } from "@patchbay/queue";
import type { NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { getCorrelationId, jsonError, jsonOk, parseBodyBounded, writeAuditEvent } from "@/lib/api";
import { hashAgentKey, verifyAgentKey } from "@/lib/agent-keys";
import { checkGlobalRateLimit, checkRateLimit } from "@/lib/rate-limit";

const MAX_AGENT_BODY_BYTES = 256 * 1024;

/**
 * Decoy argon2id verification for requests rejected before key comparison
 * (unknown slug, agent mode disabled). Hashing is deliberately expensive, so
 * without this the response latency would reveal whether a slug exists and has
 * agent mode enabled. The result is always ignored.
 */
const DECOY_KEY_VERIFY = hashAgentKey(`pb_agent_decoy_${randomBytes(24).toString("base64url")}`);

async function burnDecoyVerification(providedKey: string): Promise<void> {
  try {
    await verifyAgentKey(providedKey, await DECOY_KEY_VERIFY);
  } catch {
    // Never surfaces: the outcome is discarded either way.
  }
}

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

    // Rate limits run BEFORE argon2id verification: hashing is deliberately
    // expensive (32 MiB, cost 3), so an unauthenticated flood must be rejected
    // by the cheap counters first, never by burning CPU/memory on verify.
    const globalRate = await checkGlobalRateLimit();
    if (!globalRate.allowed) {
      throw tooManyRequests("Agent rate limit exceeded");
    }

    const vendor = await prisma.vendor.findUnique({ where: { slug } });
    if (!vendor) {
      await burnDecoyVerification(providedKey);
      throw notFound(`Vendor "${slug}" is not in the catalog`);
    }
    if (!vendor.organizationId || !vendor.agentKeyHash) {
      await burnDecoyVerification(providedKey);
      throw unauthorized(`Agent mode is not enabled for vendor "${slug}"`);
    }
    const rate = await checkRateLimit(`agent:${vendor.organizationId}:${slug}`);
    if (!rate.allowed) {
      throw tooManyRequests("Agent rate limit exceeded");
    }
    const keyValid =
      (await verifyAgentKey(providedKey, vendor.agentKeyHash)) ||
      (vendor.agentKeyHashPrevious
        ? await verifyAgentKey(providedKey, vendor.agentKeyHashPrevious)
        : false);
    if (!keyValid) {
      throw unauthorized("Invalid agent API key");
    }

    const input = await parseBodyBounded(request, agentIngestSchema, MAX_AGENT_BODY_BYTES);

    // Bound the untrusted payload before it reaches normalizers or storage:
    // caps nesting depth and serialized size so deep/large JSON cannot blow
    // the connector stack or the UI renderer.
    const rawPayload = boundRawPayload(input.rawPayload);
    if (rawPayload === null || typeof rawPayload !== "object") {
      throw validationFailed("Payload must be a JSON object");
    }

    const connector = getConnector(slug);
    let drafts: Array<{
      changeType: ChangeType;
      oldValue?: string;
      newValue?: string;
      description?: string;
      breaking: boolean;
      affectedSymbols: string[];
      evidence?: Record<string, unknown>;
    }>;

    if (connector) {
      drafts = connector
        .normalizeChange({
          rawPayload: rawPayload as Prisma.InputJsonValue,
          sourceType: input.sourceType,
        })
        .map((d) => ({
          changeType: d.changeType,
          oldValue: d.oldValue,
          newValue: d.newValue,
          description: d.description,
          breaking: d.breaking,
          affectedSymbols: d.affectedSymbols,
          evidence: d.evidence,
        }));
    } else if (vendor.organizationId !== null) {
      // Private vendor without a catalog connector: accept the payload as a
      // generic change event at ASSESS level. The event is stored and visible
      // in the dashboard but cannot produce certified patches (no rule pack).
      drafts = [
        {
          changeType: ChangeType.SDK_VERSION_UPGRADE,
          description:
            typeof input.rawPayload === "object" &&
            input.rawPayload !== null &&
            "description" in input.rawPayload &&
            typeof (input.rawPayload as Record<string, unknown>).description === "string"
              ? ((input.rawPayload as Record<string, unknown>).description as string)
              : `Private vendor ${vendor.name} reported a change.`,
          breaking: input.severity === "HIGH" || input.severity === "CRITICAL",
          affectedSymbols: [],
        },
      ];
    } else {
      throw validationFailed(`No connector is registered for shared catalog vendor "${slug}"`);
    }

    if (drafts.length === 0) {
      throw validationFailed(
        `Connector "${slug}" could not normalize the submitted payload into a change`,
      );
    }

    const eventTitle = connector
      ? `${vendor.name} agent change: ${drafts.map((d) => d.changeType).join(", ")}`
      : `${vendor.name} private change: ${input.sourceType}`;

    // Ingest idempotency: (organizationId, vendorId, externalReference) is
    // unique. A retried/replayed delivery with the same external reference
    // returns the original event instead of creating duplicates.
    let event;
    try {
      event = await prisma.vendorChangeEvent.create({
        data: {
          vendorId: vendor.id,
          organizationId: vendor.organizationId ?? undefined,
          externalReference: input.externalReference,
          sourceType: input.sourceType,
          sourceUrl: input.sourceUrl,
          title: eventTitle,
          severity: input.severity,
          status: "DETECTED",
          rawPayload: rawPayload as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") ||
        !input.externalReference
      ) {
        throw error;
      }
      const existing = await prisma.vendorChangeEvent.findFirst({
        where: {
          organizationId: vendor.organizationId,
          vendorId: vendor.id,
          externalReference: input.externalReference,
        },
        select: { id: true, status: true },
      });
      return jsonOk(
        {
          changeEventId: existing?.id ?? null,
          status: "DUPLICATE",
          normalizations: 0,
        },
        correlationId,
        200,
      );
    }

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

    await enqueue(JobType.ANALYZE_CHANGE, {
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
