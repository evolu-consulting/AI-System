"""Default frontend <-> DLC engine: settings, the seeded flow catalogue and the /api/dlc proxy.

Standard library only.

Settings (environment, or a JSON file named by SDLC_CONFIG with the same keys):
  SDLC_ENGINE_URL        base URL of the DLC engine (e.g. http://127.0.0.1:8796); required for runs
  SDLC_AUTH_ISSUER       Keycloak realm URL (https://host/realms/dlc); empty = sign-in off (dev)
  SDLC_AUTH_CLIENT       public OIDC client of this frontend (default dlc-fe)
  SDLC_AUTH_AUDIENCE     optional audience the access token must carry
  SDLC_PUBLIC_URL        how browsers reach this frontend (used for the OIDC redirect); default = request origin
  SDLC_DATA_DIR          where flows.json lives (default: next to the database)
  SDLC_ENABLE_MIGRATION  1 = show the Feature Migration flow on Home
  SDLC_ENGINE_TIMEOUT_S  proxy timeout (default 60)

Proxy: /api/dlc/<path>?<query> -> <SDLC_ENGINE_URL>/api/<path>?<query>, same method and body, the
caller's Authorization header forwarded unchanged (the engine checks the same Keycloak token).
"""

from __future__ import annotations

import copy
import json
import os
import threading
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional, Tuple

VERSION = "0.4.1"

KEYS = ("SDLC_ENGINE_URL", "SDLC_AUTH_ISSUER", "SDLC_AUTH_CLIENT", "SDLC_AUTH_AUDIENCE", "SDLC_PUBLIC_URL",
        "SDLC_DATA_DIR", "SDLC_ENABLE_MIGRATION", "SDLC_ENGINE_TIMEOUT_S", "SDLC_PORT", "SDLC_HOST")


def settings(env: Optional[Dict[str, str]] = None) -> Dict[str, str]:
    """Environment wins over the optional JSON file named by SDLC_CONFIG."""
    e = dict(os.environ if env is None else env)
    out: Dict[str, str] = {}
    path = e.get("SDLC_CONFIG", "")
    if path and os.path.isfile(path):
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh) or {}
        for k in KEYS:
            if data.get(k) not in (None, ""):
                out[k] = str(data[k])
    for k in KEYS:
        if e.get(k):
            out[k] = e[k]
    return out


# ------------------------------------------------------------------ flows (seeded catalogue)

#: The flows Home offers. 'kind' is what POST /api/packs takes; 'fields' are the extra inputs the form shows.
DEFAULT_FLOWS: List[Dict[str, Any]] = [
    {"id": "new-system", "kind": "new", "label": "New System",
     "description": "Build the project's application from a specification (its first run).",
     "fields": [], "enabled": True, "order": 1},
    {"id": "enhancement", "kind": "enhance", "label": "Enhancement",
     "description": "Add or change features of a project that already has a completed build.",
     "fields": [], "enabled": True, "order": 2},
    {"id": "bug-fix", "kind": "bug", "label": "Bug Fix",
     "description": "Fix wrong behaviour in a project's application, with a failing test first.",
     "fields": [{"name": "title", "label": "Bug title", "required": True},
                {"name": "repro", "label": "Steps to reproduce", "required": True, "multiline": True},
                {"name": "expected", "label": "Expected", "required": True, "multiline": True},
                {"name": "actual", "label": "Actual", "required": True, "multiline": True}],
     "enabled": True, "order": 3},
    {"id": "feature-migration", "kind": "migrate", "label": "Feature Migration",
     "description": "Move the features of an old version (v1) to a rewritten version (v2).",
     "fields": [{"name": "v1", "label": "v1 repository (or folder of repositories)", "required": True},
                {"name": "v2", "label": "v2 repository (target)", "required": True}],
     "enabled": False, "order": 4, "optional": True},
]

_flows_lock = threading.Lock()


def data_dir(cfg: Dict[str, str], db_path: str) -> str:
    d = cfg.get("SDLC_DATA_DIR") or os.path.dirname(os.path.abspath(db_path))
    os.makedirs(d, exist_ok=True)
    return d


def flows_path(cfg: Dict[str, str], db_path: str) -> str:
    return os.path.join(data_dir(cfg, db_path), "flows.json")


def seed_flows(path: str, force: bool = False) -> Tuple[int, int]:
    """Idempotent: adds missing default flows, keeps every edited one. force=True resets to the defaults.
    Returns (added, kept)."""
    with _flows_lock:
        cur: List[Dict[str, Any]] = []
        if os.path.isfile(path) and not force:
            with open(path, encoding="utf-8") as fh:
                cur = json.load(fh).get("flows", [])
        have = {f.get("id") for f in cur}
        added = 0
        for f in DEFAULT_FLOWS:
            if f["id"] not in have:
                cur.append(copy.deepcopy(f))
                added += 1
        _write(path, cur)
        return added, len(cur) - added


def _write(path: str, flows: List[Dict[str, Any]]) -> None:
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump({"flows": flows}, fh, indent=2)
    os.replace(tmp, path)


def load_flows(path: str, migration: bool = False) -> List[Dict[str, Any]]:
    if not os.path.isfile(path):
        seed_flows(path)
    with open(path, encoding="utf-8") as fh:
        flows = json.load(fh).get("flows", [])
    defaults = {d["id"]: d for d in DEFAULT_FLOWS}
    out = []
    for f in flows:
        if f.get("id") in defaults:
            # inputs are not editable: always the current ones (older files asked for a server path)
            f = dict(f, fields=copy.deepcopy(defaults[f["id"]]["fields"]))
            if "repository path" in str(f.get("description") or "") or "fresh repository" in str(f.get("description") or ""):
                f["description"] = defaults[f["id"]]["description"]
        if f.get("id") == "feature-migration":
            f = dict(f, enabled=bool(f.get("enabled")) or migration)
        out.append(f)
    return sorted(out, key=lambda f: (f.get("order", 99), f.get("label", "")))


def update_flow(path: str, flow_id: str, patch: Dict[str, Any]) -> Dict[str, Any]:
    with _flows_lock:
        with open(path, encoding="utf-8") as fh:
            flows = json.load(fh).get("flows", [])
        for f in flows:
            if f.get("id") == flow_id:
                for k in ("label", "description", "enabled", "order"):
                    if k in patch:
                        f[k] = patch[k]
                _write(path, flows)
                return f
    raise KeyError(flow_id)


# ------------------------------------------------------------------ proxy

HOP = {"connection", "keep-alive", "transfer-encoding", "te", "trailer", "upgrade", "proxy-authorization",
       "proxy-authenticate", "content-length", "host"}


def engine_url(cfg: Dict[str, str]) -> str:
    return (cfg.get("SDLC_ENGINE_URL") or "").rstrip("/")


def proxy(cfg: Dict[str, str], method: str, rest: str, query: str, body: bytes,
          headers: Dict[str, str]) -> Tuple[int, Dict[str, str], bytes]:
    """Forward one request to the engine. Returns (status, headers, body)."""
    base = engine_url(cfg)
    if not base:
        return 503, {"Content-Type": "application/json"}, json.dumps(
            {"error": "engine not configured", "detail": "set SDLC_ENGINE_URL"}).encode()
    if ".." in rest.split("/"):
        return 400, {"Content-Type": "application/json"}, b'{"error":"bad path"}'
    url = base + "/api/" + urllib.parse.quote(rest, safe="/:@-._~") + ("?" + query if query else "")
    fwd = {k: v for k, v in headers.items() if k.lower() in ("authorization", "content-type", "accept")}
    req = urllib.request.Request(url, data=body if method in ("POST", "PUT", "PATCH") else None,
                                 headers=fwd, method=method)
    timeout = float(cfg.get("SDLC_ENGINE_TIMEOUT_S") or 60)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, {k: v for k, v in r.headers.items() if k.lower() not in HOP}, r.read()
    except urllib.error.HTTPError as e:
        data = e.read() if e.fp else b""
        return e.code, {k: v for k, v in (e.headers or {}).items() if k.lower() not in HOP}, data
    except (urllib.error.URLError, OSError, TimeoutError) as e:
        return 502, {"Content-Type": "application/json"}, json.dumps(
            {"error": "engine unreachable", "detail": str(getattr(e, "reason", e))}).encode()


__all__ = ["settings", "DEFAULT_FLOWS", "seed_flows", "load_flows", "update_flow", "flows_path", "proxy",
           "engine_url", "VERSION"]
