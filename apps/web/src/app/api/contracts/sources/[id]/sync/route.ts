import { prisma } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import { ActorType, notFound, validationFailed } from "@patchbay/domain";
import { enqueue, JobType, queue } from "@patchbay/queue";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk, writeAuditEvent } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { assertCsrfToken } from "@/lib/csrf-server";

/**
 * POST /api/contracts/sources/[id]/sync
 * "Sync Now" for one contract source (WP12 §11.2). Idempotent: the BullMQ
 * job id pins the source + UTC hour, so double-clicks and retries collapse
 * onto one poll instead of stampeding the registry.
 *
 * Only SDK (npm-registry) sources have a producer today
 * (POLL_NPM_REGISTRY per vendorSlug); every other kind fails closed with a
 * clear message rather than pretending to sync. Note the poll itself is
 * registry-wide and read-only — per-org change events still flow through
 * the normal pipeline.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(request);
  try {
    assertCsrfToken(request);
    const user = await requireRole("MEMBER");
    const { id } = await params;
    const source = await prisma.contractSource.findFirst({
      where: {
        id,
        OR: [{ organizationId: null }, { organizationId: user.organizationId }],
      },
    });
    if (!source) {
      throw notFound("Contract source not found");
    }
    if (source.kind !== "SDK") {
      throw validationFailed(
        `No sync producer serves ${source.kind} sources yet (npm-registry poll covers SDK); sync refused`,
      );
    }
    const now = new Date();
    const hourBucket = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}${String(now.getUTCHours()).padStart(2, "0")}`;
    const jobId = `contract-sync:${source.id}:${hourBucket}`;
    const existing = await queue.getJob(jobId);
    if (existing) {
      return jsonOk(
        { sourceId: source.id, jobId, status: "QUEUED", duplicate: true },
        correlationId,
        202,
      );
    }
    const job = await enqueue(
      JobType.POLL_NPM_REGISTRY,
      { vendorSlug: source.vendorSlug, correlationId },
      { jobId },
    );
    await writeAuditEvent({
      organizationId: user.organizationId,
      actorType: ActorType.USER,
      actorId: user.id,
      action: AuditAction.CONTRACT_SOURCE_SYNCED,
      entityType: "contractSource",
      entityId: source.id,
      correlationId,
      after: { vendorSlug: source.vendorSlug, kind: source.kind, jobId: job.id ?? jobId },
    });
    return jsonOk(
      { sourceId: source.id, jobId: job.id ?? jobId, status: "QUEUED", duplicate: false },
      correlationId,
      202,
    );
  } catch (error) {
    return jsonError(error, correlationId);
  }
}
