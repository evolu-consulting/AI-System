"""Tests for the session project binding (app/session_project.py), fen 2026-10-24.

WHAT IS UNDER TEST
  1. BIND. The first prompt of an unbound session that names a project by id or alias binds it; a keyword
     alone does not. Once bound, the turn context names the bound project even when a later prompt matches
     another one, and says so.
  2. USE. A worklog write carrying the session id lands in the bound project whatever the body names; a write
     without the session id, or of another session, follows the body as before; a non-log write is untouched;
     a bound project the caller may no longer log to leaves the body in charge.
  3. SWITCH. PUT /session/project switches (the person asked); an unknown project is 404, one without
     project.log 403; DELETE unbinds. Each account keeps its own bindings.
  4. KEEP. A binding idle past the TTL reads as absent and POST /session/sweep (maintainers) deletes it; a used
     one stays.

Run from the repo root with the project venv:
    .venv\\Scripts\\python tests\\test_session_project.py

Uses a locally generated RSA key, throwaway stores and an in-process app; no network.
"""
import os
import sys
import tempfile
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

TMP = tempfile.mkdtemp(prefix="kh_session_")
os.environ["KH_HOOKS_DB"] = os.path.join(TMP, "hooks.db")
os.environ["CHROMA_PATH"] = os.path.join(TMP, "chroma")
os.environ["KH_PROJECTS_PATH"] = os.path.join(TMP, "projects")
os.environ["KH_KUZU_PROJECTS_PATH"] = os.path.join(TMP, "kuzu")
ISSUER = "https://keycloak.test/realms/knowledge-hub"
os.environ["KH_AUTH_ISSUER"] = ISSUER
os.environ["KH_AUTH_AUDIENCE"] = "kh-api"

import jwt  # noqa: E402
import numpy  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import rsa  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import auth, config, projects, session_project, sqldb  # noqa: E402

assert TMP in config.CHROMA_PATH, "test must run against a throwaway chroma dir"

import main  # noqa: E402

FAILURES = []


def check(name, condition, detail=None):
    print(("ok   " if condition else "FAIL ") + name + ("" if condition or detail is None else f"  -> {detail}"))
    if not condition:
        FAILURES.append(name)


class _Model:
    @staticmethod
    def encode(text, normalize_embeddings=True):
        if isinstance(text, list):
            return [_Model.encode(t) for t in text]
        v = numpy.zeros(384, dtype="float32")
        v[0] = 1.0
        return v


KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
auth._keys.get = lambda kid: KEY.public_key() if kid == "k1" else None
auth.register_project = lambda pid, *rest: None
auth.unregister_project = lambda pid: None
LOG = ["project.read", "project.write", "project.log"]


def token(email, grants, admin=False):
    now = int(time.time())
    kh = {"role": "maintainer" if admin else "member", "permissions": [], "all_projects": LOG if admin else [],
          "projects": {p: list(v) for p, v in grants.items()}}
    claims = {"iss": ISSUER, "aud": "kh-api", "iat": now, "exp": now + 300, "email": email, "kh": kh}
    return {"Authorization": "Bearer " + jwt.encode(claims, KEY, algorithm="RS256", headers={"kid": "k1"})}


TU_E = "tu@kh-agent.invalid"
GRANTS = {"ai-sdlc": LOG, "kh-tools": LOG, "designer": LOG, "readme": ["project.read"]}
TU = token(TU_E, GRANTS)
OTHER = token("other@example.invalid", GRANTS)
ADMIN = token("root@example.invalid", {}, admin=True)


def as_session(h, sid):
    return {**h, "X-KH-Actor": sid}


S1, S2 = as_session(TU, "sess-a"), as_session(TU, "sess-b")

main.app.state.model = _Model()
client = TestClient(main.app)
projects.ensure_orchestrator()
for p in ("ai-sdlc", "kh-tools", "designer", "readme"):
    projects.get_or_create_project(p)
projects.registry_entries = lambda: [
    {"id": "ai-sdlc", "role": "project", "aliases": ["dlc"], "keywords": ["pipeline"]},
    {"id": "kh-tools", "role": "project", "aliases": [], "keywords": ["tool"]},
    {"id": "designer", "role": "project", "aliases": [], "keywords": ["design"]},
    {"id": "readme", "role": "project", "aliases": ["read me"], "keywords": []},
]
OWNER = auth.Principal(email=TU_E, role="member").personal_project


def turn(h, text):
    r = client.get("/turn/context", params={"text": text}, headers=h)
    return r.json() if r.status_code == 200 else {"error": r.status_code, "text": r.text}


def log(h, text, project=None, scope="log"):
    meta = {"subject": "work", "topic": "work", "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    if project:
        meta["project"] = project
    return client.post("/vector/add", json={"text": text, "scope": scope, "metadata": meta}, headers=h)


def where(text, scope="log"):
    """The project whose store holds the row (a maintainer reads every project)."""
    for p in ("ai-sdlc", "kh-tools", "designer", "readme", OWNER):
        r = client.post("/vector/scroll", json={"scope": scope, "project": p, "limit": 500}, headers=ADMIN)
        if any(h["source_text"] == text for h in r.json().get("hits", [])):
            return p
    return None


# ── 1. bind ─────────────────────────────────────────────────────────────────
ctx = turn(S1, "which tool should I use here")
check("a keyword alone does not bind the session", session_project.get(OWNER, "sess-a") is None,
      session_project.get(OWNER, "sess-a"))
check("an unbound session is told how to bind", "PUT /session/project" in ctx.get("text", ""), ctx.get("text"))
ctx = turn(S1, "continue the DLC design flow")
b = session_project.get(OWNER, "sess-a")
check("a prompt naming a project by alias binds it", b and b["project"] == "ai-sdlc" and b["source"] == "detected", b)
check("the turn context names the bound project", ctx["project"]["best"] == "ai-sdlc"
      and "BOUND TO THIS SESSION" in ctx["text"], ctx.get("text", "")[:400])
ctx = turn(S1, "open the designer tool")
check("a later prompt matching another project keeps the binding", ctx["project"]["best"] == "ai-sdlc"
      and session_project.get(OWNER, "sess-a")["project"] == "ai-sdlc", ctx["project"])
ctx = turn(S1, "now look at kh-tools")
check("a later prompt naming another project by id only mentions it",
      ctx["project"]["best"] == "ai-sdlc" and "also names 'kh-tools'" in ctx["text"], ctx["text"][:500])
check("a call without a session id is matched per prompt as before",
      turn(TU, "open the designer tool")["project"]["best"] == "designer")
turn(S2, "read me first")
check("a project without project.log is never bound", session_project.get(OWNER, "sess-b") is None)

# ── 2. use ──────────────────────────────────────────────────────────────────
r = log(S1, "log body names kh-tools", project="kh-tools")
check("a bound session's worklog is accepted", r.status_code == 200, r.text)
check("it lands in the bound project, not the one the body names", where("log body names kh-tools") == "ai-sdlc",
      where("log body names kh-tools"))
r = log(S1, "log naming no project")
check("a bound session's worklog naming no project lands in the bound project", r.status_code == 200
      and where("log naming no project") == "ai-sdlc", (r.status_code, r.text[:200]))
log(TU, "no session log", project="kh-tools")
check("without the session id the body decides", where("no session log") == "kh-tools")
log(S2, "unbound session log", project="designer")
check("an unbound session's log follows the body", where("unbound session log") == "designer")
r = log(S1, "knowledge row", project="designer", scope="knowledge")
check("a non-log write is untouched", r.status_code == 200 and where("knowledge row", "knowledge") == "designer",
      (r.status_code, where("knowledge row", "knowledge")))
NARROW = as_session(token(TU_E, {"kh-tools": LOG}), "sess-a")      # the same session, ai-sdlc access gone
log(NARROW, "after losing access", project="kh-tools")
check("a bound project the caller may no longer log to leaves the body in charge",
      where("after losing access") == "kh-tools")

# ── 3. switch ───────────────────────────────────────────────────────────────
r = client.get("/session/project", headers=S1)
check("GET names the binding", r.json().get("binding", {}).get("project") == "ai-sdlc", r.text)
r = client.put("/session/project", json={"project": "designer"}, headers=S1)
check("PUT switches when the person asks", r.status_code == 200 and r.json()["binding"]["project"] == "designer"
      and r.json()["previous"] == "ai-sdlc" and r.json()["binding"]["source"] == "asked", r.text)
log(S1, "after switch")
check("later worklogs follow the switch", where("after switch") == "designer")
check("an unknown project is 404", client.put("/session/project", json={"project": "nope-x"},
                                              headers=S1).status_code == 404)
check("a project without project.log is 403", client.put("/session/project", json={"project": "readme"},
                                                         headers=S1).status_code == 403)
check("no session id is 400", client.put("/session/project", json={"project": "designer"},
                                         headers=TU).status_code == 400)
check("another account does not see this binding",
      client.get("/session/project", headers=as_session(OTHER, "sess-a")).json()["binding"] is None)
r = client.delete("/session/project", headers=S2)
check("DELETE of an unbound session says so", r.status_code == 200 and r.json()["unbound"] is False, r.text)

# ── 4. keep ─────────────────────────────────────────────────────────────────
client.put("/session/project", json={"project": "kh-tools"}, headers=S2)
old = "2000-01-01T00:00:00Z"
with sqldb.connect() as c:
    c.execute(f"UPDATE {session_project.TABLE} SET last_seen=? WHERE actor='sess-b'", [old])
check("a binding idle past the TTL reads as absent", session_project.get(OWNER, "sess-b") is None)
session_project._touched.clear()
client.get("/session/project", headers=S2)
with sqldb.connect() as c:
    seen = c.execute(f"SELECT last_seen FROM {session_project.TABLE} WHERE actor='sess-b'").fetchone()[0]
check("a call does not revive an expired binding", seen == old, seen)
check("only maintainers sweep", client.post("/session/sweep", json={}, headers=TU).status_code == 403)
r = client.post("/session/sweep", json={}, headers=ADMIN)
check("the sweep deletes the idle binding and keeps the used one", r.status_code == 200 and r.json()["deleted"] == 1
      and session_project.get(OWNER, "sess-a") is not None, r.text)
check("max_idle_hours below 1 is refused",
      client.post("/session/sweep", json={"max_idle_hours": 0}, headers=ADMIN).status_code == 400)

print()
print(f"{len(FAILURES)} failure(s)" if FAILURES else "all passed")
sys.exit(1 if FAILURES else 0)
