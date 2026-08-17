import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/**
 * Stripe webhook signature verification (HMAC-SHA256) and event parsing.
 *
 * Stripe signs every webhook delivery as `t=<unix_seconds>,v1=<hex_hmac>`
 * where the HMAC is over `<timestamp>.<raw_body>`. Verification is
 * constant-time; a freshness window guards against replay.
 */

export const STRIPE_SIGNATURE_TOLERANCE_MS = 5 * 60 * 1000;

export function parseStripeSignatureHeader(header: string): {
  timestamp: number | null;
  signature: string | null;
} {
  let timestamp: number | null = null;
  let signature: string | null = null;
  for (const part of header.split(",")) {
    const [key, ...rest] = part.trim().split("=");
    const value = rest.join("=");
    if (key === "t" && timestamp === null) {
      const parsed = Number(value);
      timestamp = Number.isFinite(parsed) ? parsed : null;
    } else if (key === "v1") {
      signature = value; // last v1 wins (Stripe rotates keys)
    }
  }
  return { timestamp, signature };
}

/** Constant-time check of a Stripe signature header against the raw body. */
export function verifyStripeWebhookSignature(
  payload: string,
  signatureHeader: string,
  secret: string,
  nowMs: number = Date.now(),
  toleranceMs: number = STRIPE_SIGNATURE_TOLERANCE_MS,
): boolean {
  if (!secret) return false;
  const { timestamp, signature } = parseStripeSignatureHeader(signatureHeader);
  if (timestamp === null || signature === null) return false;
  if (!/^[0-9a-f]{64}$/i.test(signature)) return false;
  if (Math.abs(nowMs - timestamp * 1000) > toleranceMs) return false;

  const expected = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  const receivedBuffer = Buffer.from(signature, "hex");
  return (
    expectedBuffer.length === receivedBuffer.length &&
    timingSafeEqual(expectedBuffer, receivedBuffer)
  );
}

const StripeEventObject = z.object({
  id: z.string().min(1),
  client_reference_id: z.string().nullable().optional(),
  customer: z.string().nullable().optional(),
  subscription: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.string()).nullable().optional(),
  status: z.string().optional(),
  current_period_end: z.number().nullable().optional(),
  items: z
    .object({
      data: z.array(z.object({ price: z.object({ id: z.string() }).optional() }).optional()),
    })
    .optional(),
});

/** Typed Stripe webhook events Patchbay consumes. */
export const stripeEventSchema = z.discriminatedUnion("type", [
  z.object({
    id: z.string().min(1),
    type: z.literal("checkout.session.completed"),
    data: z.object({ object: StripeEventObject }),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("customer.subscription.updated"),
    data: z.object({ object: StripeEventObject }),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("customer.subscription.deleted"),
    data: z.object({ object: StripeEventObject }),
  }),
]);

export type StripeEvent = z.infer<typeof stripeEventSchema>;
export type StripeEventType = StripeEvent["type"];

export type SubscriptionStatus = "ACTIVE" | "PAST_DUE" | "CANCELED";

/**
 * Maps a Stripe subscription status onto Patchbay's SubscriptionStatus.
 * Anything not actively billing (canceled, unpaid beyond grace, incomplete,
 * paused) is treated as canceled so paid capacity is never granted by a
 * stale webhook.
 */
export function subscriptionStatusFromStripe(stripeStatus: string): SubscriptionStatus {
  if (stripeStatus === "active") return "ACTIVE";
  if (stripeStatus === "past_due" || stripeStatus === "unpaid") return "PAST_DUE";
  return "CANCELED";
}

export function parseStripeEvent(payload: string): StripeEvent {
  let raw: unknown;
  try {
    raw = JSON.parse(payload);
  } catch {
    throw new Error("Stripe webhook payload is not valid JSON");
  }
  const parsed = stripeEventSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Unsupported Stripe webhook event: ${parsed.error.message}`);
  }
  return parsed.data;
}
