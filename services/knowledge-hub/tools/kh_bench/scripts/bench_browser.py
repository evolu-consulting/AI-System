"""A stand-in "browser" for the one-time `kh login` of the bench profile (Rowan chose option 1, 2026-10-01).

kh-helper opens the sign-in page with Python's webbrowser module; with BROWSER pointing at this script,
the page is "opened" here instead: it fills the Keycloak login form with the bench account and follows
the redirect back to the helper's loopback port, exactly as a person would in a real browser.
The helper itself is unchanged; its refresh token (up to 90 days) then serves every bench run.

Usage (from the bench runner, never by hand):
  BROWSER="<python> bench_browser.py %s" kh login --kh-url <KH>
"""
import html, json, re, sys, urllib.parse
import os
from pathlib import Path

import requests

SECRETS = Path(os.environ.get("KH_BENCH_SECRETS", Path.home() / ".claude_rowan" / "secrets")) / "kh-prod-accounts.json"


def main(url: str) -> int:
    acct = json.load(open(SECRETS, encoding="utf-8"))["accounts"]["kh-bench"]
    s = requests.Session()
    r = s.get(url, timeout=60)
    m = re.search(r'<form[^>]+id="kc-form-login"[^>]+action="([^"]+)"', r.text)
    if not m:
        print("bench_browser: no login form on the sign-in page", file=sys.stderr)
        return 1
    r = s.post(html.unescape(m.group(1)), data={"username": acct["email"], "password": acct["password"],
                                                 "credentialId": ""}, allow_redirects=False, timeout=60)
    for _ in range(5):
        loc = r.headers.get("Location", "")
        if not loc:
            print(f"bench_browser: sign-in stopped at HTTP {r.status_code}", file=sys.stderr)
            return 1
        if urllib.parse.urlparse(loc).hostname in ("127.0.0.1", "localhost"):
            requests.get(loc, timeout=30)  # hand the code to the helper's loopback listener
            return 0
        r = s.get(loc, allow_redirects=False, timeout=60)
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
