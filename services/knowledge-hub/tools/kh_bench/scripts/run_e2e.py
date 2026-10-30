"""Run Keycloak repo deploy/btp/e2e_multi_user.py against one KH deployment, signed in as agent-admin.

The e2e signs its admin in with client_credentials; this swaps that for agent-admin's password grant
on admin-cli (master), so no temporary admin client is needed.
Usage: python -u run_e2e.py <kh url>
"""
import json
from pathlib import Path
import os
import runpy
import sys
import tempfile

BTP = os.environ.get("KH_BENCH_KEYCLOAK_BTP") or sys.exit("set KH_BENCH_KEYCLOAK_BTP to the Keycloak repo's deploy/btp folder")
sys.path.insert(0, BTP)
os.chdir(BTP)
A = json.load(open(Path(os.environ.get("KH_BENCH_SECRETS", Path.home() / ".claude_rowan" / "secrets")) / "kh-prod-accounts.json"))

import socket  # noqa: E402
import time  # noqa: E402

_resolve = socket.getaddrinfo


def _resolve_retry(*args, **kwargs):
    """This machine's DNS drops lookups now and then; nothing is sent before a lookup, so retry it."""
    for attempt in range(8):
        try:
            return _resolve(*args, **kwargs)
        except socket.gaierror:
            if attempt == 7:
                raise
            time.sleep(3)


socket.getaddrinfo = _resolve_retry

import configure_realm  # noqa: E402

_init = configure_realm.Admin.__init__


def _init_as_agent(self, url, client_id, secret):
    self.url = url.rstrip("/")
    self._credentials = {"grant_type": "password", "client_id": "admin-cli", "username": "agent-admin",
                         "password": A["accounts"]["agent-admin"]["password"]}
    self.authenticate()


configure_realm.Admin.__init__ = _init_as_agent
dummy = tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False)
dummy.write("unused"); dummy.close()
sys.argv = ["e2e_multi_user.py", "--keycloak", "https://kh-keycloak.cfapps.br10.hana.ondemand.com",
            "--kh", sys.argv[1], "--client-id", "unused", "--client-secret-file", dummy.name,
            "--accounts-file", os.environ.get("KH_BENCH_TEST_ACCOUNTS") or sys.exit("set KH_BENCH_TEST_ACCOUNTS")]
try:
    runpy.run_path("e2e_multi_user.py", run_name="__main__")
finally:
    os.unlink(dummy.name)
