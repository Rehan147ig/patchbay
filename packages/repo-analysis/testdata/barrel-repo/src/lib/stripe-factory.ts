import Stripe from "stripe";

export function getStripe(key: string) {
  const stripe = new Stripe(key);
  return stripe;
}

export function getNewStripe(key: string) {
  return new Stripe(key);
}

export function getOpaque() {
  return makeSomething();
}
