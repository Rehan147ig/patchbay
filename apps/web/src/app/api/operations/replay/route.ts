import { prisma } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import { ActorType, notFound, validationFailed } from "@patchbay/domain";
import { replayableJobTypeSchema } from "@patchbay/domain";
import { enqueue, type JobType } from "@patchbay/queue";
import { recordHttpDuration, withSpan } from "@patchbay/telemetry";
import { z } from "zod";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk, parseBody, writeAuditEvent } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { assertCsrfToken } from "@/lib/csrf-server";

/**
 * POST /api/operations/replay
 * Re-enqueue a terminally failed (OPEN) dead letter (WP10, spec §10).
 * ADMIN only: replaying executes customer-affecting work.
 *
 * Safety, in order:
 * 1. Closed job-type allowlist (scan-repository, run-validation, create-pr,
 *    graph-index) — anything else fails closed, never re-enqueued blindly.
 * 2. Entity-freshness guards: the entity the job would act on must still
 *    exist in the caller's org AND be in a replayable state (no delivered
 *    PR, no already-PASSED validation, no archived repository).
 * 3. Idempotency: the OPEN→REPLAYED transition is a single conditional
 *    update — the loser of a concurrent replay race gets a 422, and the
 *    BullMQ job id (`replay:<deadLetterId>`) dedupes transport retries.
 */
const replaySchema = z.object({ deadLetterId: z.string().min(1).max(100) });

function payloadField(payload: unknown, field: string): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const value = (payload as Record<string, unknown>)[field];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Verify the world still wants this job; throw 404/422 otherwise. */
async function assertReplayFresh(
  jobType: string,
  payload: unknown,
  organizationId: string,
): Promise<string[]> {
  if (jobType === "scan-repository" || jobType === "graph-index") {
    const repositoryId = payloadField(payload, "repositoryId");
    if (!repositoryId) throw validationFailed("Dead letter payload has no repositoryId");
    const repository = await prisma.repository.findFirst({
      where: { id: repositoryId, organizationId },
    });
    if (!repository) throw notFound("Repository not found; replay refused");
    if (repository.status !== "ACTIVE") {
      throw validationFailed(`Repository is ${repository.status}; replay refused`);
    }
    return [`repository ${repository.fullName} is ACTIVE`];
  }
  if (jobType === "run-validation") {
    const validationRunId = payloadField(payload, "validationRunId");
    const remediationPlanId = payloadField(payload, "remediationPlanId");
    if (!validationRunId || !remediationPlanId) {
      throw validationFailed("Dead letter payload is missing validation identifiers");
    }
    const run = await prisma.validationRun.findFirst({
      where: { id: validationRunId, organizationId },
    });
    if (!run) throw notFound("Validation run not found; replay refused");
    if (run.status === "PASSED" || run.status === "SKIPPED") {
      throw validationFailed(`Validation run is already ${run.status}; replay refused`);
    }
    const plan = await prisma.remediationPlan.findFirst({
      where: { id: remediationPlanId, organizationId },
    });
    if (!plan) throw notFound("Remediation plan not found; replay refused");
    return [`validation run is ${run.status}`, "remediation plan exists"];
  }
  // create-pr: the only remaining replayable type (enforced above).
  const remediationPlanId = payloadField(payload, "remediationPlanId");
  if (!remediationPlanId) {
    throw validationFailed("Dead letter payload has no remediationPlanId");
  }
  const plan = await prisma.remediationPlan.findFirst({
    where: { id: remediationPlanId, organizationId },
  });
  if (!plan) throw notFound("Remediation plan not found; replay refused");
  const existing = await prisma.pullRequest.findFirst({
    where: { remediationPlanId, organizationId },
  });
  if (existing) {
    throw validationFailed("A draft PR already exists for this plan; replay refused");
  }
  return ["remediation plan exists", "no draft PR delivered yet"];
}

export async function POST(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  const started = Date.now();
  try {
    assertCsrfToken(request);
    const user = await requireRole("ADMIN");
    const { deadLetterId } = await parseBody(request, replaySchema);

    const result = await withSpan(
      "http.operations.replay",
      {
        "http.route": "/api/operations/replay",
        "http.method": "POST",
        "org.id": user.organizationId,
      },
      async () => {
        const deadLetter = await prisma.deadLetterJob.findFirst({
          where: { id: deadLetterId, organizationId: user.organizationId },
        });
        if (!deadLetter) throw notFound("Dead letter not found");
        if (deadLetter.status !== "OPEN") {
          throw validationFailed(`Dead letter is already ${deadLetter.status}; replay refused`);
        }
        const parsedType = replayableJobTypeSchema.safeParse(deadLetter.jobType);
        if (!parsedType.success) {
          throw validationFailed(
            `Job type ${deadLetter.jobType} is not replayable; replay refused`,
          );
        }
        const jobType = parsedType.data;
        const freshnessChecks = await assertReplayFresh(
          jobType,
          deadLetter.payload,
          user.organizationId,
        );

        // Idempotent claim first, enqueue second: concurrent replays race
        // here and exactly one wins; the loser sees count 0 and gets a 422.
        const jobId = `replay:${deadLetter.id}`;
        const claimed = await prisma.deadLetterJob.updateMany({
          where: { id: deadLetter.id, status: "OPEN" },
          data: { status: "REPLAYED", replayedAt: new Date(), replayJobId: jobId },
        });
        if (claimed.count === 0) {
          throw validationFailed("Dead letter was replayed concurrently; replay refused");
        }
        const payload =
          typeof deadLetter.payload === "object" && deadLetter.payload !== null
            ? (deadLetter.payload as Record<string, unknown>)
            : {};
        const job = await enqueue(jobType as JobType, { ...payload, correlationId }, { jobId });
        await writeAuditEvent({
          organizationId: user.organizationId,
          actorType: ActorType.USER,
          actorId: user.id,
          action: AuditAction.JOB_REPLAYED,
          entityType: "deadLetterJob",
          entityId: deadLetter.id,
          correlationId,
          after: {
            jobType,
            jobId: job.id ?? jobId,
            previousCorrelationId: payloadField(payload, "correlationId"),
            freshnessChecks,
          },
        });
        return { deadLetterId: deadLetter.id, jobId: job.id ?? jobId, jobType };
      },
    );
    recordHttpDuration("/api/operations/replay", "POST", Date.now() - started);
    return jsonOk(result, correlationId, 202);
  } catch (error) {
    recordHttpDuration("/api/operations/replay", "POST", Date.now() - started);
    return jsonError(error, correlationId);
  }
}
