"""Billing service using the stripe Python SDK."""

from stripe import StripeClient


def create_customer(api_key: str, email: str) -> str:
    client = StripeClient(api_key=api_key)
    customer = client.customers.create(email=email)
    return customer.id