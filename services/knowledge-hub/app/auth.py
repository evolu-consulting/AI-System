"""
Sign-in and per-project access control for KH (the "SSO sign-in with roles and per-scope access
control" enhancement, 2026-09-24/25).

HOW IT WORKS. Keycloak signs people in (Google or Microsoft Entra behind it) and issues a short-lived
access token that carries a `kh` claim:

    {"role": "member", "permissions": ["project.create"], "all_projects": [],
     "projects": {"ticketing-system": ["project.read", "project.write", ...]}}

KH keeps NO permission table and holds NO credential to where the permissions are stored. It checks
the token's signature, issuer, audience and expiry, then asks one question per request: is the
permission this route needs in `all_projects` or in `projects[<the project this request touches>]`?
If not, 403. What a caller SAYS about itself (in a prompt, a body field, a header) never counts.

SHARED PROJECTS (2026-10-13, replacing the KH-side override of 2026-10-09). A semi-public or public
project is an ordinary project for KH: the identity service puts the levels it opens into the token
(roles semi.read / public.read / public.write, carried by tenant groups), so the token alone decides
here too. app/project_access.py only mirrors each project's visibility for display.

SYNC KEY READERS (2026-10-22). The one exception: a member who pulled a project with a sync key the giving KH
verified gets project.read on it from KH's own sync_grants table (with_key_reads, app/sync.py).

WHICH ROUTE NEEDS WHAT lives in auth_rules.json, not here. A route missing from that table is
refused to everyone but a maintainer, so a new route can never leak by being forgotten.

OFF BY DEFAULT. With KH_AUTH_ISSUER unset nothing changes: the local loopback install stays open
exactly as before, and the older shared KH_API_KEY gate still applies if that is set.

SERVICE PRINCIPALS (stage F3). Besides people's Keycloak tokens KH accepts two kinds of namespace-bound
tokens, both turned into the same Principal with ``ns`` set: KH-signed principal tokens (EdDSA, 15 min,
app/caps/principals.py) for agents, judges, graders and the like, and the namespace client's token (a
Keycloak client-credentials token of client ``kh-ns-<ns>``, or the KH-signed token of the 'local'
provisioner). Such a token may call /v1 routes only, and on an ``ns`` route only its own namespace.

TECHNICAL USERS (fen 2026-10-20). One KH account may be shared by an agent that serves several real
people. Such an account holds the KH-wide permission ``kh.act_for_user`` (Keycloak role technical-user)
and proves the real person of each request the on-behalf-of way (RFC 8693's actor and subject tokens):
its own token in Authorization, the person's own access token in ``X-KH-Acting-Token``. KH verifies the
person's token exactly like any other and takes the e-mail from it; an e-mail the agent merely states is
never read. The person's token comes from this KH realm, or from another sign-in service a maintainer
listed in KH_ACTING_ISSUERS for that technical user only (an app's own realm, e.g. a chatbot's users). A worklog so written carries that person (ACTING_KEY), and is read back only by the account
acting for the same person, by the person themselves, or by a maintainer; a worklog without the key is
read as before. The header counts only on a token holding the permission; anyone else's is ignored.

ACTORS (fen 2026-10-24). Several CLI sessions may share one account, as an agent's real people share a
technical user. Each session names itself in ``X-KH-Actor`` (its session id), the way an XMPP resource
names one connection of an account (RFC 6120, user@domain/resource). It is a label inside that account,
never a right: reads stay per account, a row only records which session wrote it (ACTOR_KEY), and a
message can be addressed to one session (app/messages.py). A session may claim any actor of its own
account, so no access decision ever reads it. It needs no sign-in, so it works with auth off too.
"""
from __future__ import annotations

import contextvars
import dataclasses
import json
import logging
import re
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import requests
from fastapi import Request

from . import config, personal

logger = logging.getLogger(__name__)

READ = "project.read"
# Only the owner level carries this permission (kh_catalog level_permissions), so holding it on a
# project is what 'owner' means here.
OWNER_MARK = "project.members.manage"
ACT_FOR_USER = "kh.act_for_user"
ACTING_HEADER = "x-kh-acting-token"
# Worklog metadata naming the real person a technical user wrote it for; '' or absent means nobody.
ACTING_KEY = "acting_user"
# The session (one CLI conversation) of the calling account; a label, never a right (ACTORS above).
ACTOR_HEADER = "x-kh-actor"
ACTOR_KEY = "actor"
ACTOR = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$")

RULES_PATH = Path(__file__).with_name("auth_rules.json")
HELP_PATH = "/auth/help"
DOWNLOAD_PATH = "/auth/download"
# Where the deploy puts the built kh-helper wheel (deploy/btp/push.ps1); served without sign-in.
DOWNLOADS_DIR = Path(__file__).resolve().parent.parent / "downloads"

# The /auth/help text is DATA, not code: one orchestrator knowledge row, edited with PUT /auth/help
# without a redeploy. seeds/auth_help.seed.txt is only the default: every start seeds it when the row
# is missing and never overwrites an edited one. {source}, {kh_url} and {issuer} are filled per request.
GUIDE_DOC = "auth-help"
GUIDE_ID = "kh-guide-auth-help"
GUIDE_SEED = Path(__file__).resolve().parent.parent / "seeds" / "auth_help.seed.txt"


# ── The caller ───────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class Principal:
    """Who is calling and what their token allows. Built only from a verified token."""
    email: str
    role: str
    kh_permissions: frozenset[str] = frozenset()
    every_project: frozenset[str] = frozenset()
    projects: dict[str, frozenset[str]] = field(default_factory=dict)
    # Stage F3: set only for namespace-bound service tokens (KH principals and namespace clients).
    ns: str | None = None
    svc_role: str | None = None
    on_behalf_of: str | None = None
    principal_id: str | None = None
    # The real person a technical user acts for in this request, from their own token (X-KH-Acting-Token).
    acting_user: str | None = None

    @property
    def is_technical(self) -> bool:
        return ACT_FOR_USER in self.kh_permissions

    @property
    def is_maintainer(self) -> bool:
        return self.role == "maintainer"

    @property
    def personal_project(self) -> str:
        """This person's own private project (app/personal.py); every permission on it is theirs."""
        from .personal import personal_id
        return personal_id(self.email)

    def is_owner(self, project: str) -> bool:
        """Owner level on this project: the only level that carries project.members.manage."""
        return OWNER_MARK in self.projects.get(project, frozenset())

    def _granted(self, project: str, permission: str) -> bool:
        return permission in self.every_project or permission in self.projects.get(project, frozenset())

    def can(self, project: str, permission: str) -> bool:
        """The token's grant; a shared project's levels are in the token like any other."""
        if project == self.personal_project:
            return True
        return self._granted(project, permission)

    def has(self, permission: str) -> bool:
        return permission in self.kh_permissions

    def visible_projects(self, permission: str = "project.read") -> set[str] | None:
        """Projects this caller holds `permission` on; None means every project."""
        if permission in self.every_project:
            return None
        granted = {pid for pid, perms in self.projects.items() if permission in perms}
        return granted | {self.personal_project}

    @classmethod
    def from_claims(cls, claims: dict) -> "Principal | None":
        client = re.fullmatch(re.escape(config._env("KH_NS_CLIENT_PREFIX", "kh-ns-")) + r"([a-z][a-z0-9_]{2,31})",
                              str(claims.get("azp") or claims.get("client_id") or ""))
        if client and not isinstance(claims.get("kh"), dict):
            # A Keycloak client-credentials token of a namespace client: the namespace administrator.
            ns = client.group(1)
            return cls(email=f"client:{ns}", role="member", ns=ns, svc_role="admin", principal_id="client")
        kh = claims.get("kh")
        email = (claims.get("email") or "").strip().lower()
        if not isinstance(kh, dict) or not email or kh.get("role") not in ("maintainer", "member"):
            return None
        return cls(email=email, role=kh["role"],
                   kh_permissions=frozenset(kh.get("permissions") or []),
                   every_project=frozenset(kh.get("all_projects") or []),
                   projects={str(k): frozenset(v or []) for k, v in (kh.get("projects") or {}).items()})


_current: contextvars.ContextVar[Principal | None] = contextvars.ContextVar("kh_principal", default=None)
# The caller's own access token, kept only for the length of the request so KH can relay it to
# Keycloak when a project is created or deleted. KH never stores it and holds no token of its own.
_token: contextvars.ContextVar[str | None] = contextvars.ContextVar("kh_token", default=None)


_actor: contextvars.ContextVar[str | None] = contextvars.ContextVar("kh_actor", default=None)


def actor_of(value) -> str | None:
    """A well-formed actor id, or None."""
    value = str(value or "").strip()
    return value if ACTOR.match(value) else None


def current_actor() -> str | None:
    """The session of the request being served (X-KH-Actor), or None when it names none or a malformed one."""
    return _actor.get()


class ActorMiddleware:
    """Reads X-KH-Actor into current_actor for the request. Installed with or without sign-in."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        raw = dict(scope.get("headers") or []).get(ACTOR_HEADER.encode(), b"")
        reset = _actor.set(actor_of(raw.decode("latin-1")))
        try:
            await self.app(scope, receive, send)
        finally:
            _actor.reset(reset)


def enabled() -> bool:
    return bool(config.AUTH_ISSUER)


def current() -> Principal | None:
    """The caller of the request being served, or None when auth is off."""
    return _current.get()


def visible_projects(permission: str = "project.read") -> set[str] | None:
    """Projects the current caller may see; None means no restriction (auth off, or every project)."""
    principal = current()
    return None if principal is None else principal.visible_projects(permission)


def filter_projects(ids, permission: str = "project.read") -> list:
    """Keep only the project ids the current caller may see, preserving order."""
    allowed = visible_projects(permission)
    return list(ids) if allowed is None else [pid for pid in ids if pid in allowed]


# The orchestrator's project registry (app/projects.py REGISTRY_KIND) keeps one row per project - its id,
# aliases and keywords - in orchestrator knowledge, which every member may read. Found by the two-person
# e2e run (2026-09-26): an unscoped knowledge read listed every project's name. Rows of that kind are
# visible only to people who may read the project they describe.
REGISTRY_KIND = "project-registry"
REGISTRY_ID_PREFIX = "project_registry__"      # app/projects.py _REGISTRY_ID


def acting_key() -> str | None:
    """Whose worklogs carrying a real person the caller may read; None means every one.

    A technical user acting for someone reads that person's; anyone else reads their own (a real
    person reads what an agent logged for them). A maintainer, or no sign-in, is not limited.
    """
    principal = current()
    if principal is None or principal.is_maintainer:
        return None
    return principal.acting_user or principal.email


def acting_visible(meta: dict | None) -> bool:
    """False for a worklog written for another real person than the caller may read (acting_key)."""
    owner = (meta or {}).get(ACTING_KEY)
    if not owner:
        return True
    key = acting_key()
    return key is None or owner == key


def row_visible(meta: dict | None, vector_id: str | None = None) -> bool:
    """False for a stored row the caller must not see even though its collection is readable.

    Reads that return metadata pass it; /vector/query hits carry only the row id, whose prefix
    names the same registry rows. A worklog of another real person (acting_visible) is hidden too.
    """
    m = meta or {}
    if not acting_visible(m):
        return False
    if m.get("kind") == REGISTRY_KIND:
        project = m.get("project_id")
    elif vector_id and vector_id.startswith(REGISTRY_ID_PREFIX):
        project = vector_id[len(REGISTRY_ID_PREFIX):]
    else:
        return True
    allowed = visible_projects()
    return allowed is None or project in allowed


def may(project: str, permission: str) -> bool:
    principal = current()
    return principal is None or principal.can(project, permission)


# ── Project registration at Keycloak ────────────────────────────────────────

class RegistryRefused(Exception):
    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status = status
        self.detail = detail


def _relay(method: str, path: str, payload: dict | None = None) -> None:
    """Call the Keycloak KH endpoint with the caller's own token; raise RegistryRefused on refusal."""
    url = config.AUTH_ISSUER.rstrip("/") + "/kh" + path
    resp = requests.request(method, url, json=payload, timeout=15,
                            headers={"Authorization": f"Bearer {_token.get()}"})
    if resp.status_code >= 300:
        try:
            detail = resp.json().get("error") or resp.text
        except ValueError:
            detail = resp.text
        raise RegistryRefused(resp.status_code, f"identity service refused: {detail}")


def register_project(project_id: str, visibility: str = "private") -> None:
    """Record a new project at Keycloak with the caller as its owner (D2) and its visibility, in one step,
    so a project is never left private by a half-done create. No-op with sign-in off."""
    if current() is not None:
        _relay("POST", "/projects", {"id": project_id, "visibility": visibility})


def set_project_visibility(project_id: str, visibility: str) -> None:
    """Record a project's visibility at Keycloak, which opens the shared levels from it and re-checks that
    the caller manages the project's people (owner, tenant admin, maintainer). No-op with sign-in off."""
    if current() is not None:
        _relay("PUT", f"/projects/{project_id}/visibility", {"visibility": visibility})


def unregister_project(project_id: str) -> None:
    """Remove a project and its grants at Keycloak; Keycloak re-checks project.delete. No-op with sign-in off."""
    if current() is not None:
        _relay("DELETE", f"/projects/{project_id}")


# ── Token verification ───────────────────────────────────────────────────────

class _Keys:
    """The issuer's signing keys, fetched from its JWKS endpoint and cached for a while."""

    def __init__(self, ttl_seconds: int = 600, jwks_uri: str | None = None):
        self.ttl = ttl_seconds
        self.jwks_uri = jwks_uri
        self._keys: dict[str, Any] = {}
        self._fetched = 0.0

    def get(self, kid: str):
        import jwt
        if kid not in self._keys or time.time() - self._fetched > self.ttl:
            url = self.jwks_uri or config.AUTH_ISSUER.rstrip("/") + "/protocol/openid-connect/certs"
            jwks = requests.get(url, timeout=10).json()
            self._keys = {k["kid"]: jwt.PyJWK(k).key for k in jwks.get("keys", [])
                          if k.get("use", "sig") == "sig"}
            self._fetched = time.time()
        return self._keys.get(kid)


_keys = _Keys()


def principal_of(token: str) -> "Principal | None":
    """The Principal of a verified token: a KH-signed service token, or a Keycloak token."""
    from . import dev_bootstrap
    from .caps import principals
    if token.startswith(dev_bootstrap.PREFIX) and dev_bootstrap.matches(token):   # DEV ONLY, off by default
        return dev_bootstrap.principal()
    if principals.is_kh_token(token):
        return principals.principal_from_token(token)        # raises ValueError when invalid
    return Principal.from_claims(verify(token))


@dataclass
class ActingIssuer:
    """Another sign-in service whose person tokens the listed technical users may pass (KH_ACTING_ISSUERS)."""
    issuer: str
    audience: str
    technical_users: frozenset[str]
    keys: "_Keys"


_acting_issuers: tuple[str, dict[str, ActingIssuer]] = ("", {})


def acting_issuers() -> dict[str, ActingIssuer]:
    """KH_ACTING_ISSUERS by issuer, parsed once per value; a broken entry is left out and logged."""
    global _acting_issuers
    raw = config.ACTING_ISSUERS
    if raw != _acting_issuers[0]:
        out: dict[str, ActingIssuer] = {}
        try:
            entries = json.loads(raw) if raw else []
        except ValueError:
            logger.error("auth — KH_ACTING_ISSUERS is not JSON; no other issuer is trusted")
            entries = []
        for e in entries if isinstance(entries, list) else []:
            try:
                iss = str(e["issuer"]).rstrip("/")
                tus = frozenset(str(t).strip().lower() for t in e["technical_users"])
                out[iss] = ActingIssuer(iss, str(e["audience"]), tus,
                                        _Keys(jwks_uri=e.get("jwks_uri") or iss + "/protocol/openid-connect/certs"))
            except (KeyError, TypeError) as exc:
                logger.error("auth — KH_ACTING_ISSUERS entry left out (%s): %s", exc, e)
        _acting_issuers = (raw, out)
    return _acting_issuers[1]


def acting_email(token: str, actor: str) -> str:
    """The e-mail of the real person whose own access token technical user ``actor`` passed on.

    Verified like every token (signature, issuer, audience, expiry), against this KH realm or an issuer
    KH_ACTING_ISSUERS lists for this actor. Only a person's token counts: a KH service token or a namespace
    client names no person. ValueError with a short reason otherwise.
    """
    import jwt
    from .caps import principals
    if principals.is_kh_token(token):
        raise ValueError("not a person's token")
    try:
        iss = str(jwt.decode(token, options={"verify_signature": False}).get("iss") or "").rstrip("/")
    except jwt.PyJWTError as e:
        raise ValueError("malformed token") from e
    if iss == config.AUTH_ISSUER.rstrip("/"):
        claims = verify(token)
        if claims.get("email_verified") is False:
            raise ValueError("the token names no verified e-mail")
    else:
        other = acting_issuers().get(iss)
        if other is None:
            raise ValueError("the token's issuer is not trusted")
        if actor not in other.technical_users:
            raise ValueError("this account may not pass tokens of that issuer")
        try:
            kid = jwt.get_unverified_header(token).get("kid")
        except jwt.PyJWTError as e:
            raise ValueError("malformed token") from e
        key = other.keys.get(kid) if kid else None
        if key is None:
            raise ValueError("unknown signing key")
        try:
            claims = jwt.decode(token, key, algorithms=["RS256", "PS256", "ES256"], audience=other.audience,
                                issuer=other.issuer, options={"require": ["exp", "iat", "iss", "aud"]}, leeway=30)
        except jwt.ExpiredSignatureError as e:
            raise ValueError("token expired") from e
        except jwt.PyJWTError as e:
            raise ValueError(f"invalid token: {e}") from e
        # Another service may let people type any address: only one it has checked names a person here.
        if claims.get("email_verified") is not True:
            raise ValueError("the token names no verified e-mail")
    email = (claims.get("email") or "").strip().lower()
    if not email:
        raise ValueError("the token names no e-mail")
    return email


def verify(token: str) -> dict:
    """Claims of a valid access token; raises ValueError with a short reason otherwise."""
    import jwt
    try:
        kid = jwt.get_unverified_header(token).get("kid")
    except jwt.PyJWTError as e:
        raise ValueError("malformed token") from e
    key = _keys.get(kid) if kid else None
    if key is None:
        raise ValueError("unknown signing key")
    try:
        return jwt.decode(token, key, algorithms=["RS256", "PS256", "ES256"],
                          audience=config.AUTH_AUDIENCE, issuer=config.AUTH_ISSUER.rstrip("/"),
                          options={"require": ["exp", "iat", "iss", "aud"]}, leeway=30)
    except jwt.ExpiredSignatureError as e:
        raise ValueError("token expired") from e
    except jwt.PyJWTError as e:
        raise ValueError(f"invalid token: {e}") from e


# ── Route rules ──────────────────────────────────────────────────────────────

@dataclass
class Rule:
    method: str
    template: str
    pattern: re.Pattern
    kind: str                     # public | authenticated | project | kh | maintainer | ns
    permission: str | None = None
    project_from: list[str] = field(default_factory=list)
    default_project: str | None = None
    log_permission: str | None = None   # used instead of `permission` when the body's scope is the log scope


def _compile(template: str) -> re.Pattern:
    """``{name}`` matches one path segment; ``{name:path}`` matches the rest, slashes included."""
    parts = re.split(r"(\{[a-z_]+(?::path)?\})", template)
    regex = "".join((f"(?P<{p[1:-6]}>.+)" if p.endswith(":path}") else f"(?P<{p[1:-1]}>[^/]+)")
                    if p.startswith("{") else re.escape(p) for p in parts)
    return re.compile(f"^{regex}$")


def load_rules(path: Path = RULES_PATH) -> list[Rule]:
    data = json.loads(path.read_text(encoding="utf-8"))
    rules = []
    for entry in data["routes"]:
        method, template = entry["route"].split(" ", 1)
        rules.append(Rule(method=method.upper(), template=template, pattern=_compile(template),
                          kind=entry["kind"], permission=entry.get("permission"),
                          project_from=entry.get("project_from", []),
                          default_project=entry.get("default_project"),
                          log_permission=entry.get("log_permission")))
    return rules


def match(rules: list[Rule], method: str, path: str) -> tuple[Rule | None, dict]:
    for rule in rules:
        if rule.method in (method, "*"):
            found = rule.pattern.match(path)
            if found:
                return rule, found.groupdict()
    return None, {}


def _dig(source: dict, dotted: str):
    value: Any = source
    for key in dotted.split("."):
        if not isinstance(value, dict):
            return None
        value = value.get(key)
    return value


def _named_project(rule: Rule, path_params: dict, query: dict, body: Any) -> str | None:
    """The project the request itself names, or None when it names none."""
    sources = {"path": path_params, "query": query, "body": body if isinstance(body, dict) else {}}
    for ref in rule.project_from:
        where, _, key = ref.partition(".")
        value = _dig(sources.get(where) or {}, key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def project_of(rule: Rule, path_params: dict, query: dict, body: Any) -> str | None:
    """The project a request touches, read from where this route carries it."""
    return _named_project(rule, path_params, query, body) or rule.default_project


def decide(rule: Rule | None, principal: Principal, path_params: dict, query: dict, body: Any) -> str | None:
    """None when the request may proceed, otherwise the reason it may not (a 403)."""
    if principal.ns is not None:
        # A namespace-bound service token: /v1 routes only, and only its own namespace.
        if rule is None or rule.kind not in ("ns", "authenticated", "public") or not rule.template.startswith("/v1/"):
            return "service tokens may call /v1 routes only"
        if rule.kind == "ns" and path_params.get("ns") != principal.ns:
            return "this token belongs to another namespace"
        return None
    if rule is None:
        return None if principal.is_maintainer else "route not open to members"
    if rule.kind == "ns":
        return None          # a person: the namespace route checks owner / maintainer itself (app/caps/core.py)
    if rule.kind in ("public", "authenticated"):
        return None
    if rule.kind == "maintainer":
        return None if principal.is_maintainer else "maintainers only"
    if rule.kind == "kh":
        return None if principal.has(rule.permission) else f"missing permission {rule.permission}"
    if rule.kind == "project":
        project = project_of(rule, path_params, query, body)
        scope = body.get("scope") if isinstance(body, dict) else query.get("scope")
        own = personal.is_personal_scope(scope) or (rule.permission == "project.write" and personal.redirects_write(scope))
        if own and _named_project(rule, path_params, query, body) is None:
            project = principal.personal_project      # a personal write naming no project is the caller's own
        permission = rule.permission
        if rule.log_permission and isinstance(body, dict) and body.get("scope") == config.HOTLOG_SCOPE:
            permission = rule.log_permission
        if not project:
            return None if principal.is_maintainer else "a project must be named"
        if principal.can(project, permission):
            return None
        if _named_project(rule, path_params, query, body) is None:
            # Name the fallback: "on this project" read as the caller's own project, and the
            # caller then hunted a grant they already held (2026-10-12).
            return (f"missing permission {permission} on this project (the request names no project, "
                    f"so it touched '{project}'; name it in {' or '.join(rule.project_from)})")
        return f"missing permission {permission} on this project"
    return "unknown rule"


def with_key_reads(principal: Principal) -> Principal:
    """The one exception to "the token alone decides" (Rowan 2026-10-22): project.read a sync key gave this
    person when they pulled a project with it (app/sync.py, A KEY IS A READER ROLE). Read only; a maintainer or
    a service token is left as it is."""
    if principal.ns is not None or principal.is_maintainer:
        return principal
    from . import sync
    extra = sync.reader_projects(principal.email)
    missing = [pid for pid in extra if sync.READER_PERMISSION not in principal.projects.get(pid, frozenset())]
    if not missing:
        return principal
    projects = dict(principal.projects)
    for pid in missing:
        projects[pid] = projects.get(pid, frozenset()) | {sync.READER_PERMISSION}
    return dataclasses.replace(principal, projects=projects)


# ── The ASGI middleware ──────────────────────────────────────────────────────

def _json_response(status: int, payload: dict):
    from starlette.responses import JSONResponse
    return JSONResponse(payload, status_code=status)


class AuthMiddleware:
    """Pure ASGI so the JSON body can be read here and still handed intact to the route."""

    def __init__(self, app, rules: list[Rule] | None = None):
        self.app = app
        self.rules = rules if rules is not None else load_rules()

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        from starlette.requests import Request

        method = scope["method"].upper()
        path = scope["path"]
        rule, path_params = match(self.rules, method, path)
        if method == "OPTIONS" or (rule is not None and rule.kind == "public"):
            return await self.app(scope, receive, send)

        request = Request(scope)
        header = request.headers.get("authorization", "")
        token = header[7:].strip() if header.lower().startswith("bearer ") else ""
        if not token:
            return await _json_response(401, {"detail": "sign-in required", "help": HELP_PATH})(scope, receive, send)
        try:
            principal = principal_of(token)
        except ValueError as e:
            return await _json_response(401, {"detail": str(e), "help": HELP_PATH})(scope, receive, send)
        except Exception:
            logger.exception("auth — could not verify a token")
            return await _json_response(503, {"detail": "sign-in service unavailable"})(scope, receive, send)
        if principal is None:
            return await _json_response(403, {"detail": "not a registered KH user"})(scope, receive, send)
        acting_token = request.headers.get(ACTING_HEADER, "").strip()
        if acting_token.lower().startswith("bearer "):
            acting_token = acting_token[7:].strip()
        if acting_token:
            if not principal.is_technical:
                logger.info("auth — %s ignored for %s: no %s", ACTING_HEADER, principal.email, ACT_FOR_USER)
            else:
                try:
                    acting = acting_email(acting_token, principal.email)
                except ValueError as e:
                    return await _json_response(401, {"detail": f"{ACTING_HEADER}: {e}", "help": HELP_PATH})(
                        scope, receive, send)
                except Exception:
                    logger.exception("auth — could not verify an acting token")
                    return await _json_response(503, {"detail": "sign-in service unavailable"})(scope, receive, send)
                if acting != principal.email:
                    principal = dataclasses.replace(principal, acting_user=acting)
        principal = with_key_reads(principal)

        raw = b""
        more = True
        while more:
            message = await receive()
            raw += message.get("body", b"")
            more = message.get("more_body", False)
        body: Any = None
        if raw and "json" in request.headers.get("content-type", ""):
            try:
                body = json.loads(raw)
            except ValueError:
                body = None

        # A worklog of a session bound to a project goes there (app/session_project.py), checked like any write.
        from app import session_project
        actor = current_actor() if principal.ns is None else None
        session_project.touch(principal.personal_project, actor)
        if method == "POST" and path == "/vector/add" and session_project.apply_to_log_write(principal, actor, body):
            raw = json.dumps(body).encode()
            scope = dict(scope, headers=[(k, v) for k, v in scope["headers"] if k.lower() != b"content-length"]
                         + [(b"content-length", str(len(raw)).encode())])
        refusal = decide(rule, principal, path_params, dict(request.query_params), body)
        if refusal:
            logger.info("auth — 403 %s %s for %s: %s", method, path, principal.email, refusal)
            return await _json_response(403, {"detail": refusal})(scope, receive, send)
        if principal.ns is None:
            from app import messages
            messages.note_user(principal.email)    # who may get a direct message: a person KH has verified

        sent = False

        async def replay():
            nonlocal sent
            if not sent:
                sent = True
                return {"type": "http.request", "body": raw, "more_body": False}
            return await receive()

        reset = _current.set(principal)
        reset_token = _token.set(token)
        try:
            await self.app(scope, replay, send)
        finally:
            _token.reset(reset_token)
            _current.reset(reset)


def install(app) -> None:
    """Attach the middleware and the /auth routes. Only the actor label when KH_AUTH_ISSUER is unset."""
    if not enabled():
        app.add_middleware(ActorMiddleware)
        return
    # Innermost: kh.api.call events need the principal the auth middleware sets (app/eventing/emit.py).
    from app.eventing.emit import ApiCallMiddleware
    app.add_middleware(ApiCallMiddleware)
    app.add_middleware(AuthMiddleware)
    # Added last, so it runs first: the auth middleware already reads the actor (app/session_project.py).
    app.add_middleware(ActorMiddleware)

    from fastapi.responses import PlainTextResponse

    from fastapi import HTTPException
    from fastapi.responses import FileResponse

    def _public_base(request: Request) -> str:
        # Behind the Cloud Foundry router the app sees plain HTTP; the router says what the caller used.
        proto = request.headers.get("x-forwarded-proto", request.url.scheme)
        host = request.headers.get("x-forwarded-host") or request.headers.get("host") or request.url.netloc
        return f"{proto}://{host}"

    def _helper_source():
        """The kh-helper download source set in the DB (app/downloads.py), or None."""
        from app import downloads
        try:
            return downloads.find("kh-helper")
        except Exception as exc:  # noqa: BLE001 - a store hiccup must not take the public help page down
            logger.warning("auth: download source lookup failed: %s", exc)
            return None

    def _helper_file() -> tuple[str, str] | None:
        """(file name, version) of the newest kh-helper: an uploaded artifact (app/artifacts.py, 1.15.0) or the
        wheel an older deploy bundled into downloads/, whichever is newer."""
        from app import artifacts
        found = []
        try:
            row = artifacts.latest("kh-helper")
            if row:
                found.append((row["name"], row["version"]))
        except Exception as exc:  # noqa: BLE001 - a store hiccup must not take the public help page down
            logger.warning("auth: artifact lookup failed: %s", exc)
        wheel = artifacts.bundled(DOWNLOADS_DIR)
        if wheel is not None:
            found.append((wheel.name, artifacts.parse_wheel(wheel.name)[1]))
        return max(found, key=lambda f: artifacts.version_key(f[1])) if found else None

    @app.get(HELP_PATH, response_class=PlainTextResponse, tags=["Auth"], summary="How to sign in to KH")
    async def auth_help(request: Request):
        base = _public_base(request)
        text = guide_text()
        src = _helper_source()
        if src is not None and src["type"] == "https":
            # The helper comes as a release zip from a link (app/downloads.py): step 1 installs its wheel file.
            text = text.replace('"KH" -m pip install {source}', (
                f'"KH" -m pip install "<the kh_helper-{src["version"] or "<version>"}-py3-none-any.whl file>"\n'
                f'     Get that file first: GET {base}{DOWNLOAD_PATH}/kh-helper answers JSON with the link, the '
                f'sha256\n     and the steps (download with curl -L, check the sha256, unzip).'))
            source = f"{base}{DOWNLOAD_PATH}/kh-helper"
        elif src is not None:
            source = f"{base}{DOWNLOAD_PATH}/{src['file_name']}"
        else:
            wheel = _helper_file()
            source = f"{base}{DOWNLOAD_PATH}/{wheel[0]}" if wheel else "./tools/kh-helper   (from the KH repository)"
        return fill_guide(text, source=source, kh_url=base, issuer=config.AUTH_ISSUER.rstrip("/"))

    @app.put(HELP_PATH, tags=["Auth"], summary="Replace the /auth/help text (maintainers)")
    async def auth_help_set(request: Request):
        body = await request.json()
        text = (body or {}).get("text") if isinstance(body, dict) else None
        if not isinstance(text, str) or not text.strip():
            raise HTTPException(422, "body must be {\"text\": \"<the new guide>\"}")
        set_guide(text, _encoder(request.app))
        return {"doc": GUIDE_DOC, "id": GUIDE_ID, "chars": len(text)}

    @app.get(DOWNLOAD_PATH + "/{filename}", tags=["Auth"], summary="Download the KH helper (no sign-in)")
    async def auth_download(filename: str, request: Request):
        import asyncio
        from app import artifacts, downloads
        # A source set in the DB wins (app/downloads.py): local = the file on this host, https = the link + steps.
        try:
            src = await asyncio.to_thread(downloads.find, filename)
        except Exception as exc:  # noqa: BLE001 - no source table yet: the older ways below
            logger.warning("auth: download source lookup failed: %s", exc)
            src = None
        if src is not None:
            if src["type"] == downloads.HTTPS:
                return downloads.answer(src, _public_base(request))
            try:
                path = downloads.local_file(src)
            except ValueError as exc:
                logger.warning("auth: local download source %s broken: %s", src["module"], exc)
                raise HTTPException(503, "the file is not on this host any more; tell a KH maintainer")
            return FileResponse(path, media_type="application/octet-stream", filename=src["file_name"] or path.name)
        # Any uploaded artifact by its exact name (older versions too, for a rollback), else the bundled
        # helper wheel; nothing else in the folder, no paths.
        if artifacts.NAME.match(filename):
            try:
                row = await asyncio.to_thread(artifacts.find, filename)
            except Exception as exc:  # noqa: BLE001 - no artifact table yet: the bundled wheel below
                logger.warning("auth: artifact lookup failed: %s", exc)
                row = None
            if row is not None:
                try:
                    return await asyncio.to_thread(artifacts.response, filename)
                except Exception as exc:  # noqa: BLE001 - the store's own failure
                    logger.warning("auth: artifact %s not served: %s", filename, exc)
                    raise HTTPException(503, "the file store did not answer; try again later")
        wheel = artifacts.bundled(DOWNLOADS_DIR)
        if wheel is None or filename != wheel.name:
            raise HTTPException(404, "not found")
        return FileResponse(wheel, media_type="application/octet-stream", filename=wheel.name)

    @app.get("/auth/config", tags=["Auth"], summary="Where to sign in (read by the KH helper)")
    async def auth_config(request: Request):
        src = _helper_source()
        if src is not None:
            helper = f"{_public_base(request)}{DOWNLOAD_PATH}/" + (
                "kh-helper" if src["type"] == "https" else src["file_name"])
            version = src["version"]
        else:
            wheel = _helper_file()
            helper = f"{_public_base(request)}{DOWNLOAD_PATH}/{wheel[0]}" if wheel else None
            version = wheel[1] if wheel else None
        return {"issuer": config.AUTH_ISSUER.rstrip("/"), "client_id": config.AUTH_CLIENT_ID,
                "audience": config.AUTH_AUDIENCE, "help": HELP_PATH, "helper": helper, "helper_version": version}

    @app.get("/auth/me", tags=["Auth"], summary="Who the token says you are and what it allows")
    async def auth_me(request: Request):
        import asyncio
        p = current()
        if p.ns is None and p.email:
            model = request.app.state.model
            await asyncio.to_thread(personal.touch, p.email, lambda t: model.encode(t, normalize_embeddings=True).tolist())
        return {"email": p.email, "personal_project": p.personal_project, "role": p.role, "permissions": sorted(p.kh_permissions),
                "all_projects": sorted(p.every_project),
                "projects": {k: sorted(v) for k, v in sorted(p.projects.items())}}


# ── The /auth/help guide, kept as data ───────────────────────────────────────

def _guide_collection():
    from . import vector_store as vs
    return vs.scope_collection("knowledge", "orchestrator")


def _encoder(app):
    model = getattr(app.state, "model", None)
    return lambda text: model.encode(text, normalize_embeddings=True).tolist()


def _stored_guide() -> str | None:
    # By id, not by a metadata filter: the HANA adapter filters metadata in Python over the whole
    # collection, and this is read on every public /auth/help call.
    res = _guide_collection().get(ids=[GUIDE_ID], include=["documents"])
    docs = res.get("documents") or []
    return docs[0] if docs and docs[0] and docs[0].strip() else None


def guide_text() -> str:
    """The stored guide, or the seed file when the row is missing or the store cannot be read."""
    try:
        stored = _stored_guide()
        if stored:
            return stored
    except Exception:
        logger.exception("auth help - stored guide unreadable, serving the seed")
    return GUIDE_SEED.read_text(encoding="utf-8")


def set_guide(text: str, encode) -> None:
    from . import vector_store as vs
    vs.upsert_vt(GUIDE_ID, encode(text), source_text=text, collection=_guide_collection(),
                 metadata={"scope": "knowledge", "project": "orchestrator", "doc": GUIDE_DOC,
                           "topic": GUIDE_DOC, "updated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})


def seed_guide(encode) -> str:
    """Start-up migration: seed the default guide when it is missing; never overwrite an edited one."""
    if _stored_guide():
        return "present"
    set_guide(GUIDE_SEED.read_text(encoding="utf-8"), encode)
    return "seeded"


def fill_guide(text: str, **values: str) -> str:
    # Plain replacement, not str.format: an edited guide may contain other braces.
    for key, value in values.items():
        text = text.replace("{" + key + "}", value)
    return text

