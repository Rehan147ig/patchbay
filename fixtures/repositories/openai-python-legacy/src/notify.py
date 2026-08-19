"""SMS notifications using the twilio Python SDK."""

from twilio.rest import Client


def send_sms(account_sid: str, auth_token: str, to: str, body: str) -> str:
    client = Client(account_sid, auth_token)
    message = client.messages.create(to=to, body=body)
    return message.sid