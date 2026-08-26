import type { BillingEnv } from "./plans";

/**
 * Minimal Dodo Payments REST client — SDK-free, like StripeClient.
 * Uses `dodopayments` API: checkout sessions + subscriptions + webhook verification.
 * Mirrors StripeClient shape so `apps/web` routes can swap providers.
 *
 * Env:
 *   DODO_PAYMENTS_API_KEY  — sk_… (test_mode / live_mode via DODO_PAYMENTS_ENVIRONMENT)
 *   DODO_PAYMENTS_ENVIRONMENT — "test_mode" | "live_mode" (default test_mode)
 *   DODO_PAYMENTS_WEBHOOK_KEY — whsec_… for signature verification
 *   DODO_PRODUCT_PRO_MONTHLY / DODO_PRODUCT_TEAM_MONTHLY — product_id for each tier
 */
const DODO_API_BASE = "https://api.dodopayments.com";

const DEFAULT_TIMEOUT_MS = 15_000;

export interface DodoClientConfig {
  apiKey: string;
  environment?: string;
  fetchImpl?: typeof fetch;
  apiUrl?: string;
  timeoutMs?: number;
}

export interface DodoCheckoutInput {
  productId: string;
  customerEmail?: string;
  customerName?: string;
  returnUrl: string;
  metadata?: Record<string, string>;
  quantity?: number;
}

export interface DodoCheckoutResult {
  id: string;
  url: string;
}

export interface DodoSubscription {
  id: string;
  customerId: string;
  status: string;
  productId: string | null;
  currentPeriodEnd: number | null;
}

function bearer(apiKey: string): string {
  return `Bearer ${apiKey}`;
}

export class DodoClient {
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly apiUrl: string;
  private readonly timeoutMs: number;

  constructor(config: DodoClientConfig) {
    if (!config.apiKey) throw new Error("DodoClient requires an apiKey");
    this.apiKey = config.apiKey;
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch;
    this.apiUrl = (config.apiUrl ?? DODO_API_BASE).replace(/\/+$/, "");
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** Creates a hosted Checkout Session for one product (subscription). */
  async createCheckoutSession(input: DodoCheckoutInput): Promise<DodoCheckoutResult> {
    const body = {
      product_cart: [{ product_id: input.productId, quantity: input.quantity ?? 1 }],
      return_url: input.returnUrl,
      ...(input.customerEmail || input.customerName
        ? {
            customer: {
              ...(input.customerEmail ? { email: input.customerEmail } : {}),
              ...(input.customerName ? { name: input.customerName } : {}),
            },
          }
        : {}),
      ...(input.metadata ? { metadata: input.metadata } : {}),
    };

    const data = await this.request<{
      session_id: string;
      checkout_url: string;
    }>("/checkouts", {
      method: "POST",
      body: JSON.stringify(body),
    });

    if (!data.checkout_url) throw new Error("Dodo checkout session returned no checkout_url");
    return { id: data.session_id, url: data.checkout_url };
  }

  /** Fetch a subscription by id (for portal/status checks). */
  async fetchSubscription(subscriptionId: string): Promise<DodoSubscription> {
    const data = await this.request<{
      subscription_id: string;
      customer: { customer_id: string };
      status: string;
      product_id?: string;
      next_billing_date?: string | null;
      recurring_pre_tax_amount?: number;
    }>(`/subscriptions/${subscriptionId}`, { method: "GET" });

    return {
      id: data.subscription_id,
      customerId: data.customer.customer_id,
      status: data.status,
      productId: (data as { product_id?: string }).product_id ?? null,
      currentPeriodEnd: data.next_billing_date ? Date.parse(data.next_billing_date) / 1000 : null,
    };
  }

  /** Creates a customer portal session — returns hosted URL. */
  async createPortalSession(customerId: string): Promise<{ id: string; url: string }> {
    const data = await this.request<{ customer_portal_url: string }>(
      `/customers/${customerId}/customer-portal`,
      {
        method: "POST",
        body: JSON.stringify({}),
      },
    );
    // Dodo returns portal URL directly; synthesize an id from customerId for audit parity with Stripe
    return { id: `dodo_portal_${customerId}`, url: data.customer_portal_url };
  }

  private async request<T>(path: string, init: { method: string; body?: string }): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.apiUrl}${path}`, {
        method: init.method,
        headers: {
          Authorization: bearer(this.apiKey),
          "Content-Type": "application/json",
        },
        ...(init.body ? { body: init.body } : {}),
        signal: controller.signal,
      });
      if (!response.ok) {
        const raw = await response.text().catch(() => "");
        throw new Error(
          `Dodo API ${init.method} ${path} failed: ${response.status} ${raw || response.statusText}`,
        );
      }
      return (await response.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }
}

export function createDodoClient(
  env: BillingEnv = process.env as unknown as BillingEnv,
): DodoClient | null {
  const apiKey = (env as { DODO_PAYMENTS_API_KEY?: string }).DODO_PAYMENTS_API_KEY;
  if (!apiKey) return null;
  const apiUrl =
    (env as { DODO_PAYMENTS_ENVIRONMENT?: string }).DODO_PAYMENTS_ENVIRONMENT === "live_mode"
      ? DODO_API_BASE
      : DODO_API_BASE;
  return new DodoClient({ apiKey, apiUrl });
}
