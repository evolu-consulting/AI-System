"""KH-to-KH sync with connection keys. Two KHs sign people in with different Keycloaks, so neither trusts the
other's tokens; trust comes from a key the GIVING side makes and hands over out of band.

  giver     (maintainer, /home)  POST /sync/keys {label, days, projects?, public_url?} -> the key, shown once
                                 GET /sync/keys, DELETE /sync/keys/{kid}
            (the key, no sign-in) GET /sync/peer/hello      protocol, embedding model + dim, probe vector
                                 GET /sync/peer/manifest   projects the key may give, row counts per part
                                 POST /sync/peer/export    one page of a project's part (ids, text, metadata,
                                                           embeddings), filtered to a time range
                                 POST /sync/peer/progress  the receiver's job progress, shown on the giver
            (maintainer, /home)  GET /sync/given           pulls receivers run with this KH's keys, with progress
  receiver  (any KH user, /home) POST /sync/connect {key}   handshake + what the giver offers
                                 POST /sync/pull {key, selection:[{project, parts}], since?, until?,
                                                  include_undated?, dry_run?}  -> 202 job
                                 GET /sync/jobs, GET /sync/jobs/{id}, POST /sync/jobs/{id}/cancel (a member: own jobs)
            (maintainer, /home)  GET /sync/grants, POST /sync/grants/remove   read access members got from keys

KEY: "khsync1.<base64url {"u": giver URL, "k": kid}>.<secret>". The giver keeps only sha256(secret), the label,
who made it, an expiry and an optional project allowlist; it can revoke a key at any time. Peer calls carry the
key in the X-KH-Sync-Key header. The receiver holds the key in memory only while its job runs.

HANDSHAKE (409, nothing written, when any differs): sync protocol, embedding model name, embedding dimension and
the cosine of both sides' embedding of the same probe sentence (>= PROBE_MIN), which catches the same model name
loaded with other weights or normalisation.

WHAT IS COPIED: per project, the parts the receiver ticks (knowledge, log, findings, entity cards, chunk vectors;
policy and src on request; "log" also takes the giver's hot-window rows). Personal projects are never offered.
TIME RANGE: rows whose ts (or date / created_at / updated_at) falls in [since, until]; undated rows only when
include_undated. The giver filters, so rows outside the range never leave it.

MERGE RULES (update, never replace):
  * project registry: a new project is created (registered to the receiving maintainer); an existing one gets
    the giver's aliases / keywords / tools / conflicts merged in, and its descriptor only if its own is empty.
  * rows, matched by id: missing -> created; same text + metadata -> unchanged; the receiver's copy has a newer
    ts -> kept (skipped_newer); otherwise -> updated with the giver's text, metadata and embedding.
  * nothing on the receiver is ever deleted. A log row the receiver still holds in its hot window is updated
    there, so a row never ends up in two collections.

KEY SCOPE (giver): projects, parts, a time window and whether member lists are shared; nothing chosen means
everything, member lists included. Member lists are read when the key is made (the maker's sign-in) and kept
with it. The giver enforces the scope on every peer call; the receiver's range is clamped inside the window.

PEOPLE (receiver, sign-in on): a giver member who already has access here keeps it at their level here (the
receiver's own users win); one with an account here gets access at the giver's level; a new one gets an
account (identity service, kh.users.invite) and, for user/password accounts only (never SSO), a temporary
initial password set through Keycloak's admin API with the maintainer's own token and listed for maintainers
on /home > New accounts until they mark it sent. Passwords themselves never travel between KHs.

JOBS live in the sync_jobs table and are updated after every page, so /home shows progress after the page is
closed and reopened. A job that was running when this KH stopped is marked interrupted on the next start.

A KEY IS A READER ROLE (Rowan 2026-10-22). A key is the exception to "only maintainers sync": any KH user of the
receiver who holds one may connect and pull every project the key gives, and gets project.read on each pulled
project here. KH keeps that grant itself (sync_grants), because the person's own token cannot grant them a level
at the identity service; the auth middleware adds it to the caller's token grants (reader_projects). It is read
only: writing, people and deletion still come from the token alone. A member's pull never applies the giver's
member lists (that needs the right to manage people here), never touches the orchestrator and takes a personal
project only when it is the member's own. A project new here is made in this KH only and NOT registered at the
identity service, so the member stays read only on it (Rowan 2026-10-23: a key holder reads, never owns).
Maintainers list and remove these grants on /home > New accounts. Keys made before this change work the same way.
VERIFIED BY THE GIVER (Rowan 2026-10-22): before a member connects or pulls, the receiver posts the key to the
giver's /sync/peer/verify. The giver matches the WHOLE key to one of its stored keys, never by its name (the row is
found by the secret's hash, the whole key rebuilt from it must equal the presented one, active, not expired; Rowan
2026-10-23) and answers with what THAT stored key allows (role, resolved project list); the key carries no rights.
Read is granted only for projects that are both ticked and on the giver's list. A giver that cannot verify (an
older KH) lets only a maintainer pull.

THE GIVER SEES THE PULL. After its pages the receiver posts its job's progress to /sync/peer/progress with the
same key (at most every PROGRESS_EVERY_S, and once at the end); the giver keeps it per job in sync_given and shows
it on /home > Give. Best effort: an older giver that lacks the route is not asked again, and a failed report
never stops the pull.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import math
import re
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException, Request

from . import config, sqldb

logger = logging.getLogger(__name__)

PROTOCOL = 2
KEY_PREFIX = "khsync1"
KEY_HEADER = "X-KH-Sync-Key"
PROBE_TEXT = "Knowledge Hub sync probe: a library lends books to members and lists the loans that are overdue."
PROBE_MIN = 0.999
DEFAULT_PARTS = ("knowledge", "log", "findings", "entity", "chunk", "personalization")
OPTIONAL_PARTS = ("policy", "src")
ALL_PARTS = ("knowledge", "log", "hotlog", "findings", "entity", "chunk", "personalization", "policy", "src")
PAGE_DEFAULT, PAGE_MAX = 200, 500
HTTP_TIMEOUT_S = 60
HTTP_TRIES = 3
KEY_DAYS_DEFAULT, KEY_DAYS_MAX = 7, 90
TS_KEYS = ("ts", "date", "created_at", "updated_at")
KEYS_TABLE, JOBS_TABLE, ACCOUNTS_TABLE = "sync_keys", "sync_jobs", "sync_accounts"
GRANTS_TABLE, GIVEN_TABLE = "sync_grants", "sync_given"
KEY_ROLE = "reader"                    # what a key makes its holder on the receiver (see A KEY IS A READER ROLE)
READER_PERMISSION = "project.read"
GRANTS_TTL_S = 30                      # how long one instance trusts its cached grants (several instances on BTP)
PROGRESS_EVERY_S = 2.0
PROGRESS_TIMEOUT_S = 10
GIVEN_STALE_S = 300                    # a running pull with no news for this long is shown as silent
GIVEN_PLAN_MAX = 500
HOME_HTML = Path(__file__).resolve().parent / "static" / "home.html"


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


# ── tables ───────────────────────────────────────────────────────────────────

_DB_LOCK = threading.RLock()
_READY = False


def _db():
    """A connection, after the tables exist (created on first use, like the other stores)."""
    if not _READY:
        init()
    return sqldb.connect()


def init() -> None:
    """Create the key and job tables; mark jobs left running by a previous process as interrupted."""
    global _READY
    with _DB_LOCK, sqldb.connect() as c:
        sqldb.create_table(c, KEYS_TABLE, f"""
            CREATE TABLE IF NOT EXISTS {KEYS_TABLE} (
                kid TEXT PRIMARY KEY, secret_hash TEXT NOT NULL, label TEXT NOT NULL, created_by TEXT NOT NULL,
                created_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT, last_used_at TEXT,
                projects TEXT NOT NULL DEFAULT '[]', public_url TEXT NOT NULL DEFAULT '')""", f"""
            CREATE COLUMN TABLE {KEYS_TABLE} (
                kid NVARCHAR(32) PRIMARY KEY, secret_hash NVARCHAR(128) NOT NULL, label NVARCHAR(256) NOT NULL,
                created_by NVARCHAR(256) NOT NULL, created_at NVARCHAR(32) NOT NULL, expires_at NVARCHAR(32) NOT NULL,
                revoked_at NVARCHAR(32), last_used_at NVARCHAR(32), projects NCLOB NOT NULL,
                public_url NVARCHAR(512) NOT NULL)""")
        sqldb.create_table(c, JOBS_TABLE, f"""
            CREATE TABLE IF NOT EXISTS {JOBS_TABLE} (
                id TEXT PRIMARY KEY, source TEXT NOT NULL, state TEXT NOT NULL, created_by TEXT NOT NULL,
                started TEXT NOT NULL, finished TEXT, doc TEXT NOT NULL)""", f"""
            CREATE COLUMN TABLE {JOBS_TABLE} (
                id NVARCHAR(32) PRIMARY KEY, source NVARCHAR(512) NOT NULL, state NVARCHAR(16) NOT NULL,
                created_by NVARCHAR(256) NOT NULL, started NVARCHAR(32) NOT NULL, finished NVARCHAR(32),
                doc NCLOB NOT NULL)""")
        sqldb.create_table(c, ACCOUNTS_TABLE, f"""
            CREATE TABLE IF NOT EXISTS {ACCOUNTS_TABLE} (
                email TEXT PRIMARY KEY, password TEXT NOT NULL, created_at TEXT NOT NULL, job_id TEXT NOT NULL,
                source TEXT NOT NULL, projects TEXT NOT NULL, applied INTEGER NOT NULL DEFAULT 0,
                note TEXT NOT NULL DEFAULT '', sent_at TEXT)""", f"""
            CREATE COLUMN TABLE {ACCOUNTS_TABLE} (
                email NVARCHAR(256) PRIMARY KEY, password NVARCHAR(128) NOT NULL, created_at NVARCHAR(32) NOT NULL,
                job_id NVARCHAR(32) NOT NULL, source NVARCHAR(512) NOT NULL, projects NCLOB NOT NULL,
                applied INTEGER NOT NULL, note NVARCHAR(512) NOT NULL, sent_at NVARCHAR(32))""")
        # scope: what the giver lets the receiver see (parts, time window, members + their snapshot), 2026-10-11
        sqldb.add_column(c, KEYS_TABLE, "scope", "TEXT NOT NULL DEFAULT '{}'", "NCLOB")
        # receiver: project.read a key gave a person here (A KEY IS A READER ROLE), 2026-10-22
        sqldb.create_table(c, GRANTS_TABLE, f"""
            CREATE TABLE IF NOT EXISTS {GRANTS_TABLE} (
                email TEXT NOT NULL, project TEXT NOT NULL, source TEXT NOT NULL, kid TEXT NOT NULL,
                job_id TEXT NOT NULL, granted_at TEXT NOT NULL, PRIMARY KEY (email, project))""", f"""
            CREATE COLUMN TABLE {GRANTS_TABLE} (
                email NVARCHAR(256) NOT NULL, project NVARCHAR(256) NOT NULL, source NVARCHAR(512) NOT NULL,
                kid NVARCHAR(32) NOT NULL, job_id NVARCHAR(32) NOT NULL, granted_at NVARCHAR(32) NOT NULL,
                PRIMARY KEY (email, project))""")
        # giver: progress of the pulls receivers run with this KH's keys, 2026-10-22
        sqldb.create_table(c, GIVEN_TABLE, f"""
            CREATE TABLE IF NOT EXISTS {GIVEN_TABLE} (
                job_id TEXT PRIMARY KEY, kid TEXT NOT NULL, state TEXT NOT NULL, started TEXT NOT NULL,
                updated TEXT NOT NULL, doc TEXT NOT NULL)""", f"""
            CREATE COLUMN TABLE {GIVEN_TABLE} (
                job_id NVARCHAR(64) PRIMARY KEY, kid NVARCHAR(32) NOT NULL, state NVARCHAR(16) NOT NULL,
                started NVARCHAR(32) NOT NULL, updated NVARCHAR(32) NOT NULL, doc NCLOB NOT NULL)""")
        for r in c.execute(f"SELECT id, doc FROM {JOBS_TABLE} WHERE state = ?", ["running"]).fetchall():
            doc = json.loads(r["doc"])
            doc.update(state="interrupted", finished=_now(), error="this KH stopped while the job ran; start it again")
            c.execute(f"UPDATE {JOBS_TABLE} SET state = ?, finished = ?, doc = ? WHERE id = ?",
                      ["interrupted", doc["finished"], json.dumps(doc), r["id"]])
        _READY = True


def _caller() -> str:
    from . import auth
    p = auth.current()
    return p.email if p is not None else "local"


def _reader():
    """The signed-in caller when they sync on a key's reader role (not a maintainer); None for a maintainer or
    with sign-in off, who sync as before."""
    from . import auth
    p = auth.current()
    return p if p is not None and not p.is_maintainer else None


def _not_for_reader(reader, pid: str) -> str:
    """Why a reader may not pull this project ('' when they may)."""
    from .personal import is_personal
    from .projects import ORCHESTRATOR_ID
    if pid == ORCHESTRATOR_ID:
        return "the orchestrator is shared by every KH user; only a maintainer syncs it"
    if is_personal(pid) and pid != reader.personal_project:
        return "another person's personal project; only a maintainer syncs it"
    return ""


# ── keys (giver side) ────────────────────────────────────────────────────────

def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _hash(secret: str) -> str:
    return hashlib.sha256(secret.encode()).hexdigest()


def parse_key(key: str) -> Dict[str, str]:
    """{url, kid, secret} of a key string; 422 when it is not one."""
    try:
        prefix, head, secret = (key or "").strip().split(".")
        info = json.loads(_unb64(head))
        url, kid = str(info["u"]).rstrip("/"), str(info["k"])
    except Exception:  # noqa: BLE001 - any malformed key is the same answer
        raise HTTPException(422, "this is not a KH sync key")
    u = urllib.parse.urlparse(url)
    if prefix != KEY_PREFIX or u.scheme not in ("http", "https") or not u.netloc or not secret:
        raise HTTPException(422, "this is not a KH sync key")
    return {"url": url, "kid": kid, "secret": secret}


def _identity(method: str, path: str, body: Any = None) -> Tuple[int, Any]:
    """Call the identity service's KH endpoints (/realms/<realm>/kh/...) with the caller's own token.

    People and project membership live there, not in KH. KH holds no token of its own: it relays the one
    of the request it is serving (auth._token), so this works only inside a signed-in request.
    """
    from . import auth
    token = auth._token.get()
    if not config.AUTH_ISSUER or not token:
        return 0, {"error": "sign-in is off on this KH"}
    import requests
    try:
        r = requests.request(method, config.AUTH_ISSUER.rstrip("/") + "/kh/" + path.lstrip("/"), json=body,
                             headers={"Authorization": "Bearer " + token}, timeout=20)
    except requests.RequestException as e:
        return 0, {"error": "identity service unreachable: %s" % e}
    try:
        return r.status_code, r.json()
    except ValueError:
        return r.status_code, {"error": r.text[:300]}


# Accounts that sign in with a user name and password, not Google / Microsoft SSO: only these get an initial
# password when a sync creates them on the receiver. The identity service's own flag wins when it sends one.
PASSWORD_DOMAINS = tuple(d.strip().lower() for d in config._env("KH_SYNC_PASSWORD_DOMAINS", "kh-agent.invalid").split(",")
                         if d.strip())


def login_kind(member: dict, email: str) -> str:
    """"password" or "sso" for one member entry."""
    flag = str(member.get("login") or member.get("loginKind") or "").lower()
    if flag in ("password", "sso"):
        return flag
    if member.get("federated") or member.get("idp") or member.get("federatedIdentities"):
        return "sso"
    domain = email.rsplit("@", 1)[-1]
    return "password" if any(domain == d or domain.endswith("." + d) for d in PASSWORD_DOMAINS) else "sso"


def members_of(project: str) -> Dict[str, Any]:
    """{ok, members:[{email, name, level}]} of one project, read at the identity service."""
    st, out = _identity("GET", "projects/%s/members" % urllib.parse.quote(project, safe=""))
    if st != 200:
        err = out.get("error") or out.get("detail") if isinstance(out, dict) else None
        return {"ok": False, "error": err or "status %s" % st, "members": []}
    rows = out.get("members") if isinstance(out, dict) else out
    found = []
    for m in rows or []:
        email = str(m.get("email") or m.get("username") or "").strip().lower()
        if email:
            name = m.get("name") or " ".join(x for x in (m.get("firstName"), m.get("lastName")) if x) or ""
            found.append({"email": email, "name": name, "level": m.get("level") or "readonly",
                          "login": login_kind(m, email)})
    return {"ok": True, "members": sorted(found, key=lambda x: x["email"])}


def _scope_in(parts: Optional[List[str]], since: str, until: str, members: bool) -> Dict[str, Any]:
    parts = [p for p in (parts or []) if p]
    bad = [p for p in parts if p not in ALL_PARTS]
    if bad:
        raise HTTPException(422, "unknown parts %s; known: %s" % (bad, list(ALL_PARTS)))
    if "log" in parts and "hotlog" not in parts:
        parts.append("hotlog")
    since, until = _day(since), _day(until)
    if since and until and since > until:
        raise HTTPException(422, "since is after until")
    return {"parts": sorted(set(parts)), "since": since, "until": until, "members": bool(members)}


def create_key(label: str, days: int, projects: Optional[List[str]], public_url: str,
               parts: Optional[List[str]] = None, since: str = "", until: str = "",
               members: bool = True) -> Dict[str, Any]:
    """A key, and what it lets the receiver see. Nothing chosen = everything (members included).

    With members on, the member lists of the key's projects are read now with the maker's own sign-in and
    kept with the key: a peer call carries no person, so KH could not read them later.
    """
    u = urllib.parse.urlparse(public_url or "")
    if u.scheme not in ("http", "https") or not u.netloc:
        raise HTTPException(422, "public_url must be the http(s) address the receiving KH can reach")
    scope = _scope_in(parts, since, until, members)
    if scope["members"]:
        from .personal import is_personal
        names = sorted(set(projects or [])) or [p["id"] for p in manifest(counts=False)["projects"]]
        scope["member_lists"] = {pid: members_of(pid) for pid in names if not is_personal(pid)}
    days = max(1, min(int(days or KEY_DAYS_DEFAULT), KEY_DAYS_MAX))
    kid, secret = secrets.token_hex(6), secrets.token_urlsafe(32)
    row = {"kid": kid, "secret_hash": _hash(secret), "label": (label or "sync key").strip()[:200],
           "created_by": _caller(), "created_at": _now(),
           "expires_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + days * 86400)),
           "revoked_at": None, "last_used_at": None, "projects": json.dumps(sorted(set(projects or []))),
           "public_url": public_url.rstrip("/"), "scope": json.dumps(scope)}
    with _DB_LOCK, _db() as c:
        sqldb.insert_new(c, KEYS_TABLE, row)
    return {**_public(_key_view(row)), "key": _key_string(row["public_url"], kid, secret)}


def _key_view(r) -> Dict[str, Any]:
    r = dict(r)
    now = _now()
    state = "revoked" if r.get("revoked_at") else "expired" if r["expires_at"] <= now else "active"
    scope = json.loads(r.get("scope") or "{}")
    lists = scope.pop("member_lists", {}) or {}
    return {"kid": r["kid"], "label": r["label"], "created_by": r["created_by"], "created_at": r["created_at"],
            "expires_at": r["expires_at"], "revoked_at": r.get("revoked_at"), "last_used_at": r.get("last_used_at"),
            "projects": json.loads(r.get("projects") or "[]"), "public_url": r.get("public_url") or "",
            "state": state, "role": KEY_ROLE, "parts": scope.get("parts") or [], "since": scope.get("since") or "",
            "until": scope.get("until") or "", "members": scope.get("members", True),
            "member_counts": {pid: len(v.get("members") or []) for pid, v in lists.items()},
            "_member_lists": lists}


def _public(view: Dict[str, Any]) -> Dict[str, Any]:
    return {k: v for k, v in view.items() if not k.startswith("_")}


def list_keys() -> List[Dict[str, Any]]:
    with _DB_LOCK, _db() as c:
        rows = c.execute(f"SELECT * FROM {KEYS_TABLE} ORDER BY created_at DESC").fetchall()
    return [_public(_key_view(r)) for r in rows]


def revoke_key(kid: str) -> Dict[str, Any]:
    with _DB_LOCK, _db() as c:
        n = sqldb.update(c, f"UPDATE {KEYS_TABLE} SET revoked_at = ? WHERE kid = ? AND revoked_at IS NULL",
                         [_now(), kid])
        r = c.execute(f"SELECT * FROM {KEYS_TABLE} WHERE kid = ?", [kid]).fetchone()
    if r is None:
        raise HTTPException(404, "no sync key %s" % kid)
    return {**_public(_key_view(r)), "changed": bool(n)}


def _key_string(public_url: str, kid: str, secret: str) -> str:
    """The whole key as create_key hands it out."""
    return "%s.%s.%s" % (KEY_PREFIX, _b64(json.dumps({"u": public_url, "k": kid}).encode()), secret)


def check_key(header: str) -> Dict[str, Any]:
    """The stored key a peer request presents, matched on the WHOLE key, never on its name (Rowan 2026-10-23).

    The row is found by the hash of the secret, not by the kid the key names; then the whole key is rebuilt from
    that row (prefix, giver URL, kid) and the presented secret, and must equal the presented key exactly. 401 when
    missing, not matching in any part, revoked or expired."""
    if not header:
        raise HTTPException(401, "a sync key is required (%s header)" % KEY_HEADER)
    presented = header.strip()
    k = parse_key(presented)
    with _DB_LOCK, _db() as c:
        r = c.execute(f"SELECT * FROM {KEYS_TABLE} WHERE secret_hash = ?", [_hash(k["secret"])]).fetchone()
        if r is None or not hmac.compare_digest(_key_string(r["public_url"], r["kid"], k["secret"]), presented):
            raise HTTPException(401, "this sync key does not match any key stored here")
        view = _key_view(r)
        if view["state"] != "active":
            raise HTTPException(401, "this sync key is %s" % view["state"])
        c.execute(f"UPDATE {KEYS_TABLE} SET last_used_at = ? WHERE kid = ?", [_now(), r["kid"]])
    return view


def _allowed(view: Dict[str, Any], pid: str) -> bool:
    return not view["projects"] or pid in view["projects"]


def _gives(view: Optional[Dict[str, Any]], pid: str, include_personal: bool = False) -> bool:
    """May this project be given? A personal project only when a key names it (a maintainer's backup of the
    whole KH, Rowan 2026-10-20) or, without a key, when the caller asks for the full list to pick from; a key
    that names no project gives every project except personal ones, as before."""
    from .personal import is_personal
    if view is not None:
        return pid in view["projects"] if is_personal(pid) else _allowed(view, pid)
    return include_personal or not is_personal(pid)


def _part_allowed(view: Optional[Dict[str, Any]], part: str) -> bool:
    return view is None or not view.get("parts") or part in view["parts"]


def _clamp(view: Optional[Dict[str, Any]], since: str, until: str) -> Tuple[str, str]:
    """The receiver's range inside the key's window: the later since, the earlier until."""
    if view is None:
        return since, until
    ks, ku = view.get("since") or "", view.get("until") or ""
    since = max(since, ks) if since and ks else since or ks
    until = min(until, ku) if until and ku else until or ku
    return since, until


# ── where a part lives ───────────────────────────────────────────────────────

def part_collection(part: str, project: str, create: bool = False):
    """The collection of one part of one project, or None when it does not exist (and create is False)."""
    from . import vector_store as vs
    from .projects import ORCHESTRATOR_ID, bundle_of
    if part == "hotlog":
        return vs.hotlog_collection() if create or vs.HOTLOG_COLLECTION in vs.existing_collection_names() else None
    b = bundle_of(project, role="manage" if project == ORCHESTRATOR_ID else "project")
    name = {"knowledge": b.knowledge_collection, "log": b.log_collection, "findings": b.findings_collection,
            "policy": b.policy_collection, "src": b.vector_collection}.get(part) \
        or vs.part_collection_name(part, project)
    if not create and name not in vs.existing_collection_names():
        return None
    return vs.get_or_create(name)


def _hot_where(project: str) -> dict:
    from . import hotlog
    return {hotlog.OWNER_KEY: {"$eq": project}}


def part_count(part: str, project: str) -> int:
    coll = part_collection(part, project)
    if coll is None:
        return 0
    if part == "hotlog":
        return len(coll.get(where=_hot_where(project), include=[]).get("ids") or [])
    return int(coll.count() or 0)


# ── giver side ───────────────────────────────────────────────────────────────

def _embed(model, text: str) -> List[float]:
    return [float(x) for x in model.encode(text, normalize_embeddings=True)]


def hello(model) -> Dict[str, Any]:
    probe = _embed(model, PROBE_TEXT) if model is not None else []
    return {"protocol": PROTOCOL, "kh_version": config.KH_VERSION, "emb_model": config.EMBEDDING_MODEL,
            "emb_dim": len(probe), "probe": [round(x, 6) for x in probe], "parts": list(ALL_PARTS)}


def manifest(view: Optional[Dict[str, Any]] = None, counts: bool = True,
             include_personal: bool = False) -> Dict[str, Any]:
    """Projects this KH can give, with row counts per part. Personal projects only as _gives() allows.

    Through a key: only its projects and parts, its time window, and the member lists kept with it.
    """
    from .personal import is_personal
    from .projects import list_projects
    out = []
    for pid, e in sorted(list_projects().items()):
        if not _gives(view, pid, include_personal):
            continue
        out.append({"id": pid, "personal": is_personal(pid), "role": e.get("role", "project"),
                    "aliases": e.get("aliases") or [],
                    "keywords": e.get("keywords") or [], "tools": e.get("tools") or [],
                    "conflicts_with": e.get("conflicts_with") or [], "descriptor": e.get("descriptor", ""),
                    "counts": {p: part_count(p, pid) for p in ALL_PARTS if _part_allowed(view, p)}
                    if counts else {}})
        if view is not None:
            got = (view.get("_member_lists") or {}).get(pid)
            if not view.get("members", True):
                out[-1]["members"], out[-1]["members_note"] = [], "the giver did not share members"
            elif got and got.get("ok"):
                out[-1]["members"], out[-1]["members_note"] = got["members"], ""
            else:
                out[-1]["members"] = []
                out[-1]["members_note"] = (got or {}).get("error") or "no member list was kept with this key"
    limits = {k: view.get(k) for k in ("role", "parts", "since", "until", "members")} if view is not None else {}
    return {"protocol": PROTOCOL, "projects": out, "limits": limits}


def verify(view: Dict[str, Any]) -> Dict[str, Any]:
    """What the key the receiver presented is, read from the key as THIS KH stores it (check_key matched it to
    a stored key by kid and secret hash, and found it active). The receiver grants read only from this answer,
    never from anything inside the key string: {kid, label, role, state, expires_at, projects}. `projects` is
    resolved, so a key that names none lists every project it gives."""
    return {"match": "whole-key", "kid": view["kid"], "label": view["label"], "role": view["role"],
            "state": view["state"], "expires_at": view["expires_at"],
            "projects": [p["id"] for p in manifest(view, counts=False)["projects"]]}


def row_time(meta: dict) -> str:
    for k in TS_KEYS:
        v = meta.get(k)
        if v not in (None, ""):
            return str(v)
    return ""


def in_range(meta: dict, since: str = "", until: str = "", include_undated: bool = True) -> bool:
    """since / until are ISO dates or timestamps, both inclusive (until '2026-10-05' keeps that whole day)."""
    if not since and not until:
        return True
    t = row_time(meta)
    if not t:
        return include_undated
    if since and t < since:
        return False
    if until and t[:len(until)] > until:
        return False
    return True


def export(project: str, part: str, offset: int = 0, limit: int = PAGE_DEFAULT, since: str = "", until: str = "",
           include_undated: bool = True, view: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """One page of a part. `scanned` counts every row read (for progress); `rows` holds those in range."""
    if part not in ALL_PARTS:
        raise HTTPException(422, "part must be one of %s" % list(ALL_PARTS))
    if not _gives(view, project):
        raise HTTPException(403, "this key does not give project %s" % project)
    if not _part_allowed(view, part):
        raise HTTPException(403, "this key does not give part %s" % part)
    since, until = _clamp(view, since, until)
    limit = max(1, min(int(limit or PAGE_DEFAULT), PAGE_MAX))
    offset = max(0, int(offset or 0))
    coll = part_collection(part, project)
    if coll is None:
        return {"project": project, "part": part, "rows": [], "scanned": 0, "next_offset": None, "total": 0}
    kw: Dict[str, Any] = {"include": ["embeddings", "metadatas", "documents"], "limit": limit, "offset": offset}
    if part == "hotlog":
        kw["where"] = _hot_where(project)
    got = coll.get(**kw)
    ids = list(got.get("ids") or [])
    embs = got.get("embeddings")
    embs = list(embs) if embs is not None else []
    metas = got.get("metadatas") or []
    docs = got.get("documents") or []
    rows = []
    for n, i in enumerate(ids):
        meta = dict(metas[n]) if n < len(metas) and metas[n] else {}
        if not in_range(meta, since, until, include_undated):
            continue
        rows.append({"id": i, "document": docs[n] if n < len(docs) else "", "metadata": meta,
                     "embedding": [float(x) for x in embs[n]] if n < len(embs) and embs[n] is not None else None})
    return {"project": project, "part": part, "rows": rows, "scanned": len(ids),
            "next_offset": offset + len(ids) if len(ids) == limit else None, "total": part_count(part, project)}


# ── receiver side ────────────────────────────────────────────────────────────

class Remote:
    """The giving KH, called with the connection key (held in memory only)."""

    def __init__(self, key: str):
        k = parse_key(key)
        self.base = k["url"]
        self.kid = k["kid"]
        self.key = key.strip()
        self.reports = True                  # False once the giver showed it has no /sync/peer/progress

    def tell(self, path: str, body: Any) -> bool:
        """One best-effort POST (no retry, short timeout) for news the giver may show; never raises.
        A 4xx means an older giver without the route: it is not asked again in this job."""
        if not self.reports:
            return False
        req = urllib.request.Request(self.base + path, data=json.dumps(body).encode("utf-8"), method="POST",
                                     headers={"Accept": "application/json", "Content-Type": "application/json",
                                              KEY_HEADER: self.key})
        try:
            with urllib.request.urlopen(req, timeout=PROGRESS_TIMEOUT_S) as r:
                r.read()
            return True
        except urllib.error.HTTPError as e:
            if 400 <= e.code < 500:
                self.reports = False
                logger.info("sync - %s does not take progress reports (%d); not asking again", self.base, e.code)
            return False
        except Exception:  # noqa: BLE001 - a report never stops the pull
            return False

    def call(self, method: str, path: str, body: Any = None) -> Any:
        data = None if body is None else json.dumps(body).encode("utf-8")
        headers = {"Accept": "application/json", KEY_HEADER: self.key}
        if data is not None:
            headers["Content-Type"] = "application/json"
        last = ""
        for attempt in range(HTTP_TRIES):
            req = urllib.request.Request(self.base + path, data=data, method=method, headers=headers)
            try:
                with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT_S) as r:
                    raw = r.read().decode("utf-8")
                    return json.loads(raw) if raw else None
            except urllib.error.HTTPError as e:
                detail = e.read().decode("utf-8", "replace")[:300]
                if e.code < 500:
                    try:
                        detail = json.loads(detail).get("detail", detail)
                    except (ValueError, AttributeError):
                        pass
                    raise HTTPException(401 if e.code == 401 else 403 if e.code == 403 else 502,
                                        "the giving KH answered %d: %s" % (e.code, detail))
                last = "%d %s" % (e.code, detail)
            except (urllib.error.URLError, OSError) as e:
                last = repr(e)[:200]
            time.sleep(0.5 * (attempt + 1))
        raise HTTPException(502, "the giving KH at %s is unreachable: %s" % (self.base, last))


def compare(local: dict, remote: dict) -> Dict[str, Any]:
    """The handshake verdict: {ok, checks:{...}, cosine}."""
    a, b = local.get("probe") or [], remote.get("probe") or []
    cos = 0.0
    if a and len(a) == len(b):
        dot = sum(x * y for x, y in zip(a, b))
        na, nb = math.sqrt(sum(x * x for x in a)), math.sqrt(sum(y * y for y in b))
        cos = dot / (na * nb) if na and nb else 0.0
    checks = {"protocol": local.get("protocol") == remote.get("protocol"),
              "emb_model": local.get("emb_model") == remote.get("emb_model"),
              "emb_dim": bool(local.get("emb_dim")) and local.get("emb_dim") == remote.get("emb_dim"),
              "probe": cos >= PROBE_MIN}
    return {"ok": all(checks.values()), "checks": checks, "cosine": round(cos, 6),
            "local": {k: local.get(k) for k in ("protocol", "kh_version", "emb_model", "emb_dim")},
            "source": {k: remote.get(k) for k in ("protocol", "kh_version", "emb_model", "emb_dim")}}


def _handshake(remote: Remote, model) -> Dict[str, Any]:
    verdict = compare(hello(model), remote.call("GET", "/sync/peer/hello"))
    if not verdict["ok"]:
        raise HTTPException(409, {"error": "embedding_mismatch",
                                  "detail": "the two KHs do not embed the same way; nothing was copied",
                                  "handshake": verdict})
    return verdict


def verify_key(remote: Remote) -> Dict[str, Any]:
    """Ask the giver to match the key to one it stores and say what that stored key allows (verify()). A reader
    is let in only on this answer; the key string itself carries no rights. 403 when the giver cannot verify
    (an older giver without the route) or answers for another key."""
    try:
        got = remote.call("POST", "/sync/peer/verify", {})
    except HTTPException as e:
        if e.status_code == 401:
            raise
        raise HTTPException(403, "the giving KH could not verify this key (%s); a member may sync only on a key "
                                 "the giver verifies - ask a maintainer here" % e.detail)
    # Only the giver's whole-key match counts; the kid (the key's name) is not compared here.
    if not isinstance(got, dict) or got.get("match") != "whole-key" or got.get("state") != "active" \
            or got.get("role") != KEY_ROLE:
        raise HTTPException(403, "the giving KH did not match this whole key to an active %s key" % KEY_ROLE)
    return {"kid": got["kid"], "label": str(got.get("label") or ""), "role": got["role"],
            "expires_at": str(got.get("expires_at") or ""), "projects": sorted({str(p) for p in got.get("projects") or []})}


def connect(key: str, model) -> Dict[str, Any]:
    """Handshake, then what the giver offers next to what this KH already has. A reader also gets the giver's
    verification of the key, and the projects they may not take are marked."""
    from .projects import get_project
    remote = Remote(key)
    verdict = _handshake(remote, model)
    reader = _reader()
    verified = verify_key(remote) if reader is not None else None
    man = remote.call("GET", "/sync/peer/manifest")
    projects = []
    for p in man.get("projects") or []:
        p = dict(p)
        p["exists_here"] = get_project(p["id"]) is not None
        if reader is not None:
            p["blocked"] = _not_for_reader(reader, p["id"]) or (
                "" if p["id"] in verified["projects"] else "the giver's stored key does not give this project")
        projects.append(p)
    return {"source": remote.base, "kid": remote.kid, "handshake": verdict, "projects": projects,
            "limits": man.get("limits") or {}, "members_here": bool(config.AUTH_ISSUER) and reader is None,
            "as": "reader" if reader is not None else "maintainer", "verified": verified,
            "parts": {"default": list(DEFAULT_PARTS), "optional": list(OPTIONAL_PARTS)}}


def merge_project(src: dict, dry_run: bool, register: bool = True) -> str:
    """Registry merge for one project. Returns created | updated | unchanged.

    register=False (a reader's pull): a new project is made in this KH only, never registered at the identity
    service, so the reader gets no owner level there - only the read a key gives (sync_grants). It also cannot
    clash with an id the identity service already holds when the two KHs share it."""
    from . import auth, personal
    from .projects import get_or_create_project, get_project
    pid = src["id"]
    cur = get_project(pid)
    if cur is None and personal.is_personal(pid):
        if not dry_run:                              # owned by the e-mail in its id, never registered at Keycloak
            personal.ensure(pid, None)
        return "created"
    if cur is None:
        if not dry_run:
            if register:
                auth.register_project(pid)           # the receiving maintainer becomes the owner
            get_or_create_project(pid, aliases=src.get("aliases"), keywords=src.get("keywords"),
                                  tools=src.get("tools"), descriptor=src.get("descriptor", ""),
                                  conflicts_with=src.get("conflicts_with"))
        return "created"
    adds = any(set(src.get(k) or []) - set(cur.get(k) or []) for k in ("aliases", "keywords", "tools", "conflicts_with"))
    fill = bool(src.get("descriptor")) and not cur.get("descriptor")
    if not (adds or fill):
        return "unchanged"
    if not dry_run:
        get_or_create_project(pid, role=cur.get("role", "project"), aliases=src.get("aliases"),
                              keywords=src.get("keywords"), tools=src.get("tools"),
                              descriptor=src.get("descriptor", "") if fill else "",
                              conflicts_with=src.get("conflicts_with"))
    return "updated"


def _newer(local_meta: dict, remote_meta: dict) -> bool:
    a, b = str(local_meta.get("ts") or ""), str(remote_meta.get("ts") or "")
    return bool(a and b and a > b)


_SCALARS = (str, int, float, bool)


def store_meta(meta: dict) -> dict:
    """Metadata as this KH's vector store takes it. A giver on HANA keeps any JSON in metadata; Chroma takes only
    scalars, None and non-empty lists of one scalar type, so any other value (a list of objects, a dict, a mixed
    or empty list) is kept as its JSON text instead of failing the whole page."""
    out = {}
    for k, v in meta.items():
        ok = v is None or isinstance(v, _SCALARS) or (
            isinstance(v, list) and v and all(isinstance(x, _SCALARS) for x in v)
            and len({bool if isinstance(x, bool) else type(x) for x in v}) == 1)
        out[k] = v if ok else json.dumps(v, ensure_ascii=False, sort_keys=True)
    return out


def _zero() -> Dict[str, int]:
    return {"created": 0, "updated": 0, "unchanged": 0, "skipped_newer": 0, "no_embedding": 0}


def write_rows(project: str, part: str, rows: List[dict], dry_run: bool = False) -> Dict[str, int]:
    """Apply one page of giver rows to this KH (see MERGE RULES). Returns counts."""
    counts = _zero()
    rows = [r for r in rows if r.get("id")]
    if not rows:
        return counts
    ids = [r["id"] for r in rows]
    dst = part_collection("log" if part == "hotlog" else part, project, create=not dry_run)
    homes: Dict[str, Tuple[Any, dict, str]] = {}
    lanes = [dst] if dst is not None else []
    if part in ("log", "hotlog"):
        hot = part_collection("hotlog", project)
        if hot is not None:
            lanes.insert(0, hot)
    for coll in lanes:
        want = [i for i in ids if i not in homes]
        if not want:
            break
        got = coll.get(ids=want, include=["metadatas", "documents"])
        for n, i in enumerate(got.get("ids") or []):
            homes[i] = (coll, (got.get("metadatas") or [{}])[n] or {}, (got.get("documents") or [""])[n] or "")
    writes: Dict[Any, List[dict]] = {}
    for r in rows:
        meta = store_meta(dict(r.get("metadata") or {}))
        doc = r.get("document") or ""
        if r.get("embedding") is None:
            counts["no_embedding"] += 1
            continue
        home = homes.get(r["id"])
        if home is None:
            counts["created"] += 1
            target = dst
        else:
            coll, lmeta, ldoc = home
            if ldoc == doc and lmeta == meta:
                counts["unchanged"] += 1
                continue
            if _newer(lmeta, meta):
                counts["skipped_newer"] += 1
                continue
            counts["updated"] += 1
            target = coll
        if not dry_run and target is not None:
            writes.setdefault(id(target), []).append({"coll": target, "row": r, "meta": meta, "doc": doc})
    for group in writes.values():
        coll = group[0]["coll"]
        coll.upsert(ids=[g["row"]["id"] for g in group], embeddings=[g["row"]["embedding"] for g in group],
                    metadatas=[g["meta"] for g in group], documents=[g["doc"] for g in group])
    return counts


# ── jobs (persisted) ─────────────────────────────────────────────────────────

_CANCEL: set = set()
_RUNNING: Dict[str, str] = {}          # giver base -> job id (one pull per giver at a time on this instance)
_RUN_LOCK = threading.Lock()


def _save(doc: Dict[str, Any], insert: bool = False) -> None:
    with _DB_LOCK, _db() as c:
        if insert:
            sqldb.insert_new(c, JOBS_TABLE, {"id": doc["id"], "source": doc["source"], "state": doc["state"],
                                             "created_by": doc["created_by"], "started": doc["started"],
                                             "finished": doc.get("finished"), "doc": json.dumps(doc)})
        else:
            c.execute(f"UPDATE {JOBS_TABLE} SET state = ?, finished = ?, doc = ? WHERE id = ?",
                      [doc["state"], doc.get("finished"), json.dumps(doc), doc["id"]])


def get_job(jid: str) -> Optional[Dict[str, Any]]:
    with _DB_LOCK, _db() as c:
        r = c.execute(f"SELECT doc FROM {JOBS_TABLE} WHERE id = ?", [jid]).fetchone()
    return json.loads(r["doc"]) if r else None


def own_job(jid: str) -> Dict[str, Any]:
    """A job the caller may see: any for a maintainer, only their own for a reader. 404 otherwise."""
    doc = get_job(jid)
    reader = _reader()
    if doc is None or (reader is not None and doc.get("created_by") != reader.email):
        raise HTTPException(404, "no sync job %s" % jid)
    return doc


def list_jobs(limit: int = 30) -> List[Dict[str, Any]]:
    reader = _reader()
    with _DB_LOCK, _db() as c:
        if reader is None:
            rows = c.execute(f"SELECT doc FROM {JOBS_TABLE} ORDER BY started DESC").fetchmany(max(1, int(limit)))
        else:
            rows = c.execute(f"SELECT doc FROM {JOBS_TABLE} WHERE created_by = ? ORDER BY started DESC",
                             [reader.email]).fetchmany(max(1, int(limit)))
    out = []
    for r in rows:
        d = json.loads(r["doc"])
        out.append({k: d.get(k) for k in ("id", "source", "state", "dry_run", "started", "finished", "error",
                                          "created_by", "progress", "since", "until")}
                   | {"projects": sorted({p["project"] for p in d.get("plan") or []})})
    return out


def cancel_job(jid: str) -> Dict[str, Any]:
    doc = own_job(jid)
    if doc["state"] == "running":
        _CANCEL.add(jid)
    return {"id": jid, "state": doc["state"], "cancel_requested": doc["state"] == "running"}


def _progress(doc: Dict[str, Any]) -> None:
    total = sum(int(p["source_total"]) for p in doc["plan"])
    done = sum(min(int(p["scanned"]), int(p["source_total"])) for p in doc["plan"])
    doc["progress"] = {"scanned": done, "total": total,
                       "percent": 100.0 if doc["state"] == "done" else round(100.0 * done / total, 1) if total else 0.0}


def report_progress(doc: Dict[str, Any], remote: Remote) -> bool:
    """Tell the giver how the pull runs (THE GIVER SEES THE PULL): the job's state, progress and plan."""
    job = {k: doc.get(k) for k in ("id", "state", "dry_run", "started", "finished", "error", "since", "until",
                                   "progress", "receiver")}
    job["by"] = doc.get("created_by")
    job["plan"] = [{k: s.get(k) for k in ("project", "part", "source_total", "scanned", "matched")}
                   for s in doc.get("plan") or []]
    return remote.tell("/sync/peer/progress", {"job": job})


def run_rows(doc: Dict[str, Any], remote: Remote, page: int = PAGE_DEFAULT) -> None:
    """The background half of a pull: every (project, part) page by page. Never raises; the job says why."""
    jid = doc["id"]
    told = 0.0
    try:
        report_progress(doc, remote)
        told = time.time()
        for step in doc["plan"]:
            off: Optional[int] = 0
            while off is not None:
                if jid in _CANCEL:
                    raise InterruptedError("cancelled by %s" % "the receiver")
                got = remote.call("POST", "/sync/peer/export", {
                    "project": step["project"], "part": step["part"], "offset": off, "limit": page,
                    "since": doc["since"], "until": doc["until"], "include_undated": doc["include_undated"]})
                counts = write_rows(step["project"], step["part"], got.get("rows") or [], dry_run=doc["dry_run"])
                rep = doc["report"].setdefault(step["project"], {}).setdefault(step["part"], _zero())
                for k, v in counts.items():
                    rep[k] += v
                step["scanned"] += int(got.get("scanned") or 0)
                step["matched"] += len(got.get("rows") or [])
                off = got.get("next_offset")
                _progress(doc)
                _save(doc)
                if time.time() - told >= PROGRESS_EVERY_S:
                    report_progress(doc, remote)
                    told = time.time()
            step["scanned"] = max(step["scanned"], step["source_total"])
        doc.update(state="done", finished=_now())
    except InterruptedError as e:
        doc.update(state="cancelled", finished=_now(), error=str(e))
    except Exception as e:  # noqa: BLE001 - a job reports, it does not crash the server
        logger.exception("sync job %s failed", jid)
        doc.update(state="failed", finished=_now(), error=str(getattr(e, "detail", e))[:500])
    finally:
        _progress(doc)
        _save(doc)
        report_progress(doc, remote)
        _CANCEL.discard(jid)
        with _RUN_LOCK:
            if _RUNNING.get(remote.base) == jid:
                _RUNNING.pop(remote.base, None)


def _new_account(answer: Any) -> bool:
    """Did the identity service just create the account? Only an explicit flag in its answer counts."""
    if not isinstance(answer, dict):
        return False
    return any(bool(answer.get(k)) for k in ("created", "account_created", "accountCreated", "new_account"))


def _initial_password() -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
    return "".join(secrets.choice(alphabet) for _ in range(14)) + secrets.choice("!#%+=?@")


def _admin(method: str, path: str, body: Any = None) -> Tuple[int, Any]:
    """Keycloak's admin REST API with the caller's own token. Works for a maintainer once the kh-cli client's
    scope carries realm-management manage-users (the maintainer's own Keycloak right); 403 otherwise."""
    from . import auth
    token = auth._token.get()
    if not config.AUTH_ISSUER or not token:
        return 0, {"error": "sign-in is off on this KH"}
    base, realm = config.AUTH_ISSUER.rstrip("/").split("/realms/", 1)
    import requests
    try:
        r = requests.request(method, "%s/admin/realms/%s/%s" % (base, realm, path.lstrip("/")), json=body,
                             headers={"Authorization": "Bearer " + token}, timeout=20)
    except requests.RequestException as e:
        return 0, {"error": "identity service unreachable: %s" % e}
    try:
        return r.status_code, r.json() if r.text else None
    except ValueError:
        return r.status_code, {"error": r.text[:300]}


def set_password(email: str, password: str) -> Tuple[bool, str]:
    """Set a temporary password on a user/password account. (applied, note). Never on an SSO-linked account."""
    st, users = _admin("GET", "users?exact=true&briefRepresentation=true&email=" + urllib.parse.quote(email))
    if st != 200 or not isinstance(users, list) or not users:
        return False, ("this KH's maintainer may not set passwords at the sign-in service yet (status %s): "
                       "give the kh-cli client the realm-management manage-users scope" % st if st in (401, 403)
                       else "account not found at the sign-in service (status %s)" % st)
    uid = users[0]["id"]
    st, links = _admin("GET", "users/%s/federated-identity" % uid)
    if st == 200 and links:
        return False, "the account signs in with SSO (%s); no password set" % ", ".join(
            str(x.get("identityProvider")) for x in links)
    st, out = _admin("PUT", "users/%s/reset-password" % uid, {"type": "password", "value": password, "temporary": True})
    if 200 <= st < 300:
        return True, "temporary: the person chooses a new password at first sign-in"
    return False, "the sign-in service refused the password (status %s)" % st


def record_account(email: str, project: str, job_id: str, source: str) -> Dict[str, Any]:
    """A person whose account a sync created here gets an initial password, kept for maintainers on /home.

    The password is set as a temporary one through Keycloak's admin API with the maintainer's own token
    (set_password); when that is not allowed yet, the row says so (applied 0 and a note) and the maintainer can
    still pass it on once it is. A second project for the same person only adds the project.
    """
    with _DB_LOCK, _db() as c:
        row = c.execute(f"SELECT * FROM {ACCOUNTS_TABLE} WHERE email = ?", [email]).fetchone()
        if row is not None:
            projects = sorted(set(json.loads(row["projects"] or "[]")) | {project})
            c.execute(f"UPDATE {ACCOUNTS_TABLE} SET projects = ? WHERE email = ?", [json.dumps(projects), email])
            return {"email": email, "new": False}
    password = _initial_password()
    applied, note = set_password(email, password)
    with _DB_LOCK, _db() as c:
        sqldb.insert_new(c, ACCOUNTS_TABLE, {"email": email, "password": password, "created_at": _now(),
                                             "job_id": job_id, "source": source, "projects": json.dumps([project]),
                                             "applied": 1 if applied else 0, "note": note[:500], "sent_at": None})
    return {"email": email, "new": True, "password_applied": applied}


def list_accounts() -> List[Dict[str, Any]]:
    with _DB_LOCK, _db() as c:
        rows = c.execute(f"SELECT * FROM {ACCOUNTS_TABLE} ORDER BY created_at DESC").fetchall()
    return [{**dict(r), "projects": json.loads(r["projects"] or "[]"), "applied": bool(r["applied"])} for r in rows]


def mark_sent(email: str, forget: bool = True) -> Dict[str, Any]:
    """The maintainer passed the password on: note when, and (default) forget it."""
    with _DB_LOCK, _db() as c:
        n = sqldb.update(c, f"UPDATE {ACCOUNTS_TABLE} SET sent_at = ?, password = ? WHERE email = ?",
                         [_now(), "(sent, not kept)" if forget else None, email]) if forget else \
            sqldb.update(c, f"UPDATE {ACCOUNTS_TABLE} SET sent_at = ? WHERE email = ?", [_now(), email])
    if not n:
        raise HTTPException(404, "no synced account %s" % email)
    return {"email": email, "sent": True, "password_kept": not forget}


# ── reader grants (receiver side, A KEY IS A READER ROLE) ───────────────────

_GRANTS: Dict[str, Any] = {"at": 0.0, "map": {}}


def grant_reader(email: str, projects: List[str], source: str, kid: str, job_id: str) -> List[str]:
    """project.read here for each project a key brought in. A personal project needs none (its owner has every
    right on it). Returns the projects granted."""
    from .personal import is_personal
    email = (email or "").strip().lower()
    done = []
    with _DB_LOCK, _db() as c:
        for pid in sorted(set(projects)):
            if is_personal(pid):
                continue
            sqldb.upsert(c, GRANTS_TABLE, ("email", "project"), {
                "email": email, "project": pid, "source": source[:500], "kid": kid[:32], "job_id": job_id,
                "granted_at": _now()})
            done.append(pid)
    _GRANTS["at"] = 0.0
    return done


def reader_projects(email: str) -> frozenset:
    """Projects a key gave this person project.read on. Cached GRANTS_TTL_S per instance; never raises."""
    now = time.time()
    if now - _GRANTS["at"] > GRANTS_TTL_S:
        try:
            with _DB_LOCK, _db() as c:
                rows = c.execute(f"SELECT email, project FROM {GRANTS_TABLE}").fetchall()
        except Exception:  # noqa: BLE001 - a store hiccup must not fail every request; the token still counts
            logger.exception("sync - could not read reader grants")
            return frozenset(_GRANTS["map"].get((email or "").lower(), ()))
        found: Dict[str, set] = {}
        for r in rows:
            found.setdefault(r["email"], set()).add(r["project"])
        _GRANTS.update(at=now, map={k: frozenset(v) for k, v in found.items()})
    return _GRANTS["map"].get((email or "").lower(), frozenset())


def list_grants() -> List[Dict[str, Any]]:
    with _DB_LOCK, _db() as c:
        rows = c.execute(f"SELECT * FROM {GRANTS_TABLE} ORDER BY granted_at DESC").fetchall()
    return [dict(r) for r in rows]


def remove_grant(email: str, project: str) -> Dict[str, Any]:
    with _DB_LOCK, _db() as c:
        n = sqldb.update(c, f"DELETE FROM {GRANTS_TABLE} WHERE email = ? AND project = ?",
                         [(email or "").strip().lower(), project])
    if not n:
        raise HTTPException(404, "no read access from a sync key for %s on %s" % (email, project))
    _GRANTS["at"] = 0.0
    return {"email": email, "project": project, "removed": True}


# ── what the giver sees of a pull (giver side) ───────────────────────────────

_JOB_ID = re.compile(r"sync_[0-9a-f]{6,32}")
_JOB_STATES = ("running", "done", "failed", "cancelled", "interrupted")


def _num(v: Any) -> float:
    try:
        return max(0.0, float(v))
    except (TypeError, ValueError):
        return 0.0


def record_given(view: Dict[str, Any], body: Any) -> Dict[str, Any]:
    """Keep a receiver's report of the pull it runs with this key. A job stays bound to the key that first
    reported it; what the receiver sends is cut to known fields and sizes."""
    job = (body or {}).get("job") if isinstance(body, dict) else None
    if not isinstance(job, dict) or not _JOB_ID.fullmatch(str(job.get("id") or "")):
        raise HTTPException(422, "body must be {job: {id: 'sync_...', ...}}")
    state = str(job.get("state") or "")
    if state not in _JOB_STATES:
        raise HTTPException(422, "state must be one of %s" % list(_JOB_STATES))
    text = lambda k, n=200: str(job.get(k) or "")[:n]  # noqa: E731
    plan = [{"project": str(s.get("project") or "")[:256], "part": str(s.get("part") or "")[:32],
             "source_total": int(_num(s.get("source_total"))), "scanned": int(_num(s.get("scanned"))),
             "matched": int(_num(s.get("matched")))}
            for s in (job.get("plan") or [])[:GIVEN_PLAN_MAX] if isinstance(s, dict)]
    prog = job.get("progress") if isinstance(job.get("progress"), dict) else {}
    doc = {"id": job["id"], "kid": view["kid"], "label": view["label"], "state": state,
           "dry_run": bool(job.get("dry_run")), "by": text("by", 256), "receiver": text("receiver", 512),
           "started": text("started", 32) or _now(), "finished": text("finished", 32) or None,
           "error": text("error", 500) or None, "since": text("since", 32), "until": text("until", 32),
           "progress": {"scanned": int(_num(prog.get("scanned"))), "total": int(_num(prog.get("total"))),
                        "percent": min(100.0, round(_num(prog.get("percent")), 1))},
           "plan": plan, "updated": _now()}
    with _DB_LOCK, _db() as c:
        r = c.execute(f"SELECT kid FROM {GIVEN_TABLE} WHERE job_id = ?", [doc["id"]]).fetchone()
        if r is not None and r["kid"] != view["kid"]:
            raise HTTPException(403, "job %s was reported with another key" % doc["id"])
        sqldb.upsert(c, GIVEN_TABLE, ("job_id",), {"job_id": doc["id"], "kid": doc["kid"], "state": state,
                                                   "started": doc["started"], "updated": doc["updated"],
                                                   "doc": json.dumps(doc)})
    return {"ok": True}


def list_given(limit: int = 30) -> List[Dict[str, Any]]:
    """Pulls receivers ran with this KH's keys, newest news first. A running one silent for GIVEN_STALE_S is
    flagged: the receiver stopped reporting (closed, or lost the way back here)."""
    with _DB_LOCK, _db() as c:
        rows = c.execute(f"SELECT doc FROM {GIVEN_TABLE} ORDER BY updated DESC").fetchmany(max(1, int(limit)))
    cutoff = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() - GIVEN_STALE_S))
    out = []
    for r in rows:
        d = json.loads(r["doc"])
        d["silent"] = d.get("state") == "running" and (d.get("updated") or "") < cutoff
        d["projects"] = sorted({s["project"] for s in d.get("plan") or []})
        out.append(d)
    return out


def apply_members(project: str, members: List[dict], dry_run: bool, job_id: str = "",
                  source: str = "") -> Dict[str, Any]:
    """Give the giver's project members access here. Runs in the pull request, with its sign-in.

    A person who already has access to this project here keeps it, at their level here (the receiver's own
    users win). Someone with an account here but no access gets the giver's level. Someone without an
    account here cannot be added by KH (accounts and passwords live in this KH's own identity service):
    they are listed under no_account. With sign-in off this KH has no people at all: nothing is applied.
    """
    out: Dict[str, Any] = {"added": [], "kept": [], "new_accounts": [], "no_account": [], "failed": [],
                           "note": ""}
    from .personal import is_personal
    if is_personal(project):
        out["note"] = "a personal project belongs to the e-mail in its id; it has no members to give"
        return out
    if not members:
        return out
    if not config.AUTH_ISSUER:
        out["note"] = "sign-in is off on this KH, so it has no people to give access to"
        out["skipped"] = [m["email"] for m in members]
        return out
    have = {m["email"]: m for m in members_of(project).get("members") or []}
    for m in members:
        email, level = m["email"], m.get("level") or "readonly"
        if email in have:
            out["kept"].append({"email": email, "level": have[email].get("level")})
            continue
        if dry_run:
            out["added"].append({"email": email, "level": level, "dry_run": True})
            continue
        st, ans = _identity("PUT", "projects/%s/members/%s" % (urllib.parse.quote(project, safe=""),
                                                               urllib.parse.quote(email, safe="@")), {"level": level})
        text = json.dumps(ans) if not isinstance(ans, str) else ans
        if 200 <= st < 300:
            out["added"].append({"email": email, "level": level})
            if _new_account(ans):
                kind = m.get("login") or login_kind(m, email)
                out["new_accounts"].append(record_account(email, project, job_id, source) if kind == "password"
                                           else {"email": email, "new": True, "login": "sso",
                                                 "note": "signs in with SSO; no password needed"})
        elif "account_required" in text or st == 404:
            out["no_account"].append(email)
        else:
            out["failed"].append({"email": email, "status": st, "detail": text[:200]})
    return out


def _selection(body: dict) -> List[Tuple[str, List[str]]]:
    sel = body.get("selection")
    if not isinstance(sel, list) or not sel:
        raise HTTPException(422, "selection must list at least one {project, parts}")
    out = []
    for s in sel:
        pid = str((s or {}).get("project") or "").strip()
        parts = [str(p) for p in (s or {}).get("parts") or DEFAULT_PARTS]
        bad = [p for p in parts if p not in ALL_PARTS]
        if not pid or bad:
            raise HTTPException(422, "bad selection entry %s (known parts: %s)" % (s, list(ALL_PARTS)))
        if "log" in parts and "hotlog" not in parts:
            parts.append("hotlog")                    # "log" means the whole log, hot window included
        out.append((pid, parts))
    return out


def _day(v: Any) -> str:
    v = str(v or "").strip()
    if v and not (len(v) >= 10 and v[4] == "-" and v[7] == "-"):
        raise HTTPException(422, "since / until must be ISO dates (YYYY-MM-DD) or timestamps")
    return v


READER_MEMBERS_NOTE = "a member's pull gives no one else access here; a maintainer's pull applies member lists"


def pull(body: dict, model, background: bool = True, here: str = "") -> Dict[str, Any]:
    if not isinstance(body, dict):
        raise HTTPException(422, "body must be an object")
    remote = Remote(str(body.get("key") or ""))
    selection = _selection(body)
    since, until = _day(body.get("since")), _day(body.get("until"))
    if since and until and since > until:
        raise HTTPException(422, "since is after until")
    dry_run = bool(body.get("dry_run", False))
    verdict = _handshake(remote, model)
    reader = _reader()
    verified = verify_key(remote) if reader is not None else None
    if reader is not None:
        no = {pid: _not_for_reader(reader, pid) or (
              "" if pid in verified["projects"] else "the giver's stored key does not give it")
              for pid, _ in selection}
        no = {pid: why for pid, why in no.items() if why}
        if no:
            raise HTTPException(403, "you may not pull %s" % "; ".join("%s (%s)" % kv for kv in sorted(no.items())))
    src = {p["id"]: p for p in remote.call("GET", "/sync/peer/manifest").get("projects") or []}
    missing = [pid for pid, _ in selection if pid not in src]
    if missing:
        raise HTTPException(404, "the giving KH does not offer project %s" % missing)
    with _RUN_LOCK:
        if remote.base in _RUNNING:
            raise HTTPException(409, "a pull from %s is already running (%s)" % (remote.base, _RUNNING[remote.base]))
        jid = "sync_" + secrets.token_hex(6)
        _RUNNING[remote.base] = jid
    try:
        registry = {pid: merge_project(src[pid], dry_run, register=reader is None) for pid, _ in selection}
        want_members = {str((e or {}).get("project")): bool((e or {}).get("members", True))
                        for e in body.get("selection") or []}
        if reader is None:
            member_report = {pid: apply_members(pid, src[pid].get("members") or [], dry_run, jid, remote.base)
                             for pid, _ in selection if want_members.get(pid, True)}
        else:
            member_report = {pid: {"note": READER_MEMBERS_NOTE} for pid, _ in selection if src[pid].get("members")}
        granted = [] if reader is None or dry_run else grant_reader(
            reader.email, [pid for pid, _ in selection], remote.base, remote.kid, jid)
        plan = [{"project": pid, "part": part, "source_total": int(src[pid]["counts"].get(part, 0)),
                 "scanned": 0, "matched": 0}
                for pid, parts in selection for part in parts if int(src[pid]["counts"].get(part, 0)) > 0]
        doc = {"id": jid, "source": remote.base, "kid": remote.kid, "state": "running", "dry_run": dry_run,
               "created_by": _caller(), "started": _now(), "finished": None, "since": since, "until": until,
               "include_undated": bool(body.get("include_undated", True)), "handshake": verdict,
               "as": "reader" if reader is not None else "maintainer", "verified": verified,
               "reader_grants": granted, "receiver": here,
               "registry": registry, "members": member_report, "plan": plan, "report": {}, "error": None}
        _progress(doc)
        _save(doc, insert=True)
    except Exception:
        with _RUN_LOCK:
            _RUNNING.pop(remote.base, None)
        raise
    if background:
        threading.Thread(target=run_rows, args=(doc, remote), name="kh-sync-" + jid, daemon=True).start()
        return json.loads(json.dumps(doc))
    run_rows(doc, remote)
    return get_job(jid)


# ── routes ───────────────────────────────────────────────────────────────────

def _public_base(request: Request) -> str:
    proto = request.headers.get("x-forwarded-proto", request.url.scheme)
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or request.url.netloc
    return f"{proto}://{host}"


def attach(app) -> None:
    import asyncio

    from fastapi.responses import HTMLResponse
    TAG = ["Sync"]

    # ── the page and its sign-in (no KH sign-in needed to load them) ──
    @app.get("/home", response_class=HTMLResponse, include_in_schema=False)
    async def home_page():
        return HTMLResponse(HOME_HTML.read_text(encoding="utf-8"), headers={"Cache-Control": "no-store"})

    @app.get("/home/config", tags=TAG, summary="What /home needs to sign in")
    async def home_config(request: Request):
        return {"auth": bool(config.AUTH_ISSUER), "client_id": config.AUTH_CLIENT_ID,
                "base": _public_base(request), "kh_version": config.KH_VERSION, "emb_model": config.EMBEDDING_MODEL}

    def _idp(path: str, data: dict) -> Tuple[int, dict]:
        if not config.AUTH_ISSUER:
            raise HTTPException(404, "sign-in is off on this KH")
        import requests
        r = requests.post(config.AUTH_ISSUER.rstrip("/") + "/protocol/openid-connect/" + path,
                          data={"client_id": config.AUTH_CLIENT_ID, **data}, timeout=15)
        try:
            return r.status_code, r.json()
        except ValueError:
            return r.status_code, {"error": "bad_answer", "error_description": r.text[:200]}

    @app.post("/home/login/start", tags=TAG, summary="Start a device sign-in for /home")
    async def home_login_start():
        # PKCE (S256) on the device grant: the identity service may require it for this client. The page keeps
        # the verifier next to the device code and sends both back to /home/login/poll.
        verifier = secrets.token_urlsafe(48)
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
        st, out = await asyncio.to_thread(_idp, "auth/device", {
            "scope": "openid", "code_challenge": challenge, "code_challenge_method": "S256"})
        if st != 200:
            raise HTTPException(502, out.get("error_description") or out.get("error") or "sign-in refused")
        res = {k: out.get(k) for k in ("device_code", "user_code", "verification_uri",
                                       "verification_uri_complete", "expires_in", "interval")}
        res["code_verifier"] = verifier
        return res

    @app.post("/home/login/poll", tags=TAG, summary="Finish a device sign-in (pending until approved)")
    async def home_login_poll(body: dict):
        st, out = await asyncio.to_thread(_idp, "token", {
            "grant_type": "urn:ietf:params:oauth:grant-type:device_code", "device_code": str(body.get("device_code")),
            **({"code_verifier": str(body["code_verifier"])} if body.get("code_verifier") else {})})
        if st == 200:
            return {"state": "ok", "access_token": out.get("access_token"), "refresh_token": out.get("refresh_token"),
                    "expires_in": out.get("expires_in")}
        err = out.get("error") or "failed"
        return {"state": "pending" if err in ("authorization_pending", "slow_down") else "failed", "error": err}

    @app.post("/home/login/refresh", tags=TAG, summary="Refresh a /home sign-in")
    async def home_login_refresh(body: dict):
        st, out = await asyncio.to_thread(_idp, "token", {"grant_type": "refresh_token",
                                                          "refresh_token": str(body.get("refresh_token"))})
        if st != 200:
            raise HTTPException(401, "sign in again")
        return {"access_token": out.get("access_token"), "refresh_token": out.get("refresh_token"),
                "expires_in": out.get("expires_in")}

    @app.get("/sync/me", tags=TAG, summary="Who is using /home (maintainers only)")
    async def sync_me():
        from . import auth
        p = auth.current()
        return {"email": p.email if p else "local", "role": p.role if p else "maintainer",
                "auth": auth.enabled(), "maintainer": p is None or p.is_maintainer}

    # ── giver: keys + peer routes (the key is the credential) ──
    @app.post("/sync/keys", tags=TAG, summary="Make a connection key for a receiving KH (shown once)")
    async def sync_key_create(body: dict, request: Request):
        return await asyncio.to_thread(create_key, str(body.get("label") or ""),
                                       int(body.get("days") or KEY_DAYS_DEFAULT),
                                       [str(p) for p in body.get("projects") or []],
                                       str(body.get("public_url") or _public_base(request)),
                                       [str(p) for p in body.get("parts") or []], str(body.get("since") or ""),
                                       str(body.get("until") or ""), bool(body.get("members", True)))

    @app.get("/sync/keys", tags=TAG, summary="Connection keys this KH made")
    async def sync_key_list():
        return {"keys": await asyncio.to_thread(list_keys)}

    @app.delete("/sync/keys/{kid}", tags=TAG, summary="Revoke a connection key")
    async def sync_key_revoke(kid: str):
        return await asyncio.to_thread(revoke_key, kid)

    @app.get("/sync/local", tags=TAG, summary="This KH's projects with row counts (for choosing a key's projects)")
    async def sync_local():
        return await asyncio.to_thread(manifest, None, True, True)

    @app.get("/sync/peer/hello", tags=TAG, summary="Peer handshake: protocol, embedding model + dim, probe")
    async def peer_hello(request: Request):
        await asyncio.to_thread(check_key, request.headers.get(KEY_HEADER, ""))
        return await asyncio.to_thread(hello, request.app.state.model)

    @app.get("/sync/peer/manifest", tags=TAG, summary="Peer: projects this key may take, with counts")
    async def peer_manifest(request: Request):
        view = await asyncio.to_thread(check_key, request.headers.get(KEY_HEADER, ""))
        return await asyncio.to_thread(manifest, view)

    @app.post("/sync/peer/export", tags=TAG, summary="Peer: one page of a project's part in a time range")
    async def peer_export(body: dict, request: Request):
        view = await asyncio.to_thread(check_key, request.headers.get(KEY_HEADER, ""))
        return await asyncio.to_thread(
            export, str(body.get("project") or ""), str(body.get("part") or ""), int(body.get("offset") or 0),
            int(body.get("limit") or PAGE_DEFAULT), str(body.get("since") or ""), str(body.get("until") or ""),
            bool(body.get("include_undated", True)), view)

    @app.post("/sync/peer/verify", tags=TAG, summary="Peer: match the key to a stored one and say what it allows")
    async def peer_verify(request: Request):
        view = await asyncio.to_thread(check_key, request.headers.get(KEY_HEADER, ""))
        return await asyncio.to_thread(verify, view)

    @app.post("/sync/peer/progress", tags=TAG, summary="Peer: the receiver's progress of a pull on this key")
    async def peer_progress(body: dict, request: Request):
        view = await asyncio.to_thread(check_key, request.headers.get(KEY_HEADER, ""))
        return await asyncio.to_thread(record_given, view, body)

    @app.get("/sync/given", tags=TAG, summary="Pulls receivers run with this KH's keys, with their progress")
    async def sync_given(limit: int = 30):
        return {"given": await asyncio.to_thread(list_given, limit)}

    # ── receiver ──
    @app.post("/sync/connect", tags=TAG, summary="Check a key: handshake and what the giving KH offers")
    async def sync_connect(body: dict, request: Request):
        return await asyncio.to_thread(connect, str(body.get("key") or ""), request.app.state.model)

    @app.post("/sync/pull", tags=TAG, status_code=202,
              summary="Pull the ticked projects / parts / time range from the giving KH; update, never replace")
    async def sync_pull(body: dict, request: Request):
        return await asyncio.to_thread(pull, body, request.app.state.model, True, _public_base(request))

    @app.get("/sync/grants", tags=TAG, summary="Read access members got here from sync keys")
    async def sync_grants():
        return {"grants": await asyncio.to_thread(list_grants)}

    @app.post("/sync/grants/remove", tags=TAG, summary="Take back read access a sync key gave")
    async def sync_grant_remove(body: dict):
        return await asyncio.to_thread(remove_grant, str(body.get("email") or ""), str(body.get("project") or ""))

    @app.get("/sync/accounts", tags=TAG, summary="Accounts a sync created here, with their initial passwords")
    async def sync_accounts():
        return {"accounts": await asyncio.to_thread(list_accounts)}

    @app.post("/sync/accounts/{email}/sent", tags=TAG, summary="The password was passed on: note it, forget it")
    async def sync_account_sent(email: str, body: Optional[dict] = None):
        return await asyncio.to_thread(mark_sent, email, bool((body or {}).get("forget", True)))

    @app.get("/sync/jobs", tags=TAG, summary="Sync jobs of this KH, newest first, with progress")
    async def sync_jobs(limit: int = 30):
        return {"jobs": await asyncio.to_thread(list_jobs, limit)}

    @app.get("/sync/jobs/{job_id}", tags=TAG, summary="One sync job with its progress and per-project report")
    async def sync_job(job_id: str):
        return await asyncio.to_thread(own_job, job_id)

    @app.post("/sync/jobs/{job_id}/cancel", tags=TAG, summary="Stop a running sync job after its current page")
    async def sync_job_cancel(job_id: str):
        return await asyncio.to_thread(cancel_job, job_id)

    logger.info("Sync routes attached (/home, /sync/*)")


__all__ = ["PROTOCOL", "DEFAULT_PARTS", "ALL_PARTS", "hello", "manifest", "export", "compare", "merge_project",
           "write_rows", "pull", "connect", "create_key", "check_key", "parse_key", "in_range", "Remote", "attach"]
