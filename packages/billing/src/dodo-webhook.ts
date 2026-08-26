import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/**
 * Dodo webhook verification — mirrors Stripe shape but uses Dodo headers:
 *   webhook-id, webhook-signature (v1,<base64>), webhook-timestamp
 * HMAC-SHA256 over "<webhook-id>.<webhook-timestamp>.<raw_body>"
 * See `skills/webhook-integration/SKILL.md` in @dodopayments/opencode-plugin.
 */
export const DODO_SIGNATURE_TOLERANCE_MS = 5 * 60 * 1000;

export function verifyDodoWebhookSignature(
  payload: string,
  headers: {
    webhookId: string | null;
    webhookSignature: string | null;
    webhookTimestamp: string | null;
  },
  secret: string,
  nowMs: number = Date.now(),
  toleranceMs: number = DODO_SIGNATURE_TOLERANCE_MS,
): boolean {
  if (!secret || !headers.webhookId || !headers.webhookSignature || !headers.webhookTimestamp)
    return false;
  const timestamp = Number(headers.webhookTimestamp);
  if (!Number.isFinite(timestamp)) return false;
  if (Math.abs(nowMs - timestamp * 1000) > toleranceMs) return false;

  // header format: "v1,<base64>"
  const sigPart = headers.webhookSignature.split(",").find((p) => p.trim().startsWith("v1,"));
  if (!sigPart) return false;
  const b64 = sigPart.trim().slice(3);
  if (!b64) return false;

  const signed = `${headers.webhookId}.${headers.webhookTimestamp}.${payload}`;
  const expected = createHmac("sha256", secret).update(signed).digest("base64");
  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(b64);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export const dodoEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("payment.succeeded"),
    data: z
      .object({ payload_type: z.string().optional(), payment_id: z.string().optional() })
      .passthrough(),
  }),
  z.object({
    type: z.literal("subscription.active"),
    data: z
      .object({ payload_type: z.string().optional(), subscription_id: z.string().optional() })
      .passthrough(),
  }),
  z.object({
    type: z.literal("subscription.renewed"),
    data: z.object({ payload_type: z.string().optional() }).passthrough(),
  }),
  z.object({ type: z.literal("subscription.on_hold"), data: z.object({}).passthrough() }),
  z.object({ type: z.literal("subscription.cancelled"), data: z.object({}).passthrough() }),
  z.object({ type: z.literal("subscription.expired"), data: z.object({}).passthrough() }),
  z.object({ type: z.literal("subscription.failed"), data: z.object({}).passthrough() }),
]);

export type DodoEvent = z.infer<typeof dodoEventSchema>;

export function subscriptionStatusFromDodo(status: string): "ACTIVE" | "PAST_DUE" | "CANCELED" {
  if (status === "active") return "ACTIVE";
  if (status === "on_hold") return "PAST_DUE";
  return "CANCELED";
}
