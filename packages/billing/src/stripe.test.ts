import { afterEach, describe, expect, it, vi } from "vitest";
import { createStripeClient, StripeClient } from "./stripe";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function authOf(init?: RequestInit): string {
  const headers = (init?.headers ?? {}) as Record<string, string>;
  return headers.Authorization ?? "";
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("StripeClient", () => {
  it("creates a subscription checkout session with form-encoded body and basic auth", async () => {
    const calls: Array<{ url: string; method?: string; body?: string }> = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method, body: String(init?.body) });
      return jsonResponse(200, { id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/1" });
    }) as typeof fetch;

    const client = new StripeClient({ secretKey: "sk_test_abc", fetchImpl });
    const result = await client.createCheckoutSession({
      priceId: "price_pro",
      clientReferenceId: "org-acme",
      successUrl: "https://patchbay.dev/overview?billing=success",
      cancelUrl: "https://patchbay.dev/settings",
      customerEmail: "billing@acme.dev",
      metadata: { planTier: "PRO" },
    });

    expect(result).toEqual({ id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/1" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect(calls[0]!.method).toBe("POST");
    const body = new URLSearchParams(calls[0]!.body);
    expect(body.get("mode")).toBe("subscription");
    expect(body.get("line_items[0][price]")).toBe("price_pro");
    expect(body.get("line_items[0][quantity]")).toBe("1");
    expect(body.get("client_reference_id")).toBe("org-acme");
    expect(body.get("customer_email")).toBe("billing@acme.dev");
    expect(body.get("success_url")).toBe("https://patchbay.dev/overview?billing=success");
    expect(body.get("metadata[planTier]")).toBe("PRO");
  });

  it("authenticates with the secret key", async () => {
    const seen: string[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      seen.push(authOf(init));
      return jsonResponse(200, { id: "cs_1", url: "https://checkout.stripe.com/c/pay/1" });
    }) as typeof fetch;

    const client = new StripeClient({ secretKey: "sk_live_x", fetchImpl });
    await client.createCheckoutSession({
      priceId: "price_pro",
      clientReferenceId: "org-1",
      successUrl: "https://patchbay.dev",
      cancelUrl: "https://patchbay.dev",
    });

    expect(seen[0]).toBe(`Basic ${Buffer.from("sk_live_x:").toString("base64")}`);
  });

  it("opens the billing portal for a customer", async () => {
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://api.stripe.com/v1/billing_portal/sessions");
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("customer")).toBe("cus_123");
      expect(body.get("return_url")).toBe("https://patchbay.dev/settings");
      return jsonResponse(200, { id: "bps_1", url: "https://billing.stripe.com/p/session/1" });
    }) as typeof fetch;

    const client = new StripeClient({ secretKey: "sk_test_abc", fetchImpl });
    const result = await client.createPortalSession("cus_123", "https://patchbay.dev/settings");
    expect(result.url).toBe("https://billing.stripe.com/p/session/1");
  });

  it("fetches a subscription with status, period end, and plan price", async () => {
    const fetchImpl = (async (url: string) => {
      expect(url).toBe("https://api.stripe.com/v1/subscriptions/sub_123");
      return jsonResponse(200, {
        id: "sub_123",
        customer: "cus_123",
        status: "active",
        current_period_end: 1_800_000_000,
        items: { data: [{ price: { id: "price_team" } }] },
      });
    }) as typeof fetch;

    const client = new StripeClient({ secretKey: "sk_test_abc", fetchImpl });
    const result = await client.fetchSubscription("sub_123");
    expect(result).toEqual({
      id: "sub_123",
      customer: "cus_123",
      status: "active",
      currentPeriodEnd: 1_800_000_000,
      priceId: "price_team",
    });
  });

  it("surfaces Stripe error bodies with the status code", async () => {
    const fetchImpl = (async () =>
      jsonResponse(401, { error: { message: "Invalid API Key" } })) as typeof fetch;

    const client = new StripeClient({ secretKey: "sk_bad", fetchImpl });
    await expect(
      client.createCheckoutSession({
        priceId: "price_pro",
        clientReferenceId: "org-1",
        successUrl: "https://patchbay.dev",
        cancelUrl: "https://patchbay.dev",
      }),
    ).rejects.toThrow("Stripe API POST /checkout/sessions failed: 401 Invalid API Key");
  });

  it("throws when a checkout session has no hosted URL", async () => {
    const fetchImpl = (async () => jsonResponse(200, { id: "cs_1" })) as typeof fetch;
    const client = new StripeClient({ secretKey: "sk_test_abc", fetchImpl });
    await expect(
      client.createCheckoutSession({
        priceId: "price_pro",
        clientReferenceId: "org-1",
        successUrl: "https://patchbay.dev",
        cancelUrl: "https://patchbay.dev",
      }),
    ).rejects.toThrow("no hosted URL");
  });

  it("rejects a missing secret key", () => {
    expect(() => new StripeClient({ secretKey: "" })).toThrow("requires a secretKey");
  });
});

describe("createStripeClient", () => {
  it("returns null when billing is not configured", () => {
    expect(createStripeClient({})).toBeNull();
  });

  it("builds a client from env with a secret key", () => {
    const client = createStripeClient({ STRIPE_SECRET_KEY: "sk_test_1" } as NodeJS.ProcessEnv);
    expect(client).toBeInstanceOf(StripeClient);
  });
});
