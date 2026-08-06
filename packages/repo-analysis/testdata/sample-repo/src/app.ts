import Stripe from "stripe";

export async function pay(userId: string, amountCents: number): Promise<string> {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const paymentIntent = await stripe.paymentIntents.create({
    amount: amountCents,
    currency: "usd",
    metadata: { userId },
  });
  return paymentIntent.id;
}
