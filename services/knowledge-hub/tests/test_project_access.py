"""Tests for project visibility (app/project_access.py, app/auth.py), reworked 2026-10-13.

WHAT IS UNDER TEST
  1. KH CHECKS THE TOKEN ALONE. A semi-public or public project is an ordinary project: the identity
     service puts the levels it opens (roles semi.read / public.read / public.write) into the token, so a
     person whose token lacks them - an excluded tenant - gets nothing, whatever the project's visibility.
  2. CHANGING IT goes to Keycloak first (PUT /kh/projects/{id}/visibility, which decides who may: whoever
     manages the project's people); KH keeps a copy for display only after Keycloak accepts.
  3. Personal projects and the orchestrator stay private; a deleted project's copy is forgotten.

Run from the repo root with the project venv:
    .venv\\Scripts\\python tests\\test_project_access.py

Uses a locally generated RSA key, a temporary hooks.db, an in-process app and a fake identity service.
"""
import os
import sys
import tempfile
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

TMP = tempfile.mkdtemp(prefix="kh_access_")
ISSUER = "https://keycloak.test/realms/knowledge-hub"
os.environ["KH_HOOKS_DB"] = os.path.join(TMP, "hooks.db")
os.environ["KH_AUTH_ISSUER"] = ISSUER
os.environ["KH_AUTH_AUDIENCE"] = "kh-api"
os.environ["KH_PROJECT_ACCESS_CACHE_S"] = "0"

import jwt  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import rsa  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import auth, project_access, projects  # noqa: E402

FAILURES = []


def check(name, condition, detail=None):
    print(("ok   " if condition else "FAIL ") + name + ("" if condition or detail is None else f"  -> {detail}"))
    if not condition:
        FAILURES.append(name)


KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
auth._keys.get = lambda kid: KEY.public_key() if kid == "k1" else None


def token(kh, email):
    now = int(time.time())
    claims = {"iss": ISSUER, "aud": "kh-api", "iat": now, "exp": now + 300, "email": email, "kh": kh}
    return jwt.encode(claims, KEY, algorithm="RS256", headers={"kid": "k1"})


OWNER_LEVEL = ["project.read", "project.write", "project.log", "project.members.manage", "project.delete"]
EDITABLE_LEVEL = ["project.read", "project.write", "project.log"]
OWNER = {"role": "member", "permissions": ["project.create"], "all_projects": [],
         "projects": {p: OWNER_LEVEL for p in ("closed", "shared", "open")}}
EDITOR = {"role": "member", "permissions": ["project.create"], "all_projects": [],
          "projects": {p: EDITABLE_LEVEL for p in ("closed", "shared", "open")}}
STRANGER = {"role": "member", "permissions": ["project.create"], "all_projects": [], "projects": {}}
MAINTAINER = {"role": "maintainer", "permissions": ["project.create"], "all_projects": OWNER_LEVEL, "projects": {}}
WHO = {"owner": (OWNER, "owner@example.invalid"), "editor": (EDITOR, "editor@example.invalid"),
       "stranger": (STRANGER, "stranger@example.invalid"), "maintainer": (MAINTAINER, "admin@example.invalid")}


def h(who):
    kh, email = WHO[who]
    return {"Authorization": f"Bearer {token(kh, email)}"}


# Three projects exist; the routes below only need to know that.
EXISTING = {"closed", "shared", "open", "orchestrator"}
projects.get_project = lambda pid: {"id": pid, "role": "project"} if pid in EXISTING else None

# The identity service: it records the visibility and refuses whoever does not manage the project's people.
RELAYED = []


def fake_relay(method, path, payload=None):
    caller = auth.current()
    project = path.split("/")[2]
    if not caller.can(project, "project.members.manage"):
        raise auth.RegistryRefused(403, "identity service refused: missing permission project.members.manage")
    RELAYED.append((method, path, payload))


auth._relay = fake_relay

app = FastAPI()


@app.post("/vector/query")
async def vector_query(body: dict):
    return {"ok": True}


@app.post("/vector/add")
async def vector_add(body: dict):
    return {"ok": True}


projects.attach(app)
app.add_middleware(auth.AuthMiddleware)
client = TestClient(app)


def read(who, project):
    return client.post("/vector/query", json={"text": "x", "project": project}, headers=h(who)).status_code


def write(who, project, scope="knowledge"):
    return client.post("/vector/add", json={"text": "x", "scope": scope, "metadata": {"project": project}},
                       headers=h(who)).status_code


def set_vis(who, project, visibility):
    return client.put(f"/projects/{project}/visibility", json={"visibility": visibility}, headers=h(who))


# ── 2. changing it ──────────────────────────────────────────────────────────
check("a project with no row is private", project_access.visibility_of("closed") == "private")
r = set_vis("editor", "shared", "semi-public")
check("an editor is refused by the identity service", r.status_code == 403 and "identity service" in r.text, r.text)
check("a refused change leaves KH's copy alone", project_access.visibility_of("shared") == "private")
check("a stranger is refused", set_vis("stranger", "shared", "semi-public").status_code == 403)
r = set_vis("owner", "shared", "semi-public")
check("the owner makes a project semi-public", r.status_code == 200 and r.json()["visibility"] == "semi-public", r.text)
check("it went to the identity service first",
      RELAYED[-1] == ("PUT", "/projects/shared/visibility", {"visibility": "semi-public"}), RELAYED)
check("the answer says the new levels need a fresh token", r.json().get("token_refresh_needed") is True, r.text)
check("KH keeps a copy for display", project_access.visibility_of("shared") == "semi-public")
check("a maintainer makes a project public", set_vis("maintainer", "open", "public").status_code == 200)
n = len(RELAYED)
check("an unknown visibility is refused", set_vis("owner", "closed", "everyone").status_code == 400)
check("an unknown project is 404", set_vis("owner", "nope", "public").status_code == 404)
check("the orchestrator stays private", set_vis("maintainer", "orchestrator", "public").status_code == 400)
check("a refused value never reaches the identity service", len(RELAYED) == n)

# ── 1. the token alone decides ──────────────────────────────────────────────
check("semi-public, token without semi.read (excluded tenant): no read", read("stranger", "shared") == 403)
check("public, token without public.read: no read", read("stranger", "open") == 403)
check("public, token without public.write: no write", write("stranger", "open") == 403)
# The same person once the identity service has put the shared levels into the token.
READONLY = ["project.read"]
WHO["reader"] = ({**STRANGER, "projects": {"shared": READONLY, "open": EDITABLE_LEVEL}}, "reader@example.invalid")
check("semi-public with semi.read in the token: reads", read("reader", "shared") == 200)
check("semi-public with semi.read: cannot write", write("reader", "shared") == 403)
check("semi-public with semi.read: cannot log", write("reader", "shared", scope="log") == 403)
check("semi-public: an editable grant writes like on any project", write("editor", "shared") == 200)
check("public with public.write: writes and logs", write("reader", "open") == 200 and write("reader", "open", "log") == 200)
check("public.write does not let a reader change visibility", set_vis("reader", "open", "private").status_code == 403)
reader = auth.Principal.from_claims({"email": "reader@example.invalid", "kh": WHO["reader"][0]})
stranger = auth.Principal.from_claims({"email": "stranger@example.invalid", "kh": STRANGER})
check("what a caller finds follows the token",
      reader.visible_projects() == {"shared", "open", "personal-reader-example-invalid"}, reader.visible_projects())
check("an excluded caller finds only their own project",
      stranger.visible_projects() == {"personal-stranger-example-invalid"}, stranger.visible_projects())

# ── GET /projects shows the visibility ──────────────────────────────────────
projects.list_projects = lambda: {pid: {"id": pid, "role": "project"} for pid in ("closed", "shared", "open")}
listed = client.get("/projects", headers=h("reader")).json().get("projects", {})
check("GET /projects lists what the token opens, with each visibility",
      {pid: e.get("visibility") for pid, e in listed.items()} == {"shared": "semi-public", "open": "public"}, listed)

# ── creating a project sends its visibility with the registration, in one step ──
real_current = auth.current
auth.current = lambda: owner_principal
owner_principal = auth.Principal.from_claims({"email": "owner@example.invalid", "kh": OWNER})
SENT = []
auth._relay = lambda method, path, payload=None: SENT.append((method, path, payload))
auth.register_project("brand-new", "public")
auth.register_project("plain")
auth.current = real_current
check("a new project is registered with its visibility",
      SENT == [("POST", "/projects", {"id": "brand-new", "visibility": "public"}),
               ("POST", "/projects", {"id": "plain", "visibility": "private"})], SENT)
auth._relay = fake_relay

# ── 3. back to private, and forgetting ──────────────────────────────────────
check("the owner takes it back to private", set_vis("owner", "shared", "private").status_code == 200)
check("KH's copy follows", project_access.visibility_of("shared") == "private")
project_access.forget("open")
check("a deleted project's visibility is forgotten", project_access.visibility_of("open") == "private")
try:
    project_access.set_visibility("personal-stranger-example-invalid", "public")
    check("a personal project stays private", False)
except ValueError:
    check("a personal project stays private", True)

print()
print("FAILED: " + ", ".join(FAILURES) if FAILURES else "all passed")
sys.exit(1 if FAILURES else 0)
