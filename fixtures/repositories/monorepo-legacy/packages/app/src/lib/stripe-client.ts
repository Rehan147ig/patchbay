import Stripe from "stripe";

import { logger } from "./logger";

const STRIPE_API_VERSION = "2024-04-10";

export function getStripeClient(): Stripe {
  const apiKey = process.env.STRIPE_SECRET_KEY;
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  logger.info("stripe client created", { apiVersion: STRIPE_API_VERSION });
  return stripe;
}
