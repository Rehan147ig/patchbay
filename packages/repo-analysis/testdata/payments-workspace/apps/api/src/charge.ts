import { stripe } from "@acme/payments";

stripe.charges.create({ amount: 2000, currency: "usd" });
