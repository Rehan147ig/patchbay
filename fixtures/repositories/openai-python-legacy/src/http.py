"""Untracked dependency usage (requests) - must never be indexed."""

import requests


def fetch(url: str) -> bytes:
    return requests.get(url).content