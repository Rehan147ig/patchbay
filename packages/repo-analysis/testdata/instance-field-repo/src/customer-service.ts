import Stripe from "stripe";

const stripe = new Stripe("sk-test");

export class CustomerService {
  private client: unknown;

  constructor() {
    this.client = stripe;
  }

  createCustomer(): void {
    this.client.customers.create({ email: "c@example.com" });
  }
}
