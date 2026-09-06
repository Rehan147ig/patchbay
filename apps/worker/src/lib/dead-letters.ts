import { createHash } from "node:crypto";
import { prisma } from "@patchbay/db";
import { sanitizeText } from "@patchbay/audit";
import { canonicalJson } from "@patchbay/vendor-connectors";

/**
 * Persistent dead-letter recording (WP10, spec §10). Called once per
 * terminally failed job (attempts exhausted) from the failure handler — never
 * per attempt, so retries don't spam the table.
 *
 * Redaction first: the payload is serialized, scrubbed with the same
 * secret-pattern sanitizer as audit events, and only then hashed and stored.
 * The idempotency key makes repeats refresh the row instead of duplicating
 * it; every step throws loudly to the caller's best-effort wrapper (which
 * logs and continues — recording must never break alerting/audit).
 */

export interface DeadLetterRecordInput {
  organizationId: string;
  jobType: string;
  jobId?: string | null;
  payload: Record<string, unknown>;
  errorCode?: string | null;
  errorMessage?: string | null;
  attemptsMade: number;
  correlationId?: string | null;
}

/** Scrub secret-looking values out of a structured payload (round-trips JSON). */
export function redactPayload(payload: Record<string, unknown>): Record<string, unknown> {
  try {
    const scrubbed = sanitizeText(JSON.stringify(payload));
    const parsed: unknown = JSON.parse(scrubbed);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { redactedPayload: scrubbed.slice(0, 8000) };
  } catch {
    return { unserializablePayload: true };
  }
}

export function deadLetterPayloadHash(redacted: Record<string, unknown>): string {
  return createHash("sha256").update(canonicalJson(redacted)).digest("hex");
}

/** Stable key: the BullMQ id when present, otherwise the payload hash. */
export function deadLetterKey(jobType: string, jobId: string | null, payloadHash: string): string {
  return `dlq:${jobType}:${jobId ?? payloadHash.slice(0, 16)}`;
}

function isUniqueConflict(error: unknown): boolean {
  return (error as { code?: unknown }).code === "P2002";
}

export async function recordDeadLetterJob(
  input: DeadLetterRecordInput,
): Promise<{ id: string; created: boolean }> {
  const redacted = redactPayload(input.payload);
  const payloadHash = deadLetterPayloadHash(redacted);
  const idempotencyKey = deadLetterKey(input.jobType, input.jobId ?? null, payloadHash);
  // Sanitize again at the boundary: callers pass already-redacted text, but
  // the ledger must never depend on upstream hygiene.
  const errorMessage = input.errorMessage ? sanitizeText(input.errorMessage).slice(0, 2000) : null;
  try {
    const created = await prisma.deadLetterJob.create({
      data: {
        organizationId: input.organizationId,
        jobType: input.jobType,
        jobId: input.jobId ?? null,
        idempotencyKey,
        payload: redacted as never,
        payloadHash,
        errorCode: input.errorCode ?? null,
        errorMessage,
        attemptsMade: input.attemptsMade,
        correlationId: input.correlationId ?? null,
        status: "OPEN",
      },
    });
    return { id: created.id, created: true };
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
  }
  // Refresh the existing row: same terminal failure recurring carries a new
  // message/attempt count, but it is still one dead letter, not two.
  const winner = await prisma.deadLetterJob.findUnique({ where: { idempotencyKey } });
  if (!winner) {
    throw new Error(`dead-letter conflict without a winner for ${idempotencyKey}`);
  }
  const refreshed = await prisma.deadLetterJob.update({
    where: { id: winner.id },
    data: {
      payload: redacted as never,
      payloadHash,
      errorCode: input.errorCode ?? null,
      errorMessage,
      attemptsMade: input.attemptsMade,
      correlationId: input.correlationId ?? null,
    },
  });
  return { id: refreshed.id, created: false };
}
