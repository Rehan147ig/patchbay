import Stripe from "stripe";

import { getStripeClient } from "../lib/stripe-client";
import { logger } from "../lib/logger";

export async function handlePaymentIntentWebhook(
  rawBody: string,
  signature: string,
): Promise<void> {
  const stripe = getStripeClient();
  const event = stripe.webhooks.constructEvent(
    rawBody,
    signature,
    process.env.STRIPE_WEBHOOK_SECRET ?? "",
  );
  logger.info("stripe webhook event", { type: event.type });
}
