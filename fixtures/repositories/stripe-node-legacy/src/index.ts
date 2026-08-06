import { createCheckoutSession } from "./payments/checkout";
import { ensureCustomer } from "./payments/customers";
import { createStripeClient } from "./lib/stripe-client";

createStripeClient();

export const billingService = {
  ensureCustomer,
  createCheckoutSession,
};
