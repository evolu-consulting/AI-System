"""Tests for where the KH helper keeps its state and sign-in (tools/kh-helper), 2026-09-25.

WHAT IS UNDER TEST
  1. THE HOME. A helper installed in its own virtual environment (the documented install,
     <CLI profile>/kh-helper) keeps helper.json in that folder; KH_HELPER_HOME overrides it; a
     machine-wide install keeps it in <profile of the calling CLI>/kh-helper, never the shared ~/.kh
     (2026-09-26: two profiles running the machine-wide `kh` shared one sign-in there).
  2. ONE SIGN-IN PER HOME. Two homes use two different credential-store entries, so two profiles
     on one machine never share a sign-in; the old ~/.kh keeps its old entry name.
  3. THE HOOKS FOLLOW THE COPY. kh setup writes hooks that run the same Python that ran setup, so a
     profile's hooks call the helper inside that profile.

Run from the repo root with the project venv (itself a virtual environment, which is the point):
    .venv\\Scripts\\python tests\\test_kh_helper_home.py

Each case runs in a child Python so the module-level HOME is computed fresh; no network, and the
credential store is replaced by an in-memory one.
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
import json, os, sys
from pathlib import Path
from kh_helper import owner, session
# This file tests WHERE state lives, not WHO may use it (test_kh_helper_owner.py), so the caller is fixed
# by the case, whichever CLI or terminal runs the test: Claude Code in the profile it names when
# PROBE_AS_CLAUDE=1, otherwise a CLI that is not Claude Code.
owner.caller = (lambda: {"cli": owner.CLAUDE_CODE,
                         "profile": owner._resolve(os.getenv("CLAUDE_CONFIG_DIR") or Path.home() / ".claude")}
                ) if os.getenv("PROBE_AS_CLAUDE") == "1" else (lambda: {"cli": owner.OTHER})
store = {}
class FakeKeyring:
    def set_password(self, service, account, value): store[(service, account)] = value
    def get_password(self, service, account): return store.get((service, account))
    def delete_password(self, service, account): store.pop((service, account), None)
session._keyring = lambda: FakeKeyring()
s = session.Session("https://kh.example.test")
session._keyring().set_password(session.SERVICE, s._account, "refresh")
print(json.dumps({"home": str(session.HOME), "state": str(session.STATE_PATH), "account": s._account,
                  "prefix": sys.prefix, "legacy": str(session.LEGACY_HOME),
                  "status_home": s.status()["home"], "signed_in": s.status()["signed_in"]}))
"""


def probe(env_extra=None, python=sys.executable, isolated=False, drop=()):
    env = {k: v for k, v in os.environ.items() if k != "KH_HELPER_HOME" and k not in drop}
    env["PYTHONPATH"] = str(HELPER)
    env.update(env_extra or {})
    args = [python] + (["-S"] if isolated else []) + ["-c", PROBE]
    out = subprocess.run(args, env=env, capture_output=True, text=True)
    if out.returncode != 0:
        return {"error": out.stderr.strip()[-400:]}
    return json.loads(out.stdout)


in_venv = sys.prefix != sys.base_prefix
check("this test runs inside a virtual environment", in_venv, sys.prefix)

# ── 1. the home ──────────────────────────────────────────────────────────────
r = probe()
check("a helper in a virtual environment keeps its state in that folder",
      r.get("home") == sys.prefix and r.get("state") == str(Path(sys.prefix) / "helper.json"), r)
check("status reports the home", r.get("status_home") == sys.prefix, r)

custom = tempfile.mkdtemp(prefix="kh_home_")
r2 = probe({"KH_HELPER_HOME": custom})
check("KH_HELPER_HOME overrides the folder", r2.get("home") == custom, r2)

# ── 2. one sign-in per home ──────────────────────────────────────────────────
check("two homes use two credential-store entries", r.get("account") != r2.get("account"), (r, r2))
check("the entry names the KH and the home",
      r.get("account") == f"https://kh.example.test {sys.prefix}", r.get("account"))
r3 = probe({"KH_HELPER_HOME": r.get("legacy", "")})
check("the old ~/.kh keeps its old entry name", r3.get("account") == "https://kh.example.test", r3)
check("a stored sign-in reads back under the same entry", r.get("signed_in") is True, r)

# ── 2b. a machine-wide install follows the calling profile ──────────────────
BASE = getattr(sys, "_base_executable", None) or sys.executable
prof_a = tempfile.mkdtemp(prefix="kh_prof_a_")
prof_b = tempfile.mkdtemp(prefix="kh_prof_b_")
ma = probe({"CLAUDE_CONFIG_DIR": prof_a, "PROBE_AS_CLAUDE": "1"}, python=BASE)
mb = probe({"CLAUDE_CONFIG_DIR": prof_b, "PROBE_AS_CLAUDE": "1"}, python=BASE)
md = probe({"PROBE_AS_CLAUDE": "1"}, python=BASE, drop=("CLAUDE_CONFIG_DIR",))
check("the probe really ran outside a virtual environment", ma.get("prefix") and ma.get("prefix") != sys.prefix, ma)
check("machine-wide: state lives in the calling profile",
      ma.get("home") == str(Path(prof_a) / "kh-helper") and ma.get("state") == str(Path(prof_a) / "kh-helper" / "helper.json"), ma)
check("machine-wide: another profile gets another home", mb.get("home") == str(Path(prof_b) / "kh-helper"), mb)
check("machine-wide: two profiles use two credential-store entries", ma.get("account") != mb.get("account"), (ma, mb))
check("machine-wide: with no CLAUDE_CONFIG_DIR the default profile is used",
      md.get("home") == str(Path.home() / ".claude" / "kh-helper"), md)
check("machine-wide: the default profile shares its entry with the documented install there",
      md.get("account") == f"https://kh.example.test {Path.home() / '.claude' / 'kh-helper'}", md)
check("machine-wide: the shared ~/.kh is never chosen by default",
      all(r_.get("home") != r_.get("legacy") for r_ in (ma, mb, md)), (ma, mb, md))

# ── 3. the hooks follow the copy ─────────────────────────────────────────────
sys.path.insert(0, str(HELPER))
from kh_helper.hooks import hook_exe, setup_claude  # noqa: E402

settings = Path(tempfile.mkdtemp(prefix="kh_profile_")) / "settings.json"
settings.write_text(json.dumps({"hooks": {"Stop": [{"hooks": [{"type": "command", "command": "mine"}]}]}}))
result = setup_claude(settings, "https://kh.example.test", mcp=False)
written = json.loads(settings.read_text())
commands = [h["command"] for groups in written["hooks"].values() for g in groups for h in g["hooks"]]
ours = [c for c in commands if "kh_helper.cli hook" in c]
check("setup adds every helper hook", result["hooks_added"] == 10 and len(ours) == 10, result)
check("every hook runs the Python that ran setup", all(c.startswith(hook_exe() + " ") for c in ours), ours)
check("the person's own hook is kept", "mine" in commands, commands)

# ── 4. --kh-url before or after the command ──────────────────────────────────
from kh_helper import cli, owner, session  # noqa: E402
owner.caller = lambda: {"cli": owner.OTHER}   # the in-process sign-in below is not about ownership

seen_urls = []
session.Session.status = lambda self: seen_urls.append(self.kh_url) or {}
cli.main(["--kh-url", "https://a.test", "status"])
cli.main(["status", "--kh-url", "https://b.test"])
check("--kh-url works before and after the command", seen_urls == ["https://a.test", "https://b.test"], seen_urls)

# ── 5. browser sign-in: authorization code + PKCE on a loopback port ─────────
import base64  # noqa: E402
import hashlib  # noqa: E402
import urllib.parse  # noqa: E402
import urllib.request  # noqa: E402


def fake_jwt(claims):
    part = base64.urlsafe_b64encode(json.dumps(claims).encode()).rstrip(b"=").decode()
    return f"e30.{part}.sig"


class FakeResp:
    def __init__(self, status, body):
        self.status_code, self._body = status, body

    def json(self):
        return self._body


sent = {}
store = {}


def browser_that_signs_in(state_override=None):
    def open_url(url):
        q = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(url).query))
        sent.update(q)
        back = q["redirect_uri"] + "?" + urllib.parse.urlencode(
            {"code": "the-code", "state": state_override or q["state"]})
        urllib.request.urlopen(back, timeout=10).read()
    return open_url


def token_endpoint(url, data=None, timeout=None):
    sent["token_form"] = data
    return FakeResp(200, {"access_token": fake_jwt({"email": "person@example.invalid"}), "expires_in": 300,
                          "refresh_token": fake_jwt({"exp": 2000000000})})


session.AuthConfig.discover = classmethod(lambda cls, url: cls(issuer="https://idp.test/realms/kh", client_id="kh-cli"))
session._keyring = lambda: type("K", (), {"set_password": lambda self, s, a, v: store.__setitem__(a, v),
                                          "get_password": lambda self, s, a: store.get(a)})()
session._save_state = lambda state: None
session.requests.post = token_endpoint
session.webbrowser.open = browser_that_signs_in()
signed = session.Session("https://kh.example.test").login(announce=lambda *_: None)
check("browser sign-in returns who signed in", signed.get("email") == "person@example.invalid", signed)
check("it asks for a code with PKCE S256 on a loopback redirect",
      sent.get("response_type") == "code" and sent.get("code_challenge_method") == "S256"
      and sent.get("redirect_uri", "").startswith("http://127.0.0.1:"), sent)
form = sent.get("token_form") or {}
check("the code is exchanged with the matching verifier",
      form.get("grant_type") == "authorization_code" and base64.urlsafe_b64encode(
          hashlib.sha256(form.get("code_verifier", "").encode()).digest()).rstrip(b"=").decode()
      == sent.get("code_challenge"), form)
check("the refresh token lands in the credential store", len(store) == 1)
session.webbrowser.open = browser_that_signs_in(state_override="forged")
try:
    session.Session("https://kh.example.test").login(announce=lambda *_: None)
    check("an answer for another request is refused", False)
except session.NotSignedIn:
    check("an answer for another request is refused", True)

print(f"\n{'ALL PASS' if not FAILURES else 'FAILED'}  ({len(FAILURES)} failed)")
sys.exit(1 if FAILURES else 0)
