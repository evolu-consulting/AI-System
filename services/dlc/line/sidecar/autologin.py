"""DLC Autologin: the engine's own vault of web-app accounts its agents may sign in to.

The person who runs DLC enters each account in Admin > Sidecars > Autologin (name, URL, environment, kind,
user name, password, which agent groups may use it). Every entry is 'never ask': the accounts put here are
already cleared for agents, so there is no confirmation step. Agents never see a password: the engine signs
in inside its own (headless) Chrome profile per entry (line.sidecar.cdp) and the agent works through that
session with the tools of line.agent_tools.

Storage: DLC_HOME/secrets/autologin.json (ACL: SYSTEM + Administrators + the engine account; mode 600
elsewhere). On Windows each password is also sealed with DPAPI for the engine account.

Kinds: password (fill user + password), sso (click the provider button, then the IdP form), passcode (SAP
one-time code page: used by cf_login only, the code is never returned), steps (the person's own sign-in steps
for a login page the heuristics miss) and cli (step 1 runs a PowerShell sign-in command on the engine host,
e.g. gcloud auth login; the page steps finish the browser part: used by cli_login only). Every kind runs as
steps (line.sidecar.steps): an entry without its own runs its kind's preset; steps that read a passcode make
the entry a passcode entry, steps that start with 'run' a cli entry.

GET  /api/admin/sidecars/autologin                  {"entries": [entry]}    no secrets (has_secret)
POST /api/admin/sidecars/autologin {entry}          add -> entry
POST /api/admin/sidecars/autologin/{id} {entry}     change (an empty password keeps the stored one)
POST /api/admin/sidecars/autologin/{id}:delete
POST /api/admin/sidecars/autologin/{id}:test        sign in once -> {"signed_in", "text"}
"""

from __future__ import annotations

import base64
import json
import os
import re
import shutil
import subprocess
import threading
import time
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlsplit

KINDS = ("password", "sso", "passcode", "steps", "cli")
GROUPS = ("spec", "dev", "deploy", "test")
PORT_BASE = 9600
CF_TIMEOUT = 90

_lock = threading.Lock()
_entry_locks: Dict[int, threading.Lock] = {}


def _home() -> str:
    return os.environ.get("DLC_HOME", "").strip() or os.path.join(os.path.expanduser("~"), "dlc")


def path() -> str:
    return os.path.join(_home(), "secrets", "autologin.json")


# ------------------------------------------------------------------ sealing (DPAPI on Windows)

def _dpapi(data: bytes, protect: bool) -> bytes:
    import ctypes
    from ctypes import wintypes

    class Blob(ctypes.Structure):
        _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_char))]

    buf = ctypes.create_string_buffer(data, len(data))
    src, out = Blob(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_char))), Blob()
    fn = ctypes.windll.crypt32.CryptProtectData if protect else ctypes.windll.crypt32.CryptUnprotectData
    if not fn(ctypes.byref(src), None, None, None, None, 0x1, ctypes.byref(out)):   # 0x1: UI forbidden
        raise ValueError("the stored password cannot be read by this account (DPAPI)")
    try:
        return ctypes.string_at(out.pbData, out.cbData)
    finally:
        ctypes.windll.kernel32.LocalFree(out.pbData)


def _seal(secret: str) -> str:
    raw = secret.encode("utf-8")
    if os.name == "nt":
        return "dpapi:" + base64.b64encode(_dpapi(raw, True)).decode()
    return "b64:" + base64.b64encode(raw).decode()


def _open(sealed: str) -> str:
    kind, _, data = (sealed or "").partition(":")
    if kind == "dpapi":
        return _dpapi(base64.b64decode(data), False).decode("utf-8")
    if kind == "b64":
        return base64.b64decode(data).decode("utf-8")
    return ""


# ------------------------------------------------------------------ store

def _load() -> Dict[str, Any]:
    try:
        with open(path(), encoding="utf-8") as fh:
            d = json.load(fh)
        return d if isinstance(d, dict) else {"entries": []}
    except (OSError, ValueError):
        return {"entries": []}


def _save(d: Dict[str, Any]) -> None:
    from ..claude_token import _lock_down
    p = path()
    os.makedirs(os.path.dirname(p), exist_ok=True)
    tmp = p + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(d, fh, indent=1)
    _lock_down(tmp)
    os.replace(tmp, p)


def _public(e: Dict[str, Any]) -> Dict[str, Any]:
    out = {k: v for k, v in e.items() if k != "secret"}
    out["has_secret"] = bool(e.get("secret"))
    return out


def public_entries() -> List[Dict[str, Any]]:
    return [_public(e) for e in _load().get("entries", [])]


def entries_for(group: str) -> List[Dict[str, Any]]:
    return [e for e in public_entries() if e.get("enabled") and group in (e.get("roles") or [])]


def _named(e: Dict[str, Any], apps: List[str]) -> bool:
    keys = {str(a).strip().lower() for a in apps if str(a).strip()}
    return str(e.get("id")) in keys or str(e.get("name") or "").lower() in keys


def entries_named(apps: List[str]) -> List[Dict[str, Any]]:
    """A run hook names its entries (line.hooks 'apps'): those, when enabled, whatever their agent groups."""
    return [e for e in public_entries() if e.get("enabled") and _named(e, apps or [])]


def _allowed(group: str, apps: Optional[List[str]] = None, public: bool = False) -> List[Dict[str, Any]]:
    rows = public_entries() if public else _load().get("entries", [])
    if apps is not None:
        return [x for x in rows if x.get("enabled") and _named(x, apps)]
    return [x for x in rows if x.get("enabled") and group in (x.get("roles") or [])]


def _steps_facts(text: str) -> Tuple[Optional[str], str, bool]:
    """(the kind the steps imply or None, the provider of their first sso step, whether they type the password)."""
    from .steps import parse_steps
    steps = parse_steps(text)
    actions = [a for a, _, _ in steps]
    sso = next(((t, v) for a, t, v in steps if a == "sso"), None)
    provider = (sso[0] + (" :: " + sso[1] if sso[1] else "")) if sso else ""
    implied = "cli" if "run" in actions else "passcode" if "passcode" in actions else None
    return implied, provider, "login" in actions or any("{{password}}" in (v or "") for a, _, v in steps if a == "fill")


def _needs_secret(e: Dict[str, Any]) -> bool:
    if e.get("steps"):
        return _steps_facts(e["steps"])[2]
    return e.get("kind") in ("password", "passcode")


def _clean(body: Dict[str, Any], old: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    from .steps import account_steps, parse_steps
    e = dict(old or {})
    for k in ("name", "url", "env", "kind", "username", "provider", "steps"):
        if k in body or not old:
            e[k] = str(body.get(k) or "").strip()
    e["kind"] = e.get("kind") or "password"
    if not e["name"]:
        raise ValueError("name is required")
    if e["kind"] not in KINDS:
        raise ValueError("kind must be one of %s" % ", ".join(KINDS))
    if e.get("steps"):
        if not parse_steps(e["steps"]):
            raise ValueError("steps: write at least one step")
        implied, provider, _ = _steps_facts(e["steps"])
        # the steps decide: a passcode or run step makes the kind, any other set of steps is kind 'steps'
        e["kind"], e["provider"] = implied or ("steps" if e["kind"] in ("cli", "passcode") else e["kind"]), provider
    elif e["kind"] == "steps":
        raise ValueError("a steps entry needs its sign-in steps")
    parse_steps(account_steps(e))        # a kind without steps needs what its preset needs (sso: a provider)
    u = urlsplit(e.get("url") or "")
    if u.scheme not in ("http", "https") or not u.hostname:
        raise ValueError("url must be an http(s) address")
    e["host"] = u.hostname.lower()
    if "roles" in body or not old:
        roles = body.get("roles") if isinstance(body.get("roles"), list) else list(GROUPS)
        e["roles"] = [r for r in GROUPS if r in roles]
    if "enabled" in body or not old:
        e["enabled"] = bool(body.get("enabled", True))
    if str(body.get("secret") or ""):
        e["secret"] = _seal(str(body["secret"]))
    return e


def add(body: Dict[str, Any]) -> Dict[str, Any]:
    with _lock:
        d = _load()
        entries = d.setdefault("entries", [])
        e = _clean(body)
        if any(x["name"].lower() == e["name"].lower() for x in entries):
            raise ValueError("an entry named %s exists" % e["name"])
        e["id"] = max([x["id"] for x in entries] + [0]) + 1
        entries.append(e)
        _save(d)
        return _public(e)


def change(eid: int, body: Dict[str, Any]) -> Dict[str, Any]:
    with _lock:
        d = _load()
        entries = d.get("entries", [])
        for i, x in enumerate(entries):
            if x["id"] == eid:
                e = _clean(body, x)
                if any(y["id"] != eid and y["name"].lower() == e["name"].lower() for y in entries):
                    raise ValueError("an entry named %s exists" % e["name"])
                entries[i] = e
                _save(d)
                return _public(e)
    raise KeyError(eid)


def remove(eid: int) -> None:
    with _lock:
        d = _load()
        n = len(d.get("entries", []))
        d["entries"] = [x for x in d.get("entries", []) if x["id"] != eid]
        if len(d["entries"]) == n:
            raise KeyError(eid)
        _save(d)
    try:
        from . import cdp
        cdp.close_browser(PORT_BASE + eid)
    except Exception:   # noqa: BLE001 - the window may not be open
        pass


def _entry(eid: int) -> Dict[str, Any]:
    for x in _load().get("entries", []):
        if x["id"] == eid:
            return x
    raise KeyError(eid)


# ------------------------------------------------------------------ sessions

def _find(group: str, app: str, apps: Optional[List[str]] = None) -> Dict[str, Any]:
    key = str(app or "").strip()
    if not key:
        raise ValueError("app is required")
    allowed = _allowed(group, apps)
    hit = (next((x for x in allowed if str(x["id"]) == key), None)
           or next((x for x in allowed if x["name"].lower() == key.lower()), None)
           or next((x for x in allowed if x["host"] == key.split("://")[-1].split("/")[0].lower()), None))
    if not hit:
        names = ", ".join(x["name"] for x in allowed) or "none"
        raise ValueError("No app '%s' for this agent. Available: %s" % (key, names))
    return hit


def _sign_in(e: Dict[str, Any]) -> Dict[str, Any]:
    from . import cdp
    if not e.get("secret") and _needs_secret(e):
        raise ValueError("%s has no password stored: add it in Admin > Sidecars > Autologin" % e["name"])
    lock = _entry_locks.setdefault(e["id"], threading.Lock())
    with lock:
        try:
            return cdp.sign_in(dict(_public(e), id=e["id"]), _open(e.get("secret", "")), port=PORT_BASE + e["id"])
        except (OSError, RuntimeError, TimeoutError) as ex:
            raise ValueError("Sign-in to %s failed: %s" % (e["name"], ex))


def _session_line(e: Dict[str, Any], r: Dict[str, Any]) -> str:
    tab = r.get("tab") or {}
    if "command_exit" in r:                 # kind cli: how the command ended is the answer
        rc = r["command_exit"]
        how = ("finished (exit 0)" if rc == 0 else "failed (exit %s)" % rc if rc is not None
               else "was stopped: it was still waiting" + (" (%s)" % r["step_failed"] if r.get("step_failed") else ""))
        return ("CLI sign-in %s: the command %s.\n%s" % (e["name"], how, r.get("command_output") or "")).strip()
    if r.get("step_failed"):
        return ("Not signed in to %s: the sign-in stopped at %s. Page: '%s' at %s. Ask the person to check the "
                "entry's steps in Admin > Sidecars > Autologin." % (e["name"], r["step_failed"], tab.get("title", ""),
                                                                   tab.get("url", "")))
    if r.get("signed_in"):
        return "Signed in to %s (%s). Page: '%s' at %s." % (e["name"], e.get("env") or "env?", tab.get("title", ""),
                                                            tab.get("url", ""))
    return ("Not signed in to %s: the sign-in did not finish (MFA or an unknown form). Page: '%s' at %s. "
            "Ask the person to check the entry in Admin > Sidecars > Autologin." % (e["name"], tab.get("title", ""),
                                                                                  tab.get("url", "")))


def _page(e: Dict[str, Any]):
    from . import cdp
    r = _sign_in(e)
    if not r.get("signed_in"):
        raise ValueError(_session_line(e, r))
    return cdp.Page(r["debug_port"])


def _eval_async(page: Any, expr: str, repl: bool = True) -> Any:
    """Evaluate in the page; repl=True allows top-level await and returns the last expression (run_js)."""
    r = page.call("Runtime.evaluate", expression=expr, returnByValue=True, awaitPromise=True, replMode=repl)
    if r.get("exceptionDetails"):
        ex = r["exceptionDetails"]
        raise ValueError("Script error: %s" % ((ex.get("exception") or {}).get("description") or ex.get("text")))
    return (r.get("result") or {}).get("value")


def _open_url(page: Any, url: str) -> None:
    from . import cdp
    page.navigate(url)
    time.sleep(1)
    cdp.settle(page)


def _clip(text: str, limit: Any, default: int = 8000) -> str:
    n = max(500, min(int(limit or default), 30000))
    return text if len(text) <= n else text[:n] + "\n[... %d more characters]" % (len(text) - n)


def call(tool: str, group: str, args: Dict[str, Any], apps: Optional[List[str]] = None, holder: str = "",
         label: str = "") -> str:
    """One agent tool (line.agent_tools SESSION_TOOLS) for an agent of this group (or, for a run hook, of the
    entries it names in `apps`). An app is DLC Autologin's own entry, else one of the App Session Manager's
    (line.sidecar.asm). Every tool on an app holds the app's lock (line.sidecar.app_locks): one agent at a
    time, the others wait in line; holder is the agent call's token."""
    from . import app_locks, asm
    if tool == "list_apps":
        rows = _allowed(group, apps, public=True)
        out = ["- %s (%s, %s): %s%s%s" % (x["name"], x.get("env") or "env?", x["kind"], x["url"],
                                          " - passcode entry: use cf_login" if x["kind"] == "passcode"
                                          else " - cli entry: use cli_login" if x["kind"] == "cli" else "",
                                          app_locks.busy_note("app:" + x["name"], holder)) for x in rows]
        if asm.enabled():
            for line in asm.list_apps().splitlines():
                m = re.match(r"^- (.+?) \(", line.strip())
                if m and (apps is None or m.group(1).lower() in {a.lower() for a in apps}):
                    out.append(line.strip() + app_locks.busy_note("app:" + m.group(1), holder))
        return ("\n".join(out) + "\nEach app is one shared session: one agent at a time. A busy app makes the tool "
                "wait in line, then answer BUSY; call release_app when you are done with it.") if out \
            else "No app is set up for this agent."
    name = str(args.get("app") or "").strip()
    if not name:
        raise ValueError("app is required")
    if tool == "release_app":
        app_locks.release("app:" + name, holder)
        return "Released %s." % name
    key = "cf" if tool == "cf_login" else "app:" + name   # cf: one CLI target for the whole machine
    got, info = app_locks.acquire(key, holder or "anonymous", label, app_locks.WAIT_S)
    if not got:
        return ("BUSY: %s is in use by %s for %ds (%d more waiting). It is a single shared session: wait a "
                "little, then call the tool again (your place in line is kept)." % (
                    name if key != "cf" else "the cf CLI", info["holder_label"], info["since_s"], info["waiting"]))
    try:
        e = _find(group, name, apps)
    except ValueError:
        if not asm.enabled():
            raise
        return _asm_call(tool, name, args)
    if tool == "cf_login":
        return _cf_login(e, args)
    if tool == "cli_login":
        return _cli_login(e)
    if e["kind"] == "passcode":
        raise ValueError("%s is a passcode entry: use cf_login" % e["name"])
    if e["kind"] == "cli":
        raise ValueError("%s is a cli entry: use cli_login" % e["name"])
    if tool == "get_session":
        return _session_line(e, _sign_in(e))
    return _page_tool(tool, _page(e), args)


def _asm_call(tool: str, name: str, args: Dict[str, Any]) -> str:
    """A tool on an app of the App Session Manager (the person's sessions on this machine)."""
    from . import asm, cdp
    if tool == "cf_login":
        return asm.cf_login(name, str(args.get("org") or ""), str(args.get("space") or ""))
    if tool == "cli_login":
        return asm.cli_login(name)
    s = asm.get_session(name)
    if tool == "get_session":
        return s["text"]
    if not s["port"]:
        raise ValueError(s["text"])
    return _page_tool(tool, cdp.Page(s["port"]), args)


def _page_tool(tool: str, page: Any, args: Dict[str, Any]) -> str:
    """open_page / fetch / run_js on a signed-in page; the page connection is closed after."""
    try:
        if tool == "open_page":
            url = str(args.get("url") or "").strip()
            if not url:
                raise ValueError("url is required")
            _open_url(page, url)
            title = page.eval("document.title") or ""
            text = page.eval("document.body ? document.body.innerText : ''") or ""
            return "Page '%s' at %s\n\n%s" % (title, page.url(), _clip(text, args.get("max_chars")))
        if tool == "fetch":
            url = str(args.get("url") or "").strip()
            if not url:
                raise ValueError("url is required")
            target, here = urlsplit(url), urlsplit(page.url())
            if (target.scheme, target.netloc) != (here.scheme, here.netloc):
                _open_url(page, "%s://%s/" % (target.scheme, target.netloc))   # same origin as the request
            method = str(args.get("method") or "GET").upper()
            body = args.get("body")
            js = ("(async()=>{const r=await fetch(%s,{method:%s,credentials:'include',headers:{'Accept':"
                  "'application/json, text/plain, */*'%s}%s});return JSON.stringify({status:r.status,"
                  "type:r.headers.get('content-type')||'',body:await r.text()});})()"
                  % (json.dumps(url), json.dumps(method),
                     (",'Content-Type':'application/json'" if body else "")
                     + (",'X-Atlassian-Token':'no-check'" if method != "GET" else ""),
                     ",body:%s" % json.dumps(str(body)) if body else ""))
            out = json.loads(_eval_async(page, js, repl=False) or "{}")
            return "HTTP %s %s\n\n%s" % (out.get("status"), out.get("type", ""),
                                         _clip(out.get("body", ""), args.get("max_chars")))
        if tool == "run_js":
            if str(args.get("url") or "").strip():
                _open_url(page, str(args["url"]).strip())
            value = _eval_async(page, str(args.get("script") or ""))
            return _clip(json.dumps(value, ensure_ascii=False, default=str), args.get("max_chars"))
    finally:
        page.close()
    raise ValueError("unknown tool %s" % tool)


def _cf_login(e: Dict[str, Any], args: Dict[str, Any]) -> str:
    if e["kind"] != "passcode":
        raise ValueError("%s is not a passcode entry" % e["name"])
    host = e["host"]
    api = str(args.get("api") or "").strip() or ("https://api." + host[len("login."):] if host.startswith("login.") else "")
    if not api:
        raise ValueError("Cannot derive the CF API endpoint from %s; pass api." % host)
    r = _sign_in(e)
    code = r.get("passcode")
    if not code:
        raise ValueError("No passcode from %s: %s" % (e["name"], _session_line(e, r)))
    cf = os.environ.get("CF_CLI") or shutil.which("cf")
    if not cf:
        raise ValueError("The cf CLI is not on PATH on the engine host (set CF_CLI).")
    cmd = [cf, "login", "-a", api, "--sso-passcode=%s" % code]
    for flag, key in (("-o", "org"), ("-s", "space")):
        if str(args.get(key) or "").strip():
            cmd += [flag, str(args[key]).strip()]
    try:
        p = subprocess.run(cmd, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=CF_TIMEOUT,
                           creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except subprocess.TimeoutExpired:
        raise ValueError("cf login to %s did not finish within %ds." % (api, CF_TIMEOUT))
    out = re.sub(r"\x1b\[[0-9;]*m", "", ((p.stdout or "") + (p.stderr or "")).replace(code, "***")).strip()
    if p.returncode != 0:
        raise ValueError("cf login to %s failed (exit %d). The passcode is single-use. cf said:\n%s"
                         % (api, p.returncode, out))
    return "cf logged in to %s with a fresh passcode from %s.\n%s" % (api, e["name"], out)


def _cli_login(e: Dict[str, Any]) -> str:
    """Sign a command-line tool on the engine host in with a cli entry: the command's output, never the code."""
    if e["kind"] != "cli":
        raise ValueError("%s is not a cli entry" % e["name"])
    r = _sign_in(e)
    if r.get("command_exit") != 0:
        raise ValueError(_session_line(e, r))
    return _session_line(e, r)


def test(eid: int) -> Dict[str, Any]:
    """Admin 'Test': sign in once with the stored account."""
    e = _entry(eid)
    if e["kind"] == "passcode":
        r = _sign_in(e)
        ok = bool(r.get("passcode"))
        return {"signed_in": ok, "text": "Passcode page reached: a one-time code is available." if ok
                else _session_line(e, r)}
    r = _sign_in(e)
    if e["kind"] == "cli":
        return {"signed_in": r.get("command_exit") == 0, "text": _session_line(e, r)}
    return {"signed_in": bool(r.get("signed_in")), "text": _session_line(e, r)}


__all__ = ["public_entries", "entries_for", "add", "change", "remove", "call", "test", "path", "KINDS", "GROUPS"]
