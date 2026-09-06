import { z } from "zod";

/**
 * Delivery ledger vocabulary (WP9, spec §19/§12). Stored as plain strings on
 * DeliveryAttempt (no Prisma enum to drift); every write goes through these
 * schemas so the ledger can never hold an unclassified action or status.
 */

export const deliveryActionSchema = z.enum(["CREATE", "UPDATE", "CHECK_RUN", "COMMENT"]);
export type DeliveryAction = z.infer<typeof deliveryActionSchema>;

export const deliveryStatusSchema = z.enum(["IN_PROGRESS", "SUCCEEDED", "FAILED"]);
export type DeliveryStatus = z.infer<typeof deliveryStatusSchema>;

/** Stable idempotency keys: retries reuse the key, so the first writer wins. */
export function createDeliveryKey(action: DeliveryAction, remediationKey: string): string {
  return `create:${remediationKey}`;
}

export function updateDeliveryKey(remediationPlanId: string): string {
  return `update:${remediationPlanId}`;
}

export function checkRunDeliveryKey(remediationPlanId: string, headSha: string): string {
  return `checkrun:${remediationPlanId}:${headSha.slice(0, 12)}`;
}

export function commentDeliveryKey(remediationPlanId: string, purpose: string): string {
  return `comment:${remediationPlanId}:${purpose}`;
}
