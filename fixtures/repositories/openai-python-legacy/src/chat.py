"""Chat service using the openai Python SDK v1 client."""

from openai import OpenAI

DEFAULT_MODEL = "gpt-4o-mini"


def run_chat(api_key: str, messages: list[dict]) -> str:
    client = OpenAI(api_key=api_key)
    completion = client.chat.completions.create(model=DEFAULT_MODEL, messages=messages)
    return completion.choices[0].message.content