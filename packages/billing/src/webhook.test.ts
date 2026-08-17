import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  parseStripeEvent,
  parseStripeSignatureHeader,
  verifyStripeWebhookSignature,
} from "./webhook";

const SECRET = "whsec_test_secret";

function sign(payload: string, secret: string, timestamp: number): string {
  const hmac = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  return `t=${timestamp},v1=${hmac}`;
}

const CHECKOUT_PAYLOAD = JSON.stringify({
  id: "evt_checkout",
  type: "checkout.session.completed",
  data: {
    object: {
      id: "cs_123",
      client_reference_id: "org-acme",
      customer: "cus_123",
      subscription: "sub_123",
      metadata: { planTier: "PRO" },
    },
  },
});

describe("verifyStripeWebhookSignature", () => {
  const nowMs = 1_800_000_000_000;

  it("accepts a valid signature within the freshness window", () => {
    const header = sign(CHECKOUT_PAYLOAD, SECRET, Math.floor(nowMs / 1000));
    expect(verifyStripeWebhookSignature(CHECKOUT_PAYLOAD, header, SECRET, nowMs)).toBe(true);
  });

  it("rejects a tampered payload", () => {
    const header = sign(CHECKOUT_PAYLOAD, SECRET, Math.floor(nowMs / 1000));
    expect(verifyStripeWebhookSignature(CHECKOUT_PAYLOAD + " ", header, SECRET, nowMs)).toBe(false);
  });

  it("rejects a signature produced with a different secret", () => {
    const header = sign(CHECKOUT_PAYLOAD, "whsec_other", Math.floor(nowMs / 1000));
    expect(verifyStripeWebhookSignature(CHECKOUT_PAYLOAD, header, SECRET, nowMs)).toBe(false);
  });

  it("rejects signatures older than the freshness window", () => {
    const header = sign(CHECKOUT_PAYLOAD, SECRET, Math.floor(nowMs / 1000) - 400);
    expect(verifyStripeWebhookSignature(CHECKOUT_PAYLOAD, header, SECRET, nowMs)).toBe(false);
  });

  it("rejects malformed headers and empty secrets", () => {
    expect(verifyStripeWebhookSignature(CHECKOUT_PAYLOAD, "v1=zzz", SECRET, nowMs)).toBe(false);
    expect(verifyStripeWebhookSignature(CHECKOUT_PAYLOAD, "", SECRET, nowMs)).toBe(false);
    expect(verifyStripeWebhookSignature(CHECKOUT_PAYLOAD, "t=1,v1=abc", "", nowMs)).toBe(false);
  });

  it("prefers the last v1 signature when Stripe rotates keys", () => {
    const nowSec = Math.floor(nowMs / 1000);
    const oldSig = createHmac("sha256", "whsec_old")
      .update(`${nowSec}.${CHECKOUT_PAYLOAD}`)
      .digest("hex");
    const header = `t=${nowSec},v1=${oldSig},v1=${sign(CHECKOUT_PAYLOAD, SECRET, nowSec).split("v1=")[1]}`;
    expect(verifyStripeWebhookSignature(CHECKOUT_PAYLOAD, header, SECRET, nowMs)).toBe(true);
  });
});

describe("parseStripeSignatureHeader", () => {
  it("extracts timestamp and v1 signature", () => {
    const { timestamp, signature } = parseStripeSignatureHeader("t=123,v1=abc123");
    expect(timestamp).toBe(123);
    expect(signature).toBe("abc123");
  });
});

describe("parseStripeEvent", () => {
  it("parses checkout.session.completed", () => {
    const event = parseStripeEvent(CHECKOUT_PAYLOAD);
    expect(event.type).toBe("checkout.session.completed");
    expect(event.data.object.client_reference_id).toBe("org-acme");
    expect(event.data.object.subscription).toBe("sub_123");
    expect(event.data.object.metadata).toEqual({ planTier: "PRO" });
  });

  it("parses customer.subscription.updated with period end and items", () => {
    const payload = JSON.stringify({
      id: "evt_sub_updated",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_123",
          customer: "cus_123",
          status: "active",
          current_period_end: 1_800_000_000,
          items: { data: [{ price: { id: "price_team" } }] },
        },
      },
    });
    const event = parseStripeEvent(payload);
    expect(event.type).toBe("customer.subscription.updated");
    expect(event.data.object.status).toBe("active");
  });

  it("parses customer.subscription.deleted", () => {
    const payload = JSON.stringify({
      id: "evt_sub_deleted",
      type: "customer.subscription.deleted",
      data: { object: { id: "sub_123", customer: "cus_123", status: "canceled" } },
    });
    const event = parseStripeEvent(payload);
    expect(event.type).toBe("customer.subscription.deleted");
  });

  it("rejects unknown event types", () => {
    const payload = JSON.stringify({
      id: "evt_unknown",
      type: "invoice.payment_succeeded",
      data: { object: { id: "in_1" } },
    });
    expect(() => parseStripeEvent(payload)).toThrow(/Unsupported Stripe webhook event/);
  });

  it("rejects invalid JSON", () => {
    expect(() => parseStripeEvent("{not json")).toThrow(/not valid JSON/);
  });
});
