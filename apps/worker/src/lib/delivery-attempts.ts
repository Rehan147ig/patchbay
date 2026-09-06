import { prisma } from "@patchbay/db";
import { deliveryActionSchema, type DeliveryAction, type DeliveryStatus } from "@patchbay/domain";

/**
 * Idempotent delivery ledger (WP9, spec §19/§12). The stable idempotency key
 * makes the FIRST writer win: BullMQ retries and worker crashes adopt or
 * observe the winner instead of delivering twice. Provider-side branch/PR
 * dedup is only the second layer; the ledger is the guarantee.
 */

export interface ClaimDeliveryInput {
  organizationId: string;
  remediationPlanId: string;
  pullRequestId?: string | null;
  idempotencyKey: string;
  action: DeliveryAction;
}

export type ClaimDeliveryOutcome =
  | { duplicate: false; attemptId: string }
  | {
      duplicate: true;
      attempt: {
        id: string;
        status: string;
        pullRequestId: string | null;
        externalId: string | null;
        url: string | null;
      };
    };

function isUniqueConflict(error: unknown): boolean {
  return (error as { code?: unknown }).code === "P2002";
}

/**
 * Claim the delivery key. First writer creates IN_PROGRESS and proceeds;
 * losers observe the winner: SUCCEEDED → return it (no second delivery),
 * IN_PROGRESS → retryable throw (another worker is delivering), FAILED →
 * adopt the row (attemptCount+1) and proceed.
 */
export async function claimDeliveryAttempt(
  input: ClaimDeliveryInput,
): Promise<ClaimDeliveryOutcome> {
  const action = deliveryActionSchema.parse(input.action);
  try {
    const created = await prisma.deliveryAttempt.create({
      data: {
        organizationId: input.organizationId,
        remediationPlanId: input.remediationPlanId,
        pullRequestId: input.pullRequestId ?? null,
        idempotencyKey: input.idempotencyKey,
        action,
        status: "IN_PROGRESS",
        attemptCount: 1,
      },
    });
    return { duplicate: false, attemptId: created.id };
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
  }
  // Lost the race: observe the winner. A missing winner means the row
  // vanished between conflict and read — retryable, never a silent success.
  const winner = await prisma.deliveryAttempt.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (!winner) {
    throw new Error(
      `delivery ledger conflict without a winner for ${input.idempotencyKey}; retrying`,
    );
  }
  if (winner.status === "SUCCEEDED") {
    return {
      duplicate: true,
      attempt: {
        id: winner.id,
        status: winner.status,
        pullRequestId: winner.pullRequestId,
        externalId: winner.externalId,
        url: winner.url,
      },
    };
  }
  if (winner.status === "IN_PROGRESS") {
    throw new Error(`delivery already in progress for ${input.idempotencyKey}; retrying later`);
  }
  const adopted = await prisma.deliveryAttempt.update({
    where: { id: winner.id },
    data: {
      status: "IN_PROGRESS",
      attemptCount: winner.attemptCount + 1,
      errorCode: null,
      errorMessage: null,
      pullRequestId: input.pullRequestId ?? winner.pullRequestId,
    },
  });
  return { duplicate: false, attemptId: adopted.id };
}

export interface CompleteDeliveryInput {
  status: Extract<DeliveryStatus, "SUCCEEDED" | "FAILED">;
  pullRequestId?: string | null;
  externalId?: string | null;
  url?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}

/** Terminal write for a claimed attempt; error detail is bounded. */
export async function completeDeliveryAttempt(
  attemptId: string,
  result: CompleteDeliveryInput,
): Promise<void> {
  await prisma.deliveryAttempt.update({
    where: { id: attemptId },
    data: {
      status: result.status,
      pullRequestId: result.pullRequestId ?? null,
      externalId: result.externalId ?? null,
      url: result.url ?? null,
      errorCode: result.errorCode ?? null,
      errorMessage: result.errorMessage?.slice(0, 2000) ?? null,
    },
  });
}

/**
 * Best-effort single-shot attempt (check runs, comments): creates the row
 * directly; a key conflict means an identical report already landed, so the
 * duplicate is skipped instead of re-posting.
 */
export async function recordBestEffortAttempt(input: {
  organizationId: string;
  remediationPlanId: string;
  pullRequestId?: string | null;
  idempotencyKey: string;
  action: DeliveryAction;
  status: Extract<DeliveryStatus, "SUCCEEDED" | "FAILED">;
  externalId?: string | null;
  url?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}): Promise<{ recorded: boolean; attemptId: string | null }> {
  const action = deliveryActionSchema.parse(input.action);
  try {
    const created = await prisma.deliveryAttempt.create({
      data: {
        organizationId: input.organizationId,
        remediationPlanId: input.remediationPlanId,
        pullRequestId: input.pullRequestId ?? null,
        idempotencyKey: input.idempotencyKey,
        action,
        status: input.status,
        attemptCount: 1,
        externalId: input.externalId ?? null,
        url: input.url ?? null,
        errorCode: input.errorCode ?? null,
        errorMessage: input.errorMessage?.slice(0, 2000) ?? null,
      },
    });
    return { recorded: true, attemptId: created.id };
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
    return { recorded: false, attemptId: null };
  }
}

/**
 * Classify a delivery failure for the ledger. GitHubApiError is matched by
 * name/code (never instanceof — the provider ships as a separate bundle and
 * cross-package instanceof is unreliable).
 */
export function classifyDeliveryError(error: unknown): string {
  const record = error as { name?: unknown; code?: unknown; message?: unknown };
  if (record && record.name === "GitHubApiError" && typeof record.code === "string") {
    return record.code;
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/blocked by policy decision/i.test(message)) return "POLICY_BLOCKED";
  if (/maximum concurrent draft PR|quota|throttled/i.test(message)) return "PR_SLOT_THROTTLED";
  if (/safety unavailable|safety mechanism unreachable/i.test(message))
    return "PR_SLOT_UNAVAILABLE";
  if (/already in progress|without a winner/i.test(message)) return "DELIVERY_IN_PROGRESS";
  if (/not certified for DRAFT_PR/i.test(message)) return "CONNECTOR_UNCERTIFIED";
  if (/capability gate/i.test(message)) return "CAPABILITY_GATE_CLOSED";
  return "DELIVERY_FAILED";
}
