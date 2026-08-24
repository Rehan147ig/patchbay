"""Chat service still on the legacy openai Python SDK module API (v0)."""

import openai

DEFAULT_MODEL = "gpt-3.5-turbo"


def run_chat(api_key: str, messages: list[dict]) -> str:
    openai.api_key = api_key
    completion = openai.ChatCompletion.create(model=DEFAULT_MODEL, messages=messages)
    return completion.choices[0].message.content
