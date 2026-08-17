import type { BillingEnv } from "./plans";

/**
 * Minimal Stripe REST client. Deliberately SDK-free (like the GitHub App
 * integration): checkout sessions, the billing portal, and subscription
 * reads are three form-encoded POSTs/GETs against api.stripe.com. This keeps
 * the billing package dependency-light and fully unit-testable with a mocked
 * fetch.
 */
const STRIPE_API_URL = "https://api.stripe.com/v1";

const DEFAULT_TIMEOUT_MS = 15_000;

export interface StripeClientConfig {
  secretKey: string;
  fetchImpl?: typeof fetch;
  apiUrl?: string;
  timeoutMs?: number;
}

export interface CheckoutSessionInput {
  priceId: string;
  clientReferenceId: string;
  successUrl: string;
  cancelUrl: string;
  customerEmail?: string;
  metadata?: Record<string, string>;
}

export interface CheckoutSessionResult {
  id: string;
  url: string;
}

export interface PortalSessionResult {
  id: string;
  url: string;
}

export interface StripeSubscription {
  id: string;
  customer: string;
  status: string;
  /** Unix seconds; null until the first invoice is finalized. */
  currentPeriodEnd: number | null;
  /** Price id of the first subscription item (drives plan tier mapping). */
  priceId: string | null;
}

function formEncode(params: Record<string, string>): URLSearchParams {
  return new URLSearchParams(params);
}

export class StripeClient {
  private readonly secretKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly apiUrl: string;
  private readonly timeoutMs: number;

  constructor(config: StripeClientConfig) {
    if (!config.secretKey) {
      throw new Error("StripeClient requires a secretKey");
    }
    this.secretKey = config.secretKey;
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch;
    this.apiUrl = (config.apiUrl ?? STRIPE_API_URL).replace(/\/+$/, "");
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** Creates a subscription-mode Checkout Session and returns the hosted URL. */
  async createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSessionResult> {
    const params: Record<string, string> = {
      mode: "subscription",
      "line_items[0][price]": input.priceId,
      "line_items[0][quantity]": "1",
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      client_reference_id: input.clientReferenceId,
      ...(input.customerEmail ? { customer_email: input.customerEmail } : {}),
    };
    if (input.metadata) {
      for (const [key, value] of Object.entries(input.metadata)) {
        params[`metadata[${key}]`] = value;
      }
    }
    const session = await this.request<{ id: string; url: string }>("/checkout/sessions", {
      method: "POST",
      body: formEncode(params),
    });
    if (!session.url) {
      throw new Error("Stripe checkout session returned no hosted URL");
    }
    return { id: session.id, url: session.url };
  }

  /** Opens the Stripe billing portal for an existing customer. */
  async createPortalSession(customerId: string, returnUrl: string): Promise<PortalSessionResult> {
    const session = await this.request<{ id: string; url: string }>("/billing_portal/sessions", {
      method: "POST",
      body: formEncode({ customer: customerId, return_url: returnUrl }),
    });
    if (!session.url) {
      throw new Error("Stripe billing portal session returned no URL");
    }
    return { id: session.id, url: session.url };
  }

  /** Fetches a subscription to learn status, period end, and plan price. */
  async fetchSubscription(subscriptionId: string): Promise<StripeSubscription> {
    const data = await this.request<{
      id: string;
      customer: string;
      status: string;
      current_period_end?: number | null;
      items?: { data?: Array<{ price?: { id?: string } }> };
    }>(`/subscriptions/${subscriptionId}`, { method: "GET" });
    return {
      id: data.id,
      customer: data.customer,
      status: data.status,
      currentPeriodEnd: data.current_period_end ?? null,
      priceId: data.items?.data?.[0]?.price?.id ?? null,
    };
  }

  private async request<T>(
    path: string,
    init: { method: string; body?: URLSearchParams },
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.apiUrl}${path}`, {
        method: init.method,
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.secretKey}:`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        ...(init.body ? { body: init.body } : {}),
        signal: controller.signal,
      });
      if (!response.ok) {
        const raw = await response.text().catch(() => "");
        let message = raw;
        try {
          const parsed = JSON.parse(raw) as { error?: { message?: string } };
          if (parsed.error?.message) message = parsed.error.message;
        } catch {
          // Non-JSON error body; use the raw text.
        }
        throw new Error(
          `Stripe API ${init.method} ${path} failed: ${response.status} ${message || response.statusText}`,
        );
      }
      return (await response.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Builds a client from env; null when billing is not configured. */
export function createStripeClient(
  env: BillingEnv = process.env as BillingEnv,
): StripeClient | null {
  const secretKey = env.STRIPE_SECRET_KEY;
  if (!secretKey) return null;
  return new StripeClient({ secretKey });
}
