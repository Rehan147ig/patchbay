import { stripe } from "@acme/payments/src/index.ts";

stripe.refunds.create({ payment_intent: "pi_1" });
