import { stripe } from "../../outside-repo/src/stripe-client";

stripe.customers.create({ amount: 1 });
