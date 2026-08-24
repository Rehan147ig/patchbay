import { z } from "zod";
import { enqueue, JobType } from "@patchbay/queue";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk, parseBodyBounded, writeAuditEvent } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { assertCsrfToken } from "@/lib/csrf-server";

const detectRequestSchema = z.object({
  adapterSlugs: z.array(z.string().min(1).max(64)).max(32).optional(),
});

/**
 * POST /api/watchtower/detect
 * Triggers a detection run across all configured Watchtower adapters
 * (npm registry, GitHub releases, OpenAPI specs).
 */
export async function POST(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  try {
    assertCsrfToken(request);
    const user = await requireRole("ADMIN");

    const body = await parseBodyBounded(request, detectRequestSchema, 16 * 1024);
    const adapterSlugs = body.adapterSlugs;

    await enqueue(JobType.DETECT_RELEASES, {
      adapterSlugs,
      correlationId,
    });

    await writeAuditEvent({
      organizationId: user.organizationId,
      actorType: "USER",
      actorId: user.id,
      action: "detection.run.started",
      entityType: "detectionRun",
      entityId: "bulk",
      correlationId,
      after: { adapterSlugs },
    });

    return jsonOk({ status: "queued", adapterSlugs }, correlationId, 202);
  } catch (error) {
    return jsonError(error, correlationId);
  }
}
