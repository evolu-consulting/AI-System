"""Service principals: an identity, a role and least privilege for every agent (design 3.4, 4.2).

Agents are not Keycloak users. They are rows of kh_principal, created per run by the namespace admin or
an orchestrator, and they authenticate with KH-signed EdDSA tokens valid 15 minutes:

    sub = "<ns>:<principal_id>", ns, role, obo (on behalf of), kid (header), iss = KH_PRINCIPAL_ISSUER

GRANTS NEVER WIDEN. Effective projects = principal.projects AND namespace.projects AND the projects of
``on_behalf_of`` (a snapshot in kh_owner_grant, refreshed whenever that person calls KH with their own
token and every 10 minutes by a cron under a lease). A revoked principal is refused at its next request
after at most KH_NS_CACHE_S (5 s): its state is cached that long per instance.

THE NAMESPACE CLIENT (the namespace administrator) is provisioned behind ``Provisioner``, chosen by
KH_NS_PROVISIONER: 'local' (default; KH issues a client secret, stores only its PBKDF2 hash and exchanges
it for a KH-signed admin token at POST /v1/token) or 'keycloak' (KH asks the Keycloak /kh extension, route
POST {issuer}/kh/namespaces, with the caller's own token; a missing route is a clear 503).

Routes: POST/GET /v1/{ns}/principals, GET/PATCH /v1/{ns}/principals/{id}, POST /v1/{ns}/principals/{id}/token,
POST /v1/admin/ns/{ns}:client (provision or rotate), POST /v1/token (client credentials), GET /v1/me.
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import logging
import re
import secrets
import threading
import time
from typing import Any

import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from fastapi import Depends, Request

from app import config, sqldb
from app.caps import core, registry
from app.caps.core import Caller, CapError, Ctx, ns_ctx

logger = logging.getLogger(__name__)

NAME = "principals"
VERSION = "1.0.0"
STATUS = "beta"
TOKEN_S = int(config._env("KH_PRINCIPAL_TOKEN_S", "900"))
ISSUER = config._env("KH_PRINCIPAL_ISSUER", "kh-principals")
AUDIENCE = "kh-v1"
MAX_ACTIVE = int(config._env("KH_PRINCIPALS_MAX", "2000"))
OWNER_REFRESH_S = 600
CLIENT_PREFIX = config._env("KH_NS_CLIENT_PREFIX", "kh-ns-")
LIMITS = {"token_s": TOKEN_S, "active_per_ns": MAX_ACTIVE, "owner_refresh_s": OWNER_REFRESH_S,
          "revocation_s": registry.CACHE_S}
PID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.\-]{0,95}$")
STATES = ("active", "suspended", "revoked")

_DDL = {
    "kh_principal": ("""CREATE TABLE IF NOT EXISTS kh_principal (
                          ns TEXT NOT NULL, principal_id TEXT NOT NULL, role TEXT NOT NULL, on_behalf_of TEXT NOT NULL,
                          projects_json TEXT NOT NULL, state TEXT NOT NULL, created_by TEXT NOT NULL,
                          created_ms INTEGER NOT NULL, expires_ms INTEGER, rev INTEGER NOT NULL DEFAULT 1,
                          PRIMARY KEY (ns, principal_id))""",
                     """CREATE COLUMN TABLE kh_principal (
                          ns NVARCHAR(32) NOT NULL, principal_id NVARCHAR(96) NOT NULL, role NVARCHAR(16) NOT NULL,
                          on_behalf_of NVARCHAR(256) NOT NULL, projects_json NCLOB NOT NULL, state NVARCHAR(16) NOT NULL,
                          created_by NVARCHAR(256) NOT NULL, created_ms BIGINT NOT NULL, expires_ms BIGINT,
                          rev BIGINT NOT NULL, PRIMARY KEY (ns, principal_id))"""),
    "kh_ns_client": ("""CREATE TABLE IF NOT EXISTS kh_ns_client (
                          ns TEXT PRIMARY KEY, client_id TEXT NOT NULL, provisioner TEXT NOT NULL, secret_hash TEXT,
                          state TEXT NOT NULL, created_ms INTEGER NOT NULL, rotated_ms INTEGER NOT NULL,
                          rev INTEGER NOT NULL DEFAULT 1)""",
                     """CREATE COLUMN TABLE kh_ns_client (
                          ns NVARCHAR(32) PRIMARY KEY, client_id NVARCHAR(64) NOT NULL, provisioner NVARCHAR(16) NOT NULL,
                          secret_hash NVARCHAR(256), state NVARCHAR(16) NOT NULL, created_ms BIGINT NOT NULL,
                          rotated_ms BIGINT NOT NULL, rev BIGINT NOT NULL)"""),
    "kh_owner_grant": ("""CREATE TABLE IF NOT EXISTS kh_owner_grant (
                            email TEXT PRIMARY KEY, projects_json TEXT NOT NULL, source TEXT NOT NULL,
                            refreshed_ms INTEGER NOT NULL)""",
                       """CREATE COLUMN TABLE kh_owner_grant (
                            email NVARCHAR(256) PRIMARY KEY, projects_json NCLOB NOT NULL, source NVARCHAR(16) NOT NULL,
                            refreshed_ms BIGINT NOT NULL)"""),
}
TABLES = list(_DDL)


def _m1(c) -> None:
    for name, (lite, hana) in _DDL.items():
        sqldb.create_table(c, name, lite, hana)
    sqldb.create_index(c, "ix_kh_principal_role", "kh_principal", "ns, role")


def init(c) -> None:
    sqldb.migrate(c, NAME, [(1, _m1)])


# ── signing keys ─────────────────────────────────────────────────────────────

class _Keys:
    """The current Ed25519 key (KH_PRINCIPAL_SIGNING_KEY, PEM) and old public keys still accepted
    (KH_PRINCIPAL_OLD_KEYS = JSON {kid: public PEM}; keep them 24 h after a rotation). Without the env
    variable a process-local key is generated: fine for one instance, NOT for several (set the env)."""

    def __init__(self):
        self._lock = threading.Lock()
        self._loaded = False
        self.private: Ed25519PrivateKey | None = None
        self.kid = ""
        self.public: dict[str, Ed25519PublicKey] = {}
        self.ephemeral = False

    def load(self) -> None:
        with self._lock:
            if self._loaded:
                return
            pem = config._env("KH_PRINCIPAL_SIGNING_KEY", "")
            if pem:
                key = serialization.load_pem_private_key(pem.replace("\\n", "\n").encode(), password=None)
                if not isinstance(key, Ed25519PrivateKey):
                    raise RuntimeError("KH_PRINCIPAL_SIGNING_KEY must be an Ed25519 private key (PEM)")
            else:
                key = Ed25519PrivateKey.generate()
                self.ephemeral = True
                logger.warning("principals - KH_PRINCIPAL_SIGNING_KEY is unset: using a process-local signing key; "
                               "tokens verify on this instance only")
            raw = key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
            self.kid = config._env("KH_PRINCIPAL_KID", "") or "ed-" + hashlib.sha256(raw).hexdigest()[:16]
            self.private = key
            self.public = {self.kid: key.public_key()}
            for kid, pub in (json.loads(config._env("KH_PRINCIPAL_OLD_KEYS", "{}")) or {}).items():
                self.public[kid] = serialization.load_pem_public_key(pub.replace("\\n", "\n").encode())
            self._loaded = True


KEYS = _Keys()


def is_kh_token(token: str) -> bool:
    try:
        return jwt.decode(token, options={"verify_signature": False}).get("iss") == ISSUER
    except jwt.PyJWTError:
        return False


def issue(ns: str, principal_id: str, role: str, obo: str, ttl_s: int = TOKEN_S) -> dict:
    KEYS.load()
    now = int(time.time())
    claims = {"iss": ISSUER, "aud": AUDIENCE, "iat": now, "exp": now + ttl_s, "sub": f"{ns}:{principal_id}",
              "ns": ns, "pid": principal_id, "role": role, "obo": obo, "jti": secrets.token_hex(8)}
    tok = jwt.encode(claims, KEYS.private, algorithm="EdDSA", headers={"kid": KEYS.kid, "typ": "kh+jwt"})
    return {"access_token": tok, "token_type": "Bearer", "expires_in": ttl_s, "expires_at": now + ttl_s}


def verify_token(token: str) -> dict:
    """Claims of a valid KH principal token; ValueError otherwise."""
    KEYS.load()
    try:
        kid = jwt.get_unverified_header(token).get("kid")
    except jwt.PyJWTError as e:
        raise ValueError("malformed token") from e
    key = KEYS.public.get(kid or "")
    if key is None:
        raise ValueError("unknown signing key")
    try:
        claims = jwt.decode(token, key, algorithms=["EdDSA"], audience=AUDIENCE, issuer=ISSUER, leeway=30,
                            options={"require": ["exp", "iat", "iss", "aud", "sub"]})
    except jwt.ExpiredSignatureError as e:
        raise ValueError("token expired") from e
    except jwt.PyJWTError as e:
        raise ValueError(f"invalid token: {e}") from e
    if not core.NS_RE.match(str(claims.get("ns") or "")) or claims.get("role") not in core.ROLES + (core.ADMIN,):
        raise ValueError("invalid token claims")
    return claims


def principal_from_token(token: str):
    """auth.Principal for a KH principal token (used by the auth middleware)."""
    from app import auth
    cl = verify_token(token)
    return auth.Principal(email=cl["sub"], role="member", ns=cl["ns"], svc_role=cl["role"], on_behalf_of=cl.get("obo"),
                          principal_id=cl["pid"])


# ── secrets of the 'local' provisioner ───────────────────────────────────────

_ITER = 120000


def hash_secret(secret: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", secret.encode(), salt, _ITER)
    return f"pbkdf2-sha256${_ITER}${base64.b64encode(salt).decode()}${base64.b64encode(dk).decode()}"


def check_secret(secret: str, stored: str | None) -> bool:
    try:
        algo, it, salt, dk = (stored or "").split("$")
        got = hashlib.pbkdf2_hmac("sha256", secret.encode(), base64.b64decode(salt), int(it))
        return algo == "pbkdf2-sha256" and hmac.compare_digest(got, base64.b64decode(dk))
    except (ValueError, TypeError):
        return False


# ── namespace client provisioning ────────────────────────────────────────────

class Provisioner:
    """Creates (or rotates) the namespace client - the namespace administrator's credential."""
    name = "base"

    def provision(self, ns: str, owner: str) -> dict:   # -> {client_id, client_secret?, provisioner}
        raise NotImplementedError

    def disable(self, ns: str) -> None:
        """Best effort at the identity provider; KH itself refuses a disabled client via kh_ns_client.state."""


class LocalProvisioner(Provisioner):
    name = "local"

    def provision(self, ns: str, owner: str) -> dict:
        secret = secrets.token_urlsafe(32)
        _store_client(ns, CLIENT_PREFIX + ns, self.name, hash_secret(secret))
        return {"client_id": CLIENT_PREFIX + ns, "client_secret": secret, "provisioner": self.name,
                "token_url": "/v1/token", "note": "the secret is shown once; KH stores only its hash"}


class KeycloakProvisioner(Provisioner):
    """POST {issuer}/kh/namespaces {ns, client_id, owner} with the caller's own token (the /kh extension)."""
    name = "keycloak"

    def provision(self, ns: str, owner: str) -> dict:
        import requests

        from app import auth
        if not config.AUTH_ISSUER:
            raise CapError("provisioner_unavailable", "KH_NS_PROVISIONER=keycloak needs KH_AUTH_ISSUER")
        url = config.AUTH_ISSUER.rstrip("/") + "/kh/namespaces"
        try:
            resp = requests.post(url, json={"ns": ns, "client_id": CLIENT_PREFIX + ns, "owner": owner}, timeout=15,
                                 headers={"Authorization": f"Bearer {auth._token.get() or ''}"})
        except requests.RequestException as exc:
            kind = type(exc).__name__
            raise CapError("provisioner_unavailable", f"the Keycloak /kh extension is unreachable ({kind}); "
                                                      "set KH_NS_PROVISIONER=local or retry later")
        if resp.status_code in (404, 405, 501):
            raise CapError("provisioner_unavailable",
                           "the Keycloak /kh extension has no namespace-client route (POST /kh/namespaces): deploy the "
                           "extension release that adds it, or set KH_NS_PROVISIONER=local")
        if resp.status_code >= 300:
            try:
                detail = resp.json().get("error") or resp.text
            except ValueError:
                detail = resp.text
            raise CapError("forbidden" if resp.status_code == 403 else "provisioner_unavailable",
                           f"identity service refused: {detail}", status=resp.status_code if resp.status_code < 500
                           else 503)
        data = resp.json() if resp.content else {}
        cid = data.get("client_id") or CLIENT_PREFIX + ns
        _store_client(ns, cid, self.name, None)
        out = {"client_id": cid, "provisioner": self.name,
               "token_url": config.AUTH_ISSUER.rstrip("/") + "/protocol/openid-connect/token"}
        if data.get("client_secret"):
            out["client_secret"] = data["client_secret"]
        return out


PROVISIONERS = {"local": LocalProvisioner, "keycloak": KeycloakProvisioner}


def provisioner() -> Provisioner:
    name = config._env("KH_NS_PROVISIONER", "local").lower()
    if name not in PROVISIONERS:
        raise CapError("provisioner_unavailable", f"KH_NS_PROVISIONER={name} is not one of {sorted(PROVISIONERS)}")
    return PROVISIONERS[name]()


def _store_client(ns: str, client_id: str, prov: str, secret_hash: str | None) -> None:
    with sqldb.connect() as c:
        now = sqldb.now_ms(c)
        if not sqldb.update(c, "UPDATE kh_ns_client SET client_id=?, provisioner=?, secret_hash=?, state='active', "
                               "rotated_ms=?, rev=rev+1 WHERE ns=?", [client_id, prov, secret_hash, now, ns]):
            sqldb.insert_new(c, "kh_ns_client", {"ns": ns, "client_id": client_id, "provisioner": prov,
                                                 "secret_hash": secret_hash, "state": "active", "created_ms": now,
                                                 "rotated_ms": now, "rev": 1})
    _client_cache.pop((sqldb.location(), ns), None)


# ── state caches (5 s) ───────────────────────────────────────────────────────

_principal_cache: dict[tuple, tuple[float, dict | None]] = {}
_client_cache: dict[tuple, tuple[float, dict | None]] = {}
_grant_cache: dict[tuple, tuple[float, Any]] = {}


def _cached(cache: dict, key: tuple, load):
    now = time.monotonic()
    hit = cache.get(key)
    if hit and hit[0] > now:
        return hit[1]
    val = load()
    cache[key] = (now + registry.CACHE_S, val)
    return val


def _decode(r) -> dict:
    return {"principal_id": r["principal_id"], "role": r["role"], "on_behalf_of": r["on_behalf_of"],
            "projects": json.loads(r["projects_json"] or "[]"), "state": r["state"], "created_by": r["created_by"],
            "created_ms": int(r["created_ms"]), "expires_ms": r["expires_ms"], "rev": int(r["rev"])}


def get_principal(ns: str, pid: str, fresh: bool = False) -> dict | None:
    def load():
        with sqldb.connect() as c:
            r = c.execute("SELECT * FROM kh_principal WHERE ns=? AND principal_id=?", [ns, pid]).fetchone()
        return _decode(r) if r else None
    if fresh:
        _principal_cache.pop((sqldb.location(), ns, pid), None)
    return _cached(_principal_cache, (sqldb.location(), ns, pid), load)


def get_client(ns: str) -> dict | None:
    def load():
        with sqldb.connect() as c:
            r = c.execute("SELECT client_id, provisioner, secret_hash, state FROM kh_ns_client WHERE ns=?",
                          [ns]).fetchone()
        return dict(r) if r else None
    return _cached(_client_cache, (sqldb.location(), ns), load)


def owner_projects(email: str) -> set[str] | None:
    """The person's projects as last seen (None = every project, i.e. a maintainer). Empty when unknown."""
    from app import auth
    if email == config.MSG_LOCAL_USER and not auth.enabled():
        # Sign-in off: the local owner already administers everything on this KH (core._default_caller), so a
        # namespace it attached gets its own project list, not an empty grant (2026-10-12, agent-only installs).
        return None

    def load():
        with sqldb.connect() as c:
            r = c.execute("SELECT projects_json FROM kh_owner_grant WHERE email=?", [email]).fetchone()
        return json.loads(r["projects_json"]) if r else []
    got = _cached(_grant_cache, (sqldb.location(), email), load)
    return None if "*" in got else set(got)


_noted: dict[str, float] = {}


def note_person(p) -> None:
    """Snapshot a person's projects from their own (Keycloak) token; at most once a minute per person."""
    now = time.monotonic()
    if now - _noted.get(p.email, 0) < 60:
        return
    _noted[p.email] = now
    projects = ["*"] if p.is_maintainer or "project.read" in p.every_project else sorted(
        pid for pid, perms in p.projects.items() if "project.read" in perms)
    set_owner_projects(p.email, projects, "token")


def set_owner_projects(email: str, projects: list[str], source: str) -> None:
    with sqldb.connect() as c:
        sqldb.upsert(c, "kh_owner_grant", ("email",), {"email": email, "projects_json": core.jdump(sorted(projects)),
                                                       "source": source, "refreshed_ms": sqldb.now_ms(c)})
    _grant_cache.pop((sqldb.location(), email), None)


#: KH's own internal namespace (app/caps/people.py): its project list is stored as [] = every project, and its
#: owner is the KH maintainers group, not a person with a grant row. The kh prefix is reserved for consumers.
KH_OWN_NS = "kh_people"


def effective_projects(ns_row: dict, own: list[str] | None, obo: str) -> set[str] | None:
    """principal.projects AND namespace.projects AND the projects of on_behalf_of. Never wider than any of them.

    kh_people (KH's own namespace, every project): only the principal's own list narrows it; None = every project.
    Without this its namespace client could not write a project-tagged event (dev check 2026-10-11: every
    worker.run event with a project was refused 'no grant on project')."""
    if ns_row.get("ns") == KH_OWN_NS and not ns_row.get("projects"):
        return set(own) if own else None
    eff = set(ns_row.get("projects") or [])
    if own:
        eff &= set(own)
    theirs = owner_projects(obo)
    if theirs is not None:
        eff &= theirs
    return eff


# ── resolving the caller of a namespace route ────────────────────────────────

def _bearer(request: Request) -> str:
    h = request.headers.get("authorization", "")
    return h[7:].strip() if h.lower().startswith("bearer ") else ""


def resolve(request: Request, ns_row: dict) -> Caller | None:
    """core.CALLER_RESOLVERS entry: KH principal tokens and namespace clients. People fall through."""
    from app import auth
    p = auth.current()
    if p is None and not auth.enabled():
        tok = _bearer(request)                       # sign-in off (local dev): principal tokens still work
        if tok and is_kh_token(tok):
            try:
                p = principal_from_token(tok)
            except ValueError as exc:
                raise CapError("unauthorized", str(exc))
    if p is None:
        return None
    ns = ns_row["ns"]
    if p.ns is None:
        if p.is_maintainer or p.email == (ns_row.get("owner_email") or "").lower():
            note_person(p)
        return None                                  # people: core's default rule (maintainer or owner = admin)
    if p.ns != ns:
        raise CapError("forbidden", "this token belongs to another namespace")
    if p.svc_role == core.ADMIN:
        client = get_client(ns)
        if client is None or client["state"] != "active":
            raise CapError("unauthorized", "the namespace client is disabled")
        obo = ns_row.get("owner_email") or ""
        return Caller(principal="client", role=core.ADMIN, kind="client", on_behalf_of=obo,
                      projects=effective_projects(ns_row, None, obo))
    row = get_principal(ns, p.principal_id)
    if row is None or row["state"] != "active":
        raise CapError("unauthorized", f"principal {p.principal_id} is {row['state'] if row else 'unknown'}")
    if row["expires_ms"] and row["expires_ms"] < time.time() * 1000:
        raise CapError("unauthorized", f"principal {p.principal_id} expired")
    return Caller(principal=row["principal_id"], role=row["role"], kind="service", on_behalf_of=row["on_behalf_of"],
                  projects=effective_projects(ns_row, row["projects"], row["on_behalf_of"]))


# ── principal management ─────────────────────────────────────────────────────

def _counter(ns: str) -> str:
    return f"principals:active:{ns}"


def create(ctx: Ctx, body: dict) -> dict:
    ctx.require("admin", "principals")
    role = body.get("role")
    if role not in core.ROLES:
        raise CapError("invalid", f"role must be one of {list(core.ROLES)}")
    if role == "orchestrator" and not ctx.is_admin:
        raise CapError("forbidden", "only the namespace admin creates orchestrators")
    pid = body.get("principal_id") or f"p_{secrets.token_hex(6)}"
    if not isinstance(pid, str) or not PID_RE.match(pid):
        raise CapError("invalid", "principal_id must match [A-Za-z0-9][A-Za-z0-9_.-]{0,95}")
    obo = (body.get("on_behalf_of") or ctx.caller.on_behalf_of or ctx.ns_row.get("owner_email") or "").lower()
    if ctx.caller.kind == "service" and obo != (ctx.caller.on_behalf_of or "").lower():
        raise CapError("forbidden", "an orchestrator creates principals on its own on_behalf_of only")
    creator = ctx.caller.projects if ctx.caller.projects is not None else set(ctx.ns_row.get("projects") or [])
    projects = body.get("projects")
    if projects is None:
        # [] = every namespace project (still intersected with on_behalf_of at each request); a service
        # creator hands down exactly its own effective projects.
        projects = [] if ctx.caller.kind != "service" else sorted(creator)
    if not isinstance(projects, list) or not set(projects) <= creator:
        raise CapError("forbidden", "a principal cannot get projects its creator does not have")
    ttl = body.get("ttl_s")
    if ttl is not None and (not isinstance(ttl, int) or ttl < 60):
        raise CapError("invalid", "ttl_s must be an integer >= 60")
    with sqldb.connect() as c:
        # The cap is a conditional counter increment: exactly MAX_ACTIVE active principals per namespace,
        # even when many orchestrators create them at once.
        sqldb.counter_add(c, _counter(ctx.ns), 0)
        if not sqldb.update(c, "UPDATE kh_counter SET n = n + 1 WHERE name=? AND n < ?", [_counter(ctx.ns), MAX_ACTIVE]):
            raise CapError("quota", f"at most {MAX_ACTIVE} active principals per namespace",
                           kh_events=[(ctx.ns, "kh.quota", {"quota": "active_principals", "limit": MAX_ACTIVE},
                                       ctx.actor())])
        now = sqldb.now_ms(c)
        row = {"ns": ctx.ns, "principal_id": pid, "role": role, "on_behalf_of": obo,
               "projects_json": core.jdump(sorted(set(projects))), "state": "active",
               "created_by": ctx.caller.principal, "created_ms": now,
               "expires_ms": now + ttl * 1000 if ttl else None, "rev": 1}
        if not sqldb.insert_new(c, "kh_principal", row):
            raise CapError("duplicate", f"principal {pid} exists")
    return get_principal(ctx.ns, pid, fresh=True)


def set_principal_state(ctx: Ctx, pid: str, state: str, expected_rev: int | None) -> dict:
    ctx.require("admin", "principals")
    if state not in STATES:
        raise CapError("invalid", f"state must be one of {list(STATES)}")
    with sqldb.connect() as c:
        cur = c.execute("SELECT state FROM kh_principal WHERE ns=? AND principal_id=?", [ctx.ns, pid]).fetchone()
        if cur is None:
            raise CapError("not_found", f"no principal {pid}")
        old = cur["state"]
        if old == "revoked" and state != "revoked":
            raise CapError("invalid", "a revoked principal stays revoked; create a new one")
        core.cas_update(ctx, c, "kh_principal", {"ns": ctx.ns, "principal_id": pid}, {"state": state}, expected_rev,
                        extra_where="state=?", extra_params=[old])
        if old == "active" and state != "active":
            c.execute("UPDATE kh_counter SET n = n - 1 WHERE name=? AND n > 0", [_counter(ctx.ns)])
        elif old != "active" and state == "active":
            sqldb.counter_add(c, _counter(ctx.ns), 1)
    return get_principal(ctx.ns, pid, fresh=True)


def token_for(ctx: Ctx, pid: str) -> dict:
    ctx.require("admin", "principals")
    row = get_principal(ctx.ns, pid, fresh=True)
    if row is None:
        raise CapError("not_found", f"no principal {pid}")
    if row["state"] != "active":
        raise CapError("forbidden", f"principal {pid} is {row['state']}")
    if row["role"] == "orchestrator" and not ctx.is_admin:
        raise CapError("forbidden", "only the namespace admin issues orchestrator tokens")
    return {**issue(ctx.ns, pid, row["role"], row["on_behalf_of"]), "principal_id": pid, "role": row["role"]}


def _on_state(c, ns: str, old: str, new: str) -> None:
    """Detach suspends every active principal and disables the namespace client; re-attach re-enables the client
    only (principals belong to the old session; the orchestrator creates new ones)."""
    if new == "detached":
        c.execute("UPDATE kh_principal SET state='suspended', rev=rev+1 WHERE ns=? AND state='active'", [ns])
        sqldb.ensure_core(c)
        c.execute("UPDATE kh_counter SET n=0 WHERE name=?", [_counter(ns)])
        c.execute("UPDATE kh_ns_client SET state='disabled', rev=rev+1 WHERE ns=?", [ns])
    elif new == "active" and old == "detached":
        c.execute("UPDATE kh_ns_client SET state='active', rev=rev+1 WHERE ns=?", [ns])
    for cache in (_principal_cache, _client_cache):
        for k in [k for k in cache if len(k) > 1 and k[1] == ns]:
            cache.pop(k, None)


def _on_attach(ns: str, owner: str) -> dict:
    """Provision the namespace client when a namespace is first attached. A provisioner failure does not undo
    the attach; the response says what happened and POST /v1/admin/ns/{ns}:client retries."""
    from app import auth
    p = auth.current()
    if p is not None and p.ns is None and p.email == owner:
        _noted.pop(p.email, None)
        note_person(p)                     # the owner's grants, from the token that attached the namespace
    try:
        return provisioner().provision(ns, owner)
    except CapError as exc:
        return {"error": exc.code, "detail": exc.detail}


def exchange(body: dict) -> dict:
    """Client credentials -> a KH-signed namespace admin token (provisioner 'local')."""
    if body.get("grant_type", "client_credentials") != "client_credentials":
        raise CapError("invalid", "grant_type must be client_credentials")
    cid, secret = str(body.get("client_id") or ""), str(body.get("client_secret") or "")
    if not cid.startswith(CLIENT_PREFIX) or not secret:
        raise CapError("unauthorized", "invalid client")
    ns = cid[len(CLIENT_PREFIX):]
    client = get_client(ns) if core.NS_RE.match(ns) else None
    row = registry.ns_state(ns) if client else None
    if client is None or client["provisioner"] != "local" or client["client_id"] != cid \
            or not check_secret(secret, client["secret_hash"]):
        raise CapError("unauthorized", "invalid client")
    if client["state"] != "active" or row is None or row["state"] not in ("active", "suspended"):
        raise CapError("unauthorized", "the namespace client is disabled")
    return issue(ns, "client", core.ADMIN, row["owner_email"])


# ── owner-grant refresh (cron, under a lease) ────────────────────────────────

def fetch_owner_projects(email: str) -> list[str] | None:
    """The person's current projects from the identity service, or None when KH cannot ask.

    Keycloak: GET {issuer}/kh/users/{email}/projects with a client-credentials token of KH's own service client
    (KH_KC_CLIENT_ID / KH_KC_CLIENT_SECRET). Without those, the snapshot from the person's last call stays.
    """
    cid, secret = config._env("KH_KC_CLIENT_ID", ""), config._env("KH_KC_CLIENT_SECRET", "")
    if not (config.AUTH_ISSUER and cid and secret):
        return None
    import requests
    base = config.AUTH_ISSUER.rstrip("/")
    try:
        tok = requests.post(base + "/protocol/openid-connect/token", timeout=10,
                            data={"grant_type": "client_credentials", "client_id": cid, "client_secret": secret}).json()
        resp = requests.get(f"{base}/kh/users/{email}/projects", timeout=10,
                            headers={"Authorization": f"Bearer {tok.get('access_token', '')}"})
        if resp.status_code != 200:
            return None
        data = resp.json()
        return list(data.get("projects") or []) if isinstance(data, dict) else list(data)
    except Exception:  # noqa: BLE001
        logger.exception("principals - owner grant fetch failed for %s", email)
        return None


def refresh_owner_grants(fetch=fetch_owner_projects) -> dict:
    """Re-read the projects of every on_behalf_of person still in use; a person who lost a project makes all
    their namespaces' principals lose it at once (window: 10 min + one token lifetime)."""
    with sqldb.connect() as c:
        emails = {r[0] for r in c.execute("SELECT DISTINCT on_behalf_of FROM kh_principal WHERE state='active'")}
        emails |= {r[0] for r in c.execute("SELECT owner_email FROM kh_ns WHERE state IN ('active','suspended')")}
    done = 0
    for email in sorted(e for e in emails if e):
        got = fetch(email)
        if got is not None:
            set_owner_projects(email, got, "refresh")
            done += 1
    return {"people": len(emails), "refreshed": done}


CRONS = [("cron.owner_grants", OWNER_REFRESH_S, refresh_owner_grants)]


# ── routes ───────────────────────────────────────────────────────────────────

async def _body(request: Request) -> dict:
    raw = await request.body()
    if not raw:
        return {}
    ctype = request.headers.get("content-type", "")
    if "x-www-form-urlencoded" in ctype:
        from urllib.parse import parse_qsl
        return dict(parse_qsl(raw.decode()))
    try:
        b = json.loads(raw)
    except ValueError:
        raise CapError("invalid", "body must be JSON")
    if not isinstance(b, dict):
        raise CapError("invalid", "body must be a JSON object")
    return b


def attach(app) -> None:
    TAG = ["v1 principals"]
    if resolve not in core.CALLER_RESOLVERS:
        core.CALLER_RESOLVERS.insert(0, resolve)
    if _on_state not in registry.ON_STATE:
        registry.ON_STATE.append(_on_state)
    if _on_attach not in registry.ON_ATTACH:
        registry.ON_ATTACH.append(_on_attach)

    @app.post("/v1/{ns}/principals", tags=TAG, summary="Create a service principal (admin or orchestrator)")
    @core.idempotent
    async def principals_post(request: Request, ns: str, ctx: Ctx = Depends(ns_ctx)):
        body = await _body(request)
        return core.reply(201, await asyncio.to_thread(create, ctx, body))

    @app.get("/v1/{ns}/principals", tags=TAG, summary="Principals of a namespace (?role=&state=)")
    async def principals_list(ns: str, role: str = "", state: str = "", limit: int = 500,
                              ctx: Ctx = Depends(ns_ctx)):
        ctx.require("admin", "principals")

        def run():
            where, params = ["ns=?"], [ns]
            for col, v in (("role", role), ("state", state)):
                if v:
                    where.append(f"{col}=?")
                    params.append(v)
            with sqldb.connect() as c:
                rows = c.execute(f"SELECT * FROM kh_principal WHERE {' AND '.join(where)} ORDER BY principal_id "
                                 "LIMIT ?", params + [max(1, min(limit, 2000))]).fetchall()
            return {"principals": [_decode(r) for r in rows]}
        return await asyncio.to_thread(run)

    @app.get("/v1/{ns}/principals/{pid}", tags=TAG, summary="One principal")
    async def principal_get(ns: str, pid: str, ctx: Ctx = Depends(ns_ctx)):
        if not (ctx.caller.principal == pid or core.role_allows(ctx.role, "admin", "principals")):
            raise CapError("forbidden", "admin, orchestrator or the principal itself")
        row = await asyncio.to_thread(get_principal, ns, pid, True)
        if row is None:
            raise CapError("not_found", f"no principal {pid}")
        return core.reply(200, row, {"ETag": core.etag(row["rev"])})

    @app.patch("/v1/{ns}/principals/{pid}", tags=TAG, summary="Change a principal's state (revoked = refused within 5 s)")
    @core.idempotent
    async def principal_patch(request: Request, ns: str, pid: str, ctx: Ctx = Depends(ns_ctx)):
        body = await _body(request)
        row = await asyncio.to_thread(set_principal_state, ctx, pid, body.get("state"), core.if_match(request))
        return core.reply(200, row, {"ETag": core.etag(row["rev"])})

    @app.post("/v1/{ns}/principals/{pid}/token", tags=TAG, summary="A 15-minute KH-signed token for a principal")
    async def principal_token(request: Request, ns: str, pid: str, ctx: Ctx = Depends(ns_ctx)):
        return await asyncio.to_thread(token_for, ctx, pid)

    @app.post("/v1/admin/ns/{ns}:client", tags=TAG, summary="Provision or rotate the namespace client")
    async def ns_client(ns: str, request: Request):
        def run():
            with sqldb.connect() as c:
                r = c.execute("SELECT * FROM kh_ns WHERE ns=?", [ns]).fetchone()
            if r is None:
                raise CapError("not_found", f"no namespace {ns}")
            row = registry._decode_ns(r)
            registry._admin_person(request, row["projects"], row)
            if row["state"] not in ("active", "suspended"):
                raise CapError("ns_not_active", f"namespace {ns} is {row['state']}")
            return provisioner().provision(ns, row["owner_email"])
        return core.reply(201, await asyncio.to_thread(run))

    @app.post("/v1/token", tags=TAG, summary="Client credentials -> namespace admin token (provisioner 'local')")
    async def token(request: Request):
        body = await _body(request)
        return await asyncio.to_thread(exchange, body)

    @app.get("/v1/me", tags=TAG, summary="Who the token says you are on /v1")
    async def me(request: Request):
        from app import auth
        p = auth.current()
        if p is None and not auth.enabled():
            tok = _bearer(request)
            if tok and is_kh_token(tok):
                try:
                    p = principal_from_token(tok)
                except ValueError as exc:
                    raise CapError("unauthorized", str(exc))
        if p is None:
            return {"kind": "local", "principal": config.MSG_LOCAL_USER, "role": core.ADMIN}
        if p.ns is None:
            return {"kind": "person", "principal": p.email, "maintainer": p.is_maintainer}
        row = registry.ns_state(p.ns)
        if row is None or row["state"] in ("detached", "purged"):
            raise CapError("ns_not_active", f"namespace {p.ns} is not attached")
        caller = await asyncio.to_thread(resolve, request, row)
        return {"kind": caller.kind, "ns": p.ns, "principal": caller.principal, "role": caller.role,
                "on_behalf_of": caller.on_behalf_of, "projects": sorted(caller.projects or [])}
