"""Entry point wiring the three certified Python connectors."""

from billing import create_customer
from chat import run_chat
from notify import send_sms


def main() -> None:
    run_chat("sk-test", [{"role": "user", "content": "hello"}])
    create_customer("sk-test", "customer@example.com")
    send_sms("AC00000000000000000000000000000000", "test-token", "+15005550000", "hello")