import { stripe } from "@acme/shared";

stripe.customers.create({ email: "b@example.com" });
