"""The signed-in session of one person on one machine, for one KH deployment.

WHAT IS KEPT WHERE
  * The refresh token (the 90-day sign-in) lives ONLY in the operating system's credential store
    (Windows Credential Manager, macOS Keychain, Linux Secret Service) through `keyring`.
  * Non-secret facts (KH url, identity service, who signed in, until when) live in helper.json in the
    helper's HOME (see _home): the helper's own install folder, which sits inside the CLI profile.
  * Each HOME keeps its own sign-in, so two profiles on one machine never share one.
  * A sign-in answers only the CLI and profile that made it (see owner.py); others are refused.
  * Access tokens (5 minutes) live in memory for one process and are never printed or returned.

The assistant never sees any of it: it asks the helper to make a call, and gets the answer.
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
import webbrowser
from dataclasses import dataclass
from pathlib import Path

import requests

from . import owner

SERVICE = "kh-helper"
# The one shared folder of machine-wide installs before 2026-09-26. No longer chosen by default: every
# profile that ran a machine-wide helper shared its sign-in. Still honoured through KH_HELPER_HOME.
LEGACY_HOME = Path.home() / ".kh"


def profile_dir() -> Path:
    """The CLI profile this process runs in. Claude Code: $CLAUDE_CONFIG_DIR, else ~/.claude."""
    base = os.getenv("CLAUDE_CONFIG_DIR")
    return Path(base) if base else Path.home() / ".claude"


def _home() -> Path:
    """Where this copy of the helper keeps its state.

    KH_HELPER_HOME wins when set. Otherwise a helper installed in its own virtual environment (the
    documented install: <CLI profile>/kh-helper) keeps its state in that folder. A machine-wide install
    keeps it in <profile of the calling CLI>/kh-helper, the same folder the documented install uses, so
    each profile has its own sign-in whichever copy of the helper it runs.
    """
    if os.getenv("KH_HELPER_HOME"):
        return Path(os.environ["KH_HELPER_HOME"])
    if sys.prefix != sys.base_prefix:
        return Path(sys.prefix)
    return profile_dir() / "kh-helper"


HOME = _home()
STATE_PATH = HOME / "helper.json"
DEFAULT_KH_URL = os.getenv("KH_URL", "https://knowledge-hub.cfapps.br10.hana.ondemand.com")
TIMEOUT = 60


class NotSignedIn(Exception):
    """Nobody is signed in to this KH on this machine, or the sign-in ended."""


class PasswordNotChanged(Exception):
    """kh password came back without a changed password (cancelled on the page, or Keycloak refused)."""


def _keyring():
    import keyring
    return keyring


def _load_state() -> dict:
    try:
        return json.loads(STATE_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _save_state(state: dict) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(json.dumps(state, indent=2), encoding="utf-8")


@dataclass
class AuthConfig:
    issuer: str
    client_id: str

    @classmethod
    def discover(cls, kh_url: str) -> "AuthConfig":
        resp = requests.get(kh_url.rstrip("/") + "/auth/config", timeout=TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
        return cls(issuer=data["issuer"].rstrip("/"), client_id=data["client_id"])

    @property
    def token_url(self) -> str:
        return f"{self.issuer}/protocol/openid-connect/token"


# A technical user (KH permission kh.act_for_user) passes the real person's own KH access token along,
# so KH knows whom each worklog is for (KH app/auth.py TECHNICAL USERS). The agent that runs this CLI for
# one person at a time sets either variable; the file is read on every call, so the agent can refresh it.
ACTING_ENV = "KH_ACTING_TOKEN"
ACTING_FILE_ENV = "KH_ACTING_TOKEN_FILE"
ACTING_HEADER = "X-KH-Acting-Token"


def acting_token_from_env() -> str | None:
    path = (os.environ.get(ACTING_FILE_ENV) or "").strip()
    if path:
        try:
            return Path(path).read_text(encoding="utf-8").strip() or None
        except OSError:
            return None
    return (os.environ.get(ACTING_ENV) or "").strip() or None


# The session this call belongs to (KH app/auth.py ACTORS): several CLI sessions share one sign-in, and KH tags
# what each writes and routes messages between them by it (1.18.0). A hook or worklog job names it from the CLI's
# own session id; an agent may set KH_ACTOR; otherwise the CLI's environment names it (Claude Code:
# CLAUDE_CODE_SESSION_ID), and the hook's latest id for this CLI process wins over that, because /clear and
# /resume change the id while the MCP server keeps its old environment.
ACTOR_ENV = "KH_ACTOR"
ACTOR_HEADER = "X-KH-Actor"
SESSION_ENVS = ("CLAUDE_CODE_SESSION_ID",)
ACTORS_PATH = HOME / "session-actors.json"


def actor_id(value) -> str | None:
    """A session id as KH takes it (letters, digits, '_.:-', at most 128), or None."""
    value = re.sub(r"[^A-Za-z0-9_.:-]", "_", str(value or "").strip())[:128]
    return value if value and value[0].isalnum() else None


def _cli_pid() -> str:
    return (os.environ.get("CLAUDE_PID") or "").strip()


def remember_actor(actor: str | None) -> None:
    """Record the hook's session id for this CLI process, so its MCP server names the same one. Never raises."""
    pid = _cli_pid()
    if not actor or not pid:
        return
    try:
        known = json.loads(ACTORS_PATH.read_text(encoding="utf-8")) if ACTORS_PATH.exists() else {}
        if not isinstance(known, dict):
            known = {}
        if known.get(pid, {}).get("actor") == actor:
            return
        now = time.time()
        known = {k: v for k, v in known.items() if isinstance(v, dict) and now - v.get("at", 0) < 7 * 86400}
        known[pid] = {"actor": actor, "at": now}
        ACTORS_PATH.parent.mkdir(parents=True, exist_ok=True)
        ACTORS_PATH.write_text(json.dumps(known), encoding="utf-8")
    except Exception:
        pass


def actor_from_env() -> str | None:
    explicit = actor_id(os.environ.get(ACTOR_ENV))
    if explicit:
        return explicit
    pid = _cli_pid()
    if pid:
        try:
            got = actor_id((json.loads(ACTORS_PATH.read_text(encoding="utf-8")).get(pid) or {}).get("actor"))
            if got:
                return got
        except Exception:
            pass
    for name in SESSION_ENVS:
        got = actor_id(os.environ.get(name))
        if got:
            return got
    return None


class Session:
    def __init__(self, kh_url: str | None = None):
        state = _load_state()
        self.kh_url = (kh_url or state.get("kh_url") or DEFAULT_KH_URL).rstrip("/")
        # The credential-store entry is per KH and per HOME; the legacy home keeps its old entry name.
        self._account = self.kh_url if HOME == LEGACY_HOME else f"{self.kh_url} {HOME}"
        self._access: str | None = None
        self._access_until = 0.0
        # The real person's token handed to a worklog worker; None reads the environment (acting_token_from_env).
        self.acting_token: str | None = None
        # The CLI session a hook or worklog job runs for; None reads the environment (actor_from_env), "" is none.
        self.actor: str | None = None

    def current_acting_token(self) -> str | None:
        return self.acting_token or acting_token_from_env()

    def current_actor(self) -> str | None:
        return self.actor if self.actor is not None else actor_from_env()

    def _headers(self) -> dict:
        headers = {"Authorization": f"Bearer {self._access_token()}"}
        acting = self.current_acting_token()
        if acting:
            headers[ACTING_HEADER] = acting
        actor = self.current_actor()
        if actor:
            headers[ACTOR_HEADER] = actor
        return headers

    # ── sign-in ─────────────────────────────────────────────────────────────
    def login(self, open_browser: bool = True, announce=print) -> dict:
        """The PERSON signs in in a browser; nothing is typed here.

        With a browser on this machine: authorization code + PKCE with a loopback redirect, the way gh and
        gcloud sign in - one page, no code to confirm. Keycloak always adds a consent screen to the device
        grant (RFC 8628 section 5.4), which people missed, so the device grant is only the fallback for a
        machine without a browser (open_browser=False) or when no local port can be opened.
        """
        owner.check(HOME, _load_state())            # never sign in over another CLI's sign-in
        cfg = AuthConfig.discover(self.kh_url)
        if open_browser:
            try:
                return self._login_browser(cfg, announce)
            except OSError:
                pass                             # no loopback port: fall back to the device grant
        return self._login_device(cfg, open_browser, announce)

    def change_password(self, announce=print) -> dict:
        """The PERSON changes their own KH password in a browser; nothing is typed here (1.13.1).

        Keycloak's application-initiated action (kc_action=UPDATE_PASSWORD) on the same sign-in page as
        `kh login`: the person signs in if needed, sets the new password, and comes back signed in. No account
        console is opened, so a kh-user gets this one page and nothing else of their account.
        """
        owner.check(HOME, _load_state())
        return self._login_browser(AuthConfig.discover(self.kh_url), announce, action="UPDATE_PASSWORD")

    def _login_browser(self, cfg: "AuthConfig", announce, action: str | None = None) -> dict:
        import base64
        import hashlib
        import secrets
        import threading
        import urllib.parse
        from http.server import BaseHTTPRequestHandler, HTTPServer

        verifier = secrets.token_urlsafe(64)
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
        state = secrets.token_urlsafe(24)
        got: dict = {}
        done = threading.Event()

        class Callback(BaseHTTPRequestHandler):
            def do_GET(self):                    # noqa: N802 - http.server's name
                query = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
                if "code" not in query and "error" not in query:
                    self.send_response(404)
                    self.end_headers()
                    return
                got.update(query)
                ok = "code" in query and query.get("state") == state
                done_text = "You're signed in to Knowledge Hub."
                if action:
                    ok = ok and query.get("kc_action_status") == "success"
                    done_text = "Your Knowledge Hub password is changed."
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.end_headers()
                self.wfile.write((
                    "<html><body style='font-family:sans-serif;padding:3em'><h2>"
                    + (done_text if ok else "The password was not changed." if action else "Sign-in did not complete.")
                    + "</h2><p>You can close this tab.</p></body></html>").encode())
                done.set()

            def log_message(self, *args):        # keep the console quiet
                pass

        server = HTTPServer(("127.0.0.1", 0), Callback)
        redirect = f"http://127.0.0.1:{server.server_port}/callback"
        params = {"client_id": cfg.client_id, "response_type": "code", "redirect_uri": redirect,
                  "scope": "openid offline_access", "state": state,
                  "code_challenge": challenge, "code_challenge_method": "S256"}
        if action:
            params["kc_action"] = action
        url = f"{cfg.issuer}/protocol/openid-connect/auth?" + urllib.parse.urlencode(params)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            lead = "Change your Knowledge Hub password in your browser" if action else "Sign in to Knowledge Hub in your browser"
            announce(f"{lead}:\n  {url}\n(waiting up to 10 minutes)")
            sys.stdout.flush()                  # an assistant running this in the background must see the link now
            try:
                webbrowser.open(url)
            except Exception:
                pass
            if not done.wait(600):
                raise NotSignedIn("the sign-in page was not completed in time")
        finally:
            server.shutdown()
            server.server_close()
        if got.get("state") != state:
            raise NotSignedIn("the sign-in answer did not match this request")
        if "code" not in got:
            raise NotSignedIn(got.get("error_description") or got.get("error") or "sign-in refused")
        if action and got.get("kc_action_status") != "success":
            # Cancelled or failed: the sign-in stays as it was and the password is unchanged.
            raise PasswordNotChanged(got.get("kc_action_status") or "no answer")
        resp = requests.post(cfg.token_url, timeout=TIMEOUT, data={
            "grant_type": "authorization_code", "code": got["code"], "redirect_uri": redirect,
            "client_id": cfg.client_id, "code_verifier": verifier})
        body = resp.json()
        if resp.status_code != 200:
            raise NotSignedIn(body.get("error_description") or body.get("error") or "sign-in refused")
        return self._store(cfg, body)

    def _login_device(self, cfg: "AuthConfig", open_browser: bool, announce) -> dict:
        """Device authorization grant, for a machine without a browser."""
        import base64
        import hashlib
        import secrets

        verifier = secrets.token_urlsafe(48)    # PKCE on the device grant too: the client may require it
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
        start = requests.post(f"{cfg.issuer}/protocol/openid-connect/auth/device",
                              data={"client_id": cfg.client_id, "scope": "openid offline_access",
                                    "code_challenge": challenge, "code_challenge_method": "S256"},
                              timeout=TIMEOUT)
        start.raise_for_status()
        device = start.json()
        url = device.get("verification_uri_complete") or device["verification_uri"]
        announce(f"Sign in to Knowledge Hub in your browser:\n  {url}\n"
                 f"Code: {device['user_code']}  (valid {device.get('expires_in', 600) // 60} minutes)")
        sys.stdout.flush()                      # an assistant running this in the background must see the link now
        if open_browser:
            try:
                webbrowser.open(url)
            except Exception:
                pass
        interval = int(device.get("interval", 5))
        deadline = time.time() + int(device.get("expires_in", 600))
        while time.time() < deadline:
            time.sleep(interval)
            resp = requests.post(cfg.token_url, timeout=TIMEOUT, data={
                "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
                "device_code": device["device_code"], "client_id": cfg.client_id, "code_verifier": verifier})
            body = resp.json()
            if resp.status_code == 200:
                return self._store(cfg, body)
            error = body.get("error")
            if error == "slow_down":
                interval += 5
            elif error != "authorization_pending":
                raise NotSignedIn(body.get("error_description") or error or "sign-in refused")
        raise NotSignedIn("the sign-in page was not completed in time")

    def logout(self) -> bool:
        """Revoke the sign-in at the identity service, then forget it here."""
        return self._forget(self.kh_url) == "revoked"

    def logout_all(self) -> dict:
        """Revoke and forget EVERY sign-in this copy holds, for every KH it signed in to (2026-09-28).

        Removing KH from a CLI used to leave the 90-day sign-in in the credential store, so `kh setup`
        brought everything back without the person signing in again. Taking KH out now ends the sign-in.
        """
        state = _load_state()
        urls = [*state.get("signed_in_to", []), state.get("kh_url"), self.kh_url, DEFAULT_KH_URL]
        return {url: self._forget(url) for url in dict.fromkeys(u.rstrip("/") for u in urls if u)}

    def _forget(self, kh_url: str) -> str:
        """Revoke one KH's sign-in and delete it here: 'revoked', 'forgotten' (revoke failed) or 'none'."""
        state = _load_state()
        account = kh_url if HOME == LEGACY_HOME else f"{kh_url} {HOME}"
        try:
            refresh = _keyring().get_password(SERVICE, account)
        except Exception:
            refresh = None
        result = "none"
        if refresh:
            result = "forgotten"
            issuer = (state.get("issuers") or {}).get(kh_url) or state.get("issuer")
            if issuer:
                try:
                    resp = requests.post(f"{issuer}/protocol/openid-connect/revoke", timeout=TIMEOUT,
                                         data={"token": refresh, "token_type_hint": "refresh_token",
                                               "client_id": state.get("client_id", "kh-cli")})
                    result = "revoked" if resp.status_code == 200 else result
                except requests.RequestException:
                    pass
            try:
                _keyring().delete_password(SERVICE, account)
            except Exception:
                pass
        state["signed_in_to"] = [u for u in state.get("signed_in_to", []) if u != kh_url]
        if kh_url == (state.get("kh_url") or "").rstrip("/"):
            state.pop("signed_in", None)
        _save_state(state)
        if kh_url == self.kh_url:
            self._access = None
        return result

    def status(self) -> dict:
        state = _load_state()
        owner.check(HOME, state)
        signed = state.get("signed_in") or {}
        return {"kh_url": self.kh_url, "signed_in": bool(self._refresh_token()),
                "email": signed.get("email"), "until": signed.get("until"), "home": str(HOME),
                "owner": owner.owner_of(HOME, state, owner.caller())}

    # ── calls ───────────────────────────────────────────────────────────────
    def call(self, method: str, path: str, body=None, params: dict | None = None) -> tuple[int, object]:
        """Call KH as the signed-in person. Returns (status, parsed body)."""
        path = _unmangle(path)
        if not path.startswith("/"):
            path = "/" + path
        for attempt in (1, 2):
            resp = _send(method.upper(), self.kh_url + path, json=body, params=params,
                         timeout=TIMEOUT, headers=self._headers())
            if resp.status_code == 401 and attempt == 1:
                self._access = None                 # expired between refresh and use; try once more
                continue
            break
        try:
            payload = resp.json()
        except ValueError:
            payload = resp.text
        if isinstance(payload, dict) and payload.get("token_refresh_needed"):
            self._access = None                     # a new project: the next token will carry it
        return resp.status_code, payload

    def call_identity(self, method: str, path: str, body=None) -> tuple[int, object]:
        """Call the KH endpoints of the identity service (/realms/<realm>/kh/...) as the signed-in person.

        People and the access model live there, not in KH: GET catalog, GET/PUT/DELETE
        projects/<id>/members[/<email>]. Keycloak checks every request against its own tables.
        """
        issuer = _load_state().get("issuer") or AuthConfig.discover(self.kh_url).issuer
        url = issuer.rstrip("/") + "/kh/" + path.lstrip("/")
        for attempt in (1, 2):
            resp = _send(method.upper(), url, json=body, timeout=TIMEOUT, headers=self._headers())
            if resp.status_code == 401 and attempt == 1:
                self._access = None
                continue
            break
        try:
            payload = resp.json() if resp.content else None
        except ValueError:
            payload = resp.text
        return resp.status_code, payload

    # ── internals ───────────────────────────────────────────────────────────
    def _store(self, cfg: AuthConfig, token_response: dict) -> dict:
        refresh = token_response["refresh_token"]
        _keyring().set_password(SERVICE, self._account, refresh)
        claims = _claims(token_response["access_token"])
        refresh_claims = _claims(refresh)
        signed = {"email": claims.get("email"),
                  "until": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(refresh_claims.get("exp", 0)))
                  if refresh_claims.get("exp") else None}
        # signed_in_to + issuers remember every KH signed in to from here, so logout_all can end them all.
        previous = _load_state()
        signed_in_to = list(dict.fromkeys([*previous.get("signed_in_to", []), self.kh_url]))
        issuers = {**previous.get("issuers", {}), self.kh_url: cfg.issuer}
        _save_state({"kh_url": self.kh_url, "issuer": cfg.issuer, "client_id": cfg.client_id,
                     "signed_in": signed, "owner": owner.record(HOME),
                     "signed_in_to": signed_in_to, "issuers": issuers})
        self._access = token_response["access_token"]
        self._access_until = time.time() + int(token_response.get("expires_in", 60)) - 20
        return signed

    def _refresh_token(self) -> str | None:
        try:
            return _keyring().get_password(SERVICE, self._account)
        except Exception:
            return None

    def _access_token(self) -> str:
        if self._access and time.time() < self._access_until:
            return self._access
        state = _load_state()
        owner.check(HOME, state)                    # the one door every use of the sign-in goes through
        refresh = self._refresh_token()
        if not refresh or not state.get("issuer"):
            raise NotSignedIn("nobody is signed in to KH on this machine - ask the person to run: kh login")
        resp = _send("POST", f"{state['issuer']}/protocol/openid-connect/token", timeout=TIMEOUT, data={
            "grant_type": "refresh_token", "refresh_token": refresh,
            "client_id": state.get("client_id", "kh-cli")})
        if resp.status_code != 200:
            raise NotSignedIn("the KH sign-in has ended or was revoked - ask the person to run: kh login")
        body = resp.json()
        if body.get("refresh_token") and body["refresh_token"] != refresh:
            _keyring().set_password(SERVICE, self._account, body["refresh_token"])
        self._access = body["access_token"]
        self._access_until = time.time() + int(body.get("expires_in", 60)) - 20
        return self._access


CONNECT_RETRY_SECONDS = 1.5


def _send(method: str, url: str, **kwargs) -> requests.Response:
    """requests.request with one retry when no connection was made (1.17.2).

    A DNS lookup that fails for a moment (getaddrinfo 11001, many in the logs of 2026-10-19..22) or a
    refused connection means nothing reached KH, so trying once more is safe even for a POST. A read
    timeout is not retried: the request may have arrived, and the caller already waited TIMEOUT.
    """
    from urllib3.exceptions import NewConnectionError   # NameResolutionError is one of these
    try:
        return requests.request(method, url, **kwargs)
    except requests.exceptions.ConnectionError as exc:
        reason = getattr(exc.args[0] if exc.args else None, "reason", None)
        if not (isinstance(exc, requests.exceptions.ConnectTimeout) or isinstance(reason, NewConnectionError)):
            raise                                          # e.g. aborted mid-answer: it may have reached KH
        time.sleep(CONNECT_RETRY_SECONDS)
        return requests.request(method, url, **kwargs)


def _claims(token: str) -> dict:
    import base64
    try:
        payload = token.split(".")[1]
        return json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    except Exception:
        return {}


def _unmangle(path: str) -> str:
    """Undo Git Bash (MSYS) path conversion, which turns `/vector/add` into
    `C:/Program Files/Git/vector/add` before the helper ever sees it."""
    import re
    found = re.match(r"^[A-Za-z]:[\\/].*?[\\/]Git(?:[\\/]usr)?([\\/].+)$", path)
    return found.group(1).replace("\\", "/") if found else path
