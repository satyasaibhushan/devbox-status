"""Send one local status sample to the public dashboard."""

import json
import os
import sys
import urllib.error
import urllib.request
from urllib.parse import urlparse

from main import status


def main():
    url = os.environ["STATUS_URL"]
    token = os.environ["STATUS_TOKEN"]
    parsed = urlparse(url)
    if parsed.scheme != "https" and not (parsed.scheme == "http" and parsed.hostname in ("localhost", "127.0.0.1")):
        raise ValueError("STATUS_URL must use HTTPS")

    payload = json.dumps(status(), allow_nan=False).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=payload,
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "User-Agent": "server-status-reporter/1.0",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            if response.status != 200:
                raise RuntimeError(f"Heartbeat returned HTTP {response.status}")
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"Heartbeat returned HTTP {error.code}") from None
    print("Heartbeat accepted")


if __name__ == "__main__":
    try:
        main()
    except (KeyError, ValueError, RuntimeError, urllib.error.URLError) as error:
        print(f"status reporter: {error}", file=sys.stderr)
        sys.exit(1)
