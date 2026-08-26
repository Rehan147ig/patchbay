import { prisma } from "@patchbay/db";
import {
  isPlanTier,
  planTierFromDodoProductId,
  PURCHASABLE_TIERS,
  subscriptionStatusFromDodo,
  verifyDodoWebhookSignature,
} from "@patchbay/billing";
import { AuditAction } from "@patchbay/audit";
import { ActorType, billingUnavailable, type PlanTier, unauthorized } from "@patchbay/domain";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk, readBoundedBody, writeAuditEvent } from "@/lib/api";
import { env } from "@/lib/env";

const MAX_BODY_BYTES = 512_000;

/**
 * POST /api/webhooks/dodo
 * Public endpoint (exempt from session middleware via /api/webhooks/* in middleware.ts:33).
 * Authenticated by Dodo HMAC over the raw body: HMAC-SHA256("<webhook-id>.<timestamp>.<body>")
 * verified against webhook-signature header. Keeps Subscription row in sync.
 *
 * Dodo events we handle:
 *   subscription.active   — checkout completed, subscription created (primary)
 *   subscription.renewed  — renewal / period roll
 *   subscription.on_hold  — past_due
 *   subscription.cancelled / expired / failed
 *   payment.succeeded     — ignored for subscription tiers (acknowledged)
 */
export async function POST(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  try {
    const webhookSecret = (env as { DODO_PAYMENTS_WEBHOOK_KEY?: string }).DODO_PAYMENTS_WEBHOOK_KEY;
    if (!webhookSecret) {
      return jsonError(billingUnavailable(), correlationId);
    }

    const payload = await readBoundedBody(request, MAX_BODY_BYTES);
    const headers = {
      webhookId: request.headers.get("webhook-id"),
      webhookSignature: request.headers.get("webhook-signature"),
      webhookTimestamp: request.headers.get("webhook-timestamp"),
    };
    if (!verifyDodoWebhookSignature(payload, headers, webhookSecret)) {
      return jsonError(unauthorized("Invalid Dodo webhook signature"), correlationId);
    }

    let body: {
      type?: string;
      data?: Record<string, unknown>;
      business_id?: string;
    };
    try {
      body = JSON.parse(payload) as typeof body;
    } catch {
      return jsonError(unauthorized("Invalid Dodo webhook JSON"), correlationId);
    }

    const type = body.type ?? "";
    const data = (body.data ?? {}) as Record<string, unknown>;

    // payment.* without subscription context — acknowledge, do not retry
    if (type.startsWith("payment.")) {
      return jsonOk({ received: true, ignored: true }, correlationId);
    }

    if (!type.startsWith("subscription.")) {
      return jsonOk({ received: true, ignored: true }, correlationId);
    }

    await handleSubscriptionEvent(type, data, headers.webhookId ?? type);

    return jsonOk({ received: true }, correlationId);
  } catch (error) {
    return jsonError(error, correlationId);
  }
}

async function handleSubscriptionEvent(
  type: string,
  data: Record<string, unknown>,
  webhookId: string,
) {
  // Dodo nests customer/subscription fields variously; normalize
  const nested =
    (data as { customer?: unknown; subscription_id?: string; product_id?: string }) ?? {};
  const customerObj = (data.customer ?? nested.customer ?? {}) as Record<string, unknown>;
  const customerId =
    (customerObj.customer_id as string | undefined) ??
    (data.customer_id as string | undefined) ??
    null;
  const subscriptionId =
    (data.subscription_id as string | undefined) ??
    (nested.subscription_id as string | undefined) ??
    (data.id as string | undefined) ??
    null;
  const productId =
    (data.product_id as string | undefined) ??
    (nested.product_id as string | undefined) ??
    (data.product as string | undefined) ??
    null;
  const status =
    (data.status as string | undefined) ??
    (type === "subscription.cancelled" ? "cancelled" : "active");
  const metadata =
    (data.metadata as Record<string, string> | undefined) ??
    (data as { metadata?: Record<string, string> }).metadata;
  const organizationId =
    metadata?.organizationId ?? (data as { organization_id?: string }).organization_id ?? null;

  // Try to locate existing subscription by dodo ids (stored in stripeCustomerId columns for now) or organizationId
  let previous = null as Awaited<ReturnType<typeof prisma.subscription.findFirst>>;
  if (subscriptionId) {
    previous = await prisma.subscription.findFirst({
      where: { stripeSubscriptionId: subscriptionId },
    });
  }
  if (!previous && customerId) {
    previous = await prisma.subscription.findFirst({ where: { stripeCustomerId: customerId } });
  }
  if (!previous && organizationId) {
    previous = await prisma.subscription.findUnique({ where: { organizationId } });
  }
  if (!previous && !organizationId) {
    // No resolvable org — acknowledge to avoid Dodo retries
    return;
  }

  const tier: PlanTier | null =
    resolveTier(metadata?.planTier, productId) ??
    (previous ? (previous.planTier as PlanTier) : null) ??
    planTierFromDodoProductId(
      productId ?? "",
      env as unknown as Parameters<typeof planTierFromDodoProductId>[1],
    );

  if (!tier) return;

  const dodoStatus = status ?? "active";
  const mappedStatus = subscriptionStatusFromDodo(dodoStatus);

  // next_billing_date is ISO string in some payloads
  const nextBilling =
    (data.next_billing_date as string | undefined) ??
    (data.current_period_end as string | undefined) ??
    null;
  const currentPeriodEnd = nextBilling
    ? new Date(nextBilling)
    : (previous?.currentPeriodEnd ?? null);
  if (currentPeriodEnd && Number.isNaN(currentPeriodEnd.getTime())) {
    // ignore malformed date
  }

  const orgId = previous?.organizationId ?? organizationId;
  if (!orgId) return;

  const prevTier = previous?.planTier as PlanTier | undefined;
  const prevStatus = previous?.status as string | undefined;

  await prisma.subscription.upsert({
    where: { organizationId: orgId },
    update: {
      stripeCustomerId: customerId ?? previous?.stripeCustomerId ?? null,
      stripeSubscriptionId: subscriptionId ?? previous?.stripeSubscriptionId ?? null,
      planTier: tier,
      status: mappedStatus,
      currentPeriodEnd:
        currentPeriodEnd && !Number.isNaN(currentPeriodEnd.getTime())
          ? currentPeriodEnd
          : (previous?.currentPeriodEnd ?? null),
    },
    create: {
      organizationId: orgId,
      stripeCustomerId: customerId ?? null,
      stripeSubscriptionId: subscriptionId ?? null,
      planTier: tier,
      status: mappedStatus,
      currentPeriodEnd:
        currentPeriodEnd && !Number.isNaN(currentPeriodEnd.getTime()) ? currentPeriodEnd : null,
    },
  });

  const changed = !previous || prevTier !== tier || prevStatus !== mappedStatus;

  if (changed) {
    await writeAuditEvent({
      organizationId: orgId,
      actorType: ActorType.SYSTEM,
      actorId: null,
      action:
        mappedStatus === "CANCELED"
          ? AuditAction.SUBSCRIPTION_CANCELED
          : AuditAction.SUBSCRIPTION_CHANGED,
      entityType: "organization",
      entityId: orgId,
      correlationId: `dodo:${webhookId}`,
      before: previous
        ? { planTier: previous.planTier, status: previous.status }
        : { planTier: "FREE", status: null },
      after: { planTier: tier, status: mappedStatus, dodoEvent: type },
    });
  }
}

function resolveTier(metadataTier: string | undefined, productId: string | null): PlanTier | null {
  if (
    metadataTier &&
    isPlanTier(metadataTier) &&
    (PURCHASABLE_TIERS as readonly string[]).includes(metadataTier)
  ) {
    return metadataTier;
  }
  if (productId) {
    const mapped = planTierFromDodoProductId(
      productId,
      env as unknown as Parameters<typeof planTierFromDodoProductId>[1],
    );
    if (mapped) return mapped;
  }
  return null;
}
