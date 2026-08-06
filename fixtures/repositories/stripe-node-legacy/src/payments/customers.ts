import Stripe from "stripe";

import { getStripeClient } from "../lib/stripe-client";
import { logger } from "../lib/logger";

export interface CustomerRecord {
  id: string;
  email: string;
  displayName: string;
}

export async function ensureCustomer(
  userId: string,
  user: { email: string; name: string },
): Promise<CustomerRecord> {
  const stripe = getStripeClient();

  const existing = await findCustomerByUserId(userId);
  if (existing) {
    return existing;
  }

  logger.info("creating stripe customer", { userId });
  const customer = await stripe.customers.create({ email: user.email });
  return {
    id: customer.id,
    email: customer.email ?? user.email,
    displayName: user.name,
  };
}

function findCustomerByUserId(_userId: string): Promise<CustomerRecord | null> {
  // demo: no persistence
  return Promise.resolve(null);
}
