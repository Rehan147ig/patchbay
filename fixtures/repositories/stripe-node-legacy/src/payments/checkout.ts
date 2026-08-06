import { getStripeClient } from "../lib/stripe-client";
import { logger } from "../lib/logger";
import { z } from "zod";

const checkoutSchema = z.object({
  productId: z.string(),
  quantity: z.number().int().min(1).default(1),
});

export async function createCheckoutSession(productId: string, quantity: number): Promise<string> {
  const stripe = getStripeClient();
  const parsed = checkoutSchema.parse({ productId, quantity });
  logger.info("creating checkout session", { productId: parsed.productId });

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [{ price: productId, quantity }],
    success_url: "https://acme.dev/checkout/success",
    cancel_url: "https://acme.dev/checkout/cancel",
  });
  return session.url ?? "";
}
