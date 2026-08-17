import { prisma } from "@patchbay/db";
import {
  createStripeClient,
  isPlanTier,
  planTierFromStripePriceId,
  PURCHASABLE_TIERS,
  parseStripeEvent,
  subscriptionStatusFromStripe,
  verifyStripeWebhookSignature,
  type StripeEvent,
} from "@patchbay/billing";
import { AuditAction } from "@patchbay/audit";
import { ActorType, billingUnavailable, type PlanTier, unauthorized } from "@patchbay/domain";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk, readBoundedBody, writeAuditEvent } from "@/lib/api";
import { env } from "@/lib/env";

const MAX_BODY_BYTES = 512_000;

/**
 * POST /api/webhooks/stripe
 * Public endpoint (exempt from session middleware like /api/webhooks/*).
 * Authenticated by the Stripe HMAC signature over the raw body. Keeps the
 * Subscription row in sync with Checkout and billing-portal events.
 */
export async function POST(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  try {
    const webhookSecret = env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      return jsonError(billingUnavailable(), correlationId);
    }

    const payload = await readBoundedBody(request, MAX_BODY_BYTES);
    const signature = request.headers.get("stripe-signature");
    if (!signature || !verifyStripeWebhookSignature(payload, signature, webhookSecret)) {
      return jsonError(unauthorized("Invalid Stripe webhook signature"), correlationId);
    }

    let event: StripeEvent;
    try {
      event = parseStripeEvent(payload);
    } catch {
      // Unsupported event types are acknowledged, not retried.
      return jsonOk({ received: true, ignored: true }, correlationId);
    }

    if (event.type === "checkout.session.completed") {
      await handleCheckoutCompleted(event);
    } else {
      await handleSubscriptionEvent(event);
    }

    return jsonOk({ received: true }, correlationId);
  } catch (error) {
    return jsonError(error, correlationId);
  }
}

async function handleCheckoutCompleted(
  event: StripeEvent & { type: "checkout.session.completed" },
) {
  const object = event.data.object;
  const organizationId = object.client_reference_id;
  if (!organizationId) return;

  const previous = await prisma.subscription.findUnique({ where: { organizationId } });

  let tier = resolveTier(object.metadata?.planTier, null);
  let stripeStatus = "active";
  let currentPeriodEnd: Date | null = null;

  if (object.subscription) {
    const client = createStripeClient(env);
    if (client) {
      const subscription = await client.fetchSubscription(object.subscription);
      stripeStatus = subscription.status;
      currentPeriodEnd =
        subscription.currentPeriodEnd === null
          ? null
          : new Date(subscription.currentPeriodEnd * 1000);
      tier = resolveTier(object.metadata?.planTier, subscription.priceId);
    }
  }

  if (!tier) return;
  const status = subscriptionStatusFromStripe(stripeStatus);

  await prisma.subscription.upsert({
    where: { organizationId },
    update: {
      stripeCustomerId: object.customer ?? previous?.stripeCustomerId ?? null,
      stripeSubscriptionId: object.subscription ?? previous?.stripeSubscriptionId ?? null,
      planTier: tier,
      status,
      currentPeriodEnd,
    },
    create: {
      organizationId,
      stripeCustomerId: object.customer ?? null,
      stripeSubscriptionId: object.subscription ?? null,
      planTier: tier,
      status,
      currentPeriodEnd,
    },
  });

  await writeAuditEvent({
    organizationId,
    actorType: ActorType.SYSTEM,
    actorId: null,
    action: AuditAction.SUBSCRIPTION_CHANGED,
    entityType: "organization",
    entityId: organizationId,
    correlationId: `stripe:${event.id}`,
    before: previous
      ? { planTier: previous.planTier, status: previous.status }
      : { planTier: "FREE", status: null },
    after: { planTier: tier, status, stripeEvent: event.type },
  });
}

async function handleSubscriptionEvent(
  event: StripeEvent & { type: "customer.subscription.updated" | "customer.subscription.deleted" },
) {
  const object = event.data.object;
  const previous = await prisma.subscription.findFirst({
    where: {
      OR: [{ stripeSubscriptionId: object.id }, { stripeCustomerId: object.customer ?? undefined }],
    },
  });
  if (!previous) return;

  const tier = resolveTier(object.metadata?.planTier, null) ?? previous.planTier;
  const status =
    event.type === "customer.subscription.deleted"
      ? "CANCELED"
      : subscriptionStatusFromStripe(object.status ?? "canceled");
  const currentPeriodEnd =
    object.current_period_end === null || object.current_period_end === undefined
      ? previous.currentPeriodEnd
      : new Date(object.current_period_end * 1000);

  const changed =
    previous.planTier !== tier ||
    previous.status !== status ||
    previous.currentPeriodEnd?.getTime() !== currentPeriodEnd?.getTime();

  await prisma.subscription.update({
    where: { id: previous.id },
    data: {
      stripeCustomerId: object.customer ?? previous.stripeCustomerId,
      planTier: tier,
      status,
      currentPeriodEnd,
    },
  });

  if (changed) {
    await writeAuditEvent({
      organizationId: previous.organizationId,
      actorType: ActorType.SYSTEM,
      actorId: null,
      action:
        event.type === "customer.subscription.deleted"
          ? AuditAction.SUBSCRIPTION_CANCELED
          : AuditAction.SUBSCRIPTION_CHANGED,
      entityType: "organization",
      entityId: previous.organizationId,
      correlationId: `stripe:${event.id}`,
      before: { planTier: previous.planTier, status: previous.status },
      after: { planTier: tier, status, stripeEvent: event.type },
    });
  }
}

/**
 * Prefers the plan tier Patchbay set as checkout metadata; falls back to
 * mapping the Stripe price id from the configured price ids. Null when the
 * event carries no resolvable plan.
 */
function resolveTier(metadataTier: string | undefined, priceId: string | null): PlanTier | null {
  if (
    metadataTier &&
    isPlanTier(metadataTier) &&
    (PURCHASABLE_TIERS as readonly string[]).includes(metadataTier)
  ) {
    return metadataTier;
  }
  if (priceId) return planTierFromStripePriceId(priceId, env);
  return null;
}
