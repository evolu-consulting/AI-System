"""Tests for taking KH out of a CLI (tools/kh-helper 1.5.0), 2026-09-28.

WHAT IS UNDER TEST
  1. setup --remove ENDS THE SIGN-IN. Before 1.5.0 it took out only the hooks and left the 90-day
     sign-in in the credential store, so `kh setup` brought everything back without a new sign-in.
     Now every sign-in of this copy is revoked at the identity service and deleted here, for every KH
     it signed in to (prod and dev), and a later call answers "not signed in".
  2. kh uninstall does the same and deletes the helper's own folder, but only the documented install
     (a virtual environment named kh-helper that the running Python belongs to); any other folder is
     left in place.

Run from the repo root with the project venv:
    .venv\\Scripts\\python tests\\test_kh_helper_remove.py

Each case runs in a child Python; no network (requests.post is replaced) and the credential store is
an in-memory one.
"""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HELPER = ROOT / "tools" / "kh-helper"

FAILURES = []


def check(name, condition, detail=None):
    print(("ok   " if condition else "FAIL ") + name + ("" if condition or detail is None else f"  -> {detail}"))
    if not condition:
        FAILURES.append(name)


PROBE = r"""
import contextlib, io, json, os, sys
from kh_helper import owner, session, cli, hooks
hooks._claude_mcp = lambda kh_url, remove: "skipped (test)"   # never touch the real Claude Code MCP list
hooks._claude_companions = lambda remove: {}
owner.caller = lambda: {"cli": owner.CLAUDE_CODE, "profile": owner._resolve(os.environ["CLAUDE_CONFIG_DIR"])}
store, revoked = {}, []
class FakeKeyring:
    def set_password(self, service, account, value): store[(service, account)] = value
    def get_password(self, service, account): return store.get((service, account))
    def delete_password(self, service, account): store.pop((service, account), None)
session._keyring = lambda: FakeKeyring()
class Resp:
    status_code = 200
session.requests.post = lambda url, **kw: (revoked.append((url, kw["data"]["token"])), Resp())[1]
PROD, DEV = "https://kh.example.test", "https://kh-dev.example.test"
ISSUER = "https://id.example.test/realms/kh"
# Two sign-ins made from this copy, the way _store records them.
for url, token in ((PROD, "refresh-prod"), (DEV, "refresh-dev")):
    s = session.Session(url)
    store[(session.SERVICE, s._account)] = token
session._save_state({"kh_url": DEV, "issuer": ISSUER, "client_id": "kh-cli", "signed_in": {"email": "a@b.c"},
                     "signed_in_to": [PROD, DEV], "issuers": {PROD: ISSUER, DEV: ISSUER}})
out = io.StringIO()
with contextlib.redirect_stdout(out):
    code = cli.main(sys.argv[1:])
after = session.Session(PROD)
try:
    after._access_token()
    still = True
except session.NotSignedIn:
    still = False
print(json.dumps({"code": code, "result": json.loads(out.getvalue()), "revoked": revoked,
                  "left_in_store": list(store.values()), "still_signed_in": still,
                  "state": session._load_state()}))
"""


def probe(args, home, profile):
    env = {k: v for k, v in os.environ.items() if k != "KH_HELPER_HOME"}
    env.update({"PYTHONPATH": str(HELPER), "KH_HELPER_HOME": str(home), "CLAUDE_CONFIG_DIR": str(profile)})
    out = subprocess.run([sys.executable, "-c", PROBE, *args], env=env, capture_output=True, text=True)
    if out.returncode != 0:
        return {"error": out.stderr.strip()[-600:]}
    return json.loads(out.stdout.strip().splitlines()[-1])


with tempfile.TemporaryDirectory() as tmp:
    profile = Path(tmp) / "profile"
    home = profile / "kh-helper"
    home.mkdir(parents=True)
    settings = profile / "settings.json"
    hook = {"type": "command", "command": '"py" -m kh_helper.cli hook Stop'}
    mine = {"type": "command", "command": "echo mine"}
    settings.write_text(json.dumps({"hooks": {"Stop": [{"hooks": [hook, mine]}]}}), encoding="utf-8")

    # ── 1. setup --remove ends the sign-in ───────────────────────────────────
    r = probe(["setup", "--remove", "--no-mcp", "--settings", str(settings)], home, profile)
    check("setup --remove runs", r.get("code") == 0, r)
    res = r.get("result", {})
    check("it still takes out only KH's hooks", res.get("hooks_removed") == 1
          and json.loads(settings.read_text(encoding="utf-8"))["hooks"]["Stop"][0]["hooks"] == [mine], res)
    check("both sign-ins are revoked at the identity service",
          sorted(t for _, t in r.get("revoked", [])) == ["refresh-dev", "refresh-prod"], r.get("revoked"))
    check("the answer says so, per KH",
          {k: v for k, v in (res.get("signed_out") or {}).items() if v != "none"}
          == {"https://kh-dev.example.test": "revoked", "https://kh.example.test": "revoked"}, res)
    check("nothing is left in the credential store", r.get("left_in_store") == [], r.get("left_in_store"))
    check("a later call is not signed in", r.get("still_signed_in") is False, r)
    check("state forgets who signed in", "signed_in" not in r.get("state", {})
          and r.get("state", {}).get("signed_in_to") == [], r.get("state"))

    # ── 2. uninstall leaves a folder that is not the documented install ──────
    r = probe(["uninstall"], home, profile)
    res = r.get("result", {})
    check("uninstall runs and ends the sign-ins", r.get("code") == 0 and r.get("left_in_store") == [], r)
    check("a folder that is not this Python's own venv is left in place",
          str(res.get("helper", "")).startswith("left in place") and home.exists(), res)

print()
print(f"{len(FAILURES)} failure(s)" if FAILURES else "all passed")
sys.exit(1 if FAILURES else 0)
