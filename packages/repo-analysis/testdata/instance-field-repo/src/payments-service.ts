import Stripe from "stripe";

export class PaymentsService {
  private readonly stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "sk-test");

  charge(amount: number): void {
    this.stripe.charges.create({ amount, currency: "usd" });
  }

  createCustomer(): void {
    this.stripe.customers.create({ email: "a@example.com" });
  }
}
