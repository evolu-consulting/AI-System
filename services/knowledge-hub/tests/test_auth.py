"""Tests for sign-in and per-project access control (app/auth.py, app/auth_rules.json), 2026-09-25.

WHAT IS UNDER TEST
  1. THE GATE. No token -> 401; a token signed by anyone else, expired, or for another audience -> 401;
     a valid token for someone who is not a KH user -> 403; a permission missing on the project the
     request touches -> 403. What the caller writes in the body about itself never counts.
  2. THE TABLE. Every route KH serves has a rule, and a route missing from the table is refused to
     members, so a new route cannot leak by being forgotten.
  3. THE FAN-OUT. Reads that name no project only see the projects the caller may read, including the
     shared hot log window, and /log/recent shows a person only their own window.

Run from the repo root with the project venv:
    .venv\\Scripts\\python tests\\test_auth.py

Uses a locally generated RSA key and an in-process app; no network, no identity service.
"""
import os
import sys
import tempfile
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

# Every permission check now reads the project visibility table (app/project_access.py); keep it
# out of the real hooks.db.
_TMP = tempfile.mkdtemp(prefix="kh_auth_")
os.environ["KH_HOOKS_DB"] = os.path.join(_TMP, "hooks.db")
# Every store in the temp folder: /auth/me now makes the caller's personal project (2026-10-13).
os.environ["CHROMA_PATH"] = os.path.join(_TMP, "chroma")
os.environ["KH_PROJECTS_PATH"] = os.path.join(_TMP, "projects")
os.environ["KH_KUZU_PROJECTS_PATH"] = os.path.join(_TMP, "kuzu")

ISSUER = "https://keycloak.test/realms/knowledge-hub"
os.environ["KH_AUTH_ISSUER"] = ISSUER
os.environ["KH_AUTH_AUDIENCE"] = "kh-api"

import jwt  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import rsa  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import auth, hotlog  # noqa: E402

FAILURES = []


def check(name, condition, detail=None):
    print(("ok   " if condition else "FAIL ") + name + ("" if condition or detail is None else f"  -> {detail}"))
    if not condition:
        FAILURES.append(name)


KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
OTHER_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
auth._keys.get = lambda kid: KEY.public_key() if kid == "k1" else None


def token(kh=None, email="member@example.invalid", key=KEY, aud="kh-api", exp_in=300, kid="k1"):
    now = int(time.time())
    claims = {"iss": ISSUER, "aud": aud, "iat": now, "exp": now + exp_in, "email": email}
    if kh is not None:
        claims["kh"] = kh
    return jwt.encode(claims, key, algorithm="RS256", headers={"kid": kid})


MEMBER = {"role": "member", "permissions": ["project.create"], "all_projects": [],
          "projects": {"alpha": ["project.read", "project.write", "project.log"],
                       "beta": ["project.read"], "orchestrator": ["project.read"]}}
MAINTAINER = {"role": "maintainer", "permissions": ["project.create"],
              "all_projects": ["project.read", "project.write", "project.log", "project.members.manage",
                               "project.delete"], "projects": {}}

# ── 1. the gate, on a small app carrying the real rules ─────────────────────
app = FastAPI()
seen = {}


@app.post("/vector/add")
async def vector_add(body: dict):
    seen["body"] = body
    seen["principal"] = auth.current()
    return {"ok": True}


@app.post("/vector/query")
async def vector_query(body: dict):
    return {"ok": True}


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/graph/add")
async def graph_add(body: dict):
    return {"ok": True}


@app.post("/brand/new/route")
async def unlisted(body: dict):
    return {"ok": True}


app.add_middleware(auth.AuthMiddleware)
client = TestClient(app)


def h(tok):
    return {"Authorization": f"Bearer {tok}"}


check("health is public", client.get("/health").status_code == 200)
r = client.post("/vector/query", json={"text": "x", "project": "alpha"})
check("no token -> 401 with a pointer to the help page", r.status_code == 401 and r.json().get("help") == "/auth/help", r.text)
check("token signed by someone else -> 401",
      client.post("/vector/query", json={"project": "alpha"}, headers=h(token(MEMBER, key=OTHER_KEY))).status_code == 401)
check("unknown signing key -> 401",
      client.post("/vector/query", json={"project": "alpha"}, headers=h(token(MEMBER, kid="nope"))).status_code == 401)
check("expired token -> 401",
      client.post("/vector/query", json={"project": "alpha"}, headers=h(token(MEMBER, exp_in=-120))).status_code == 401)
check("token for another audience -> 401",
      client.post("/vector/query", json={"project": "alpha"}, headers=h(token(MEMBER, aud="other"))).status_code == 401)
check("valid token without a kh claim -> 403",
      client.post("/vector/query", json={"project": "alpha"}, headers=h(token(None))).status_code == 403)

check("member reads a granted project",
      client.post("/vector/query", json={"project": "beta"}, headers=h(token(MEMBER))).status_code == 200)
check("member cannot read an ungranted project (D6)",
      client.post("/vector/query", json={"project": "gamma"}, headers=h(token(MEMBER))).status_code == 403)
check("readonly member cannot write (D4b)",
      client.post("/vector/add", json={"text": "x", "scope": "knowledge", "metadata": {"project": "beta"}},
                  headers=h(token(MEMBER))).status_code == 403)
check("readonly member cannot log either (D5)",
      client.post("/vector/add", json={"text": "x", "scope": "log", "metadata": {"project": "beta"}},
                  headers=h(token(MEMBER))).status_code == 403)
r = client.post("/vector/add", json={"text": "hello", "scope": "log", "metadata": {"project": "alpha"}},
                headers=h(token(MEMBER)))
check("member with log permission logs, and the body reaches the route intact",
      r.status_code == 200 and seen.get("body", {}).get("text") == "hello", r.text)
check("the route sees who is calling", seen.get("principal") and seen["principal"].email == "member@example.invalid")
r = client.post("/vector/add", json={"text": "top", "scope": "log", "project": "alpha", "metadata": {}},
                headers=h(token(MEMBER)))
check("a top-level project is honoured like metadata.project (2026-10-12)", r.status_code == 200, r.text)
check("a top-level project still needs the grant",
      client.post("/vector/add", json={"text": "x", "scope": "log", "project": "beta"},
                  headers=h(token(MEMBER))).status_code == 403)
r = client.post("/vector/add", json={"text": "x", "scope": "log", "metadata": {}}, headers=h(token(MEMBER)))
check("a worklog naming no project is the writer's own (personal project, 2026-10-13)", r.status_code == 200, r.text)
check("a write with no project touches the orchestrator, which members cannot change",
      client.post("/vector/add", json={"text": "x", "scope": "knowledge", "metadata": {}},
                  headers=h(token(MEMBER))).status_code == 403)
r = client.request("DELETE", "/vector/delete", json={"ids": ["vec_x"], "project": "personal-member-example-invalid"},
                   headers=h(token(MEMBER)))
check("a member deletes rows of their own personal project, DELETE as well as POST (2026-10-15)",
      r.status_code != 403, r.text)
check("a member still cannot delete rows of an ungranted project",
      client.request("DELETE", "/vector/delete", json={"ids": ["vec_x"], "project": "gamma"},
                     headers=h(token(MEMBER))).status_code == 403)
check("claiming to be a maintainer in the body changes nothing (fen's example)",
      client.post("/vector/query", json={"project": "gamma", "role": "maintainer", "kh": MAINTAINER},
                  headers=h(token(MEMBER))).status_code == 403)
check("maintainer-only route refused to a member",
      client.post("/graph/add", json={}, headers=h(token(MEMBER))).status_code == 403)
check("a route missing from the table is refused to a member",
      client.post("/brand/new/route", json={}, headers=h(token(MEMBER))).status_code == 403)
check("maintainer reaches any project",
      client.post("/vector/query", json={"project": "gamma"}, headers=h(token(MAINTAINER))).status_code == 200)
check("maintainer reaches a route missing from the table",
      client.post("/brand/new/route", json={}, headers=h(token(MAINTAINER))).status_code == 200)

# ── 2. every real route has a rule ──────────────────────────────────────────
rules = auth.load_rules()
import main  # noqa: E402  (heavy import, but it is the only way to see every route KH serves)

missing = []
for route in main.app.routes:
    methods = getattr(route, "methods", None) or set()
    path = getattr(route, "path", "")
    if path.startswith(("/docs", "/openapi", "/redoc")):
        continue
    for method in methods - {"HEAD", "OPTIONS"}:
        if auth.match(rules, method, path.replace("{", "{").replace("}", "}"))[0] is None:
            # templated paths match their own template literally
            if not any(r.method == method and r.template == path for r in rules):
                missing.append(f"{method} {path}")
check("every KH route has a rule", not missing, missing)

# ── 3. fan-out and the per-person window ────────────────────────────────────
principal = auth.Principal.from_claims({"email": "member@example.invalid", "kh": MEMBER})
reset = auth._current.set(principal)
try:
    check("visible projects are exactly the granted ones plus their own personal project",
          auth.visible_projects() == {"alpha", "beta", "orchestrator", "personal-member-example-invalid"},
          auth.visible_projects())
    lane = hotlog.read_lane("log", None, None)
    check("the hot window lane is narrowed to readable projects when none is named",
          lane is not None and lane[1] == {"project": {"$in": ["alpha", "beta", "orchestrator",
                                                                "personal-member-example-invalid"]}}, lane and lane[1])
    check("a named project keeps its own narrowing",
          hotlog.read_lane("log", "alpha", None)[1] == {"project": {"$eq": "alpha"}})
    check("/log/recent reads only the caller's own rows",
          hotlog.personal_where(None) == {"author": {"$eq": "member@example.invalid"}})
    check("/log/recent with no project named is still the caller's own window",
          hotlog.recent_where(None, None) == {"author": {"$eq": "member@example.invalid"}})
    check("/log/recent with a project named shows every author's rows on it",
          hotlog.recent_where({"project": {"$eq": "alpha"}}, "alpha") == {"project": {"$eq": "alpha"}})
    check("filter_projects keeps order and drops the invisible",
          auth.filter_projects(["gamma", "beta", "alpha"]) == ["beta", "alpha"])
finally:
    auth._current.reset(reset)
check("with no caller (sign-in off) nothing is narrowed",
      auth.visible_projects() is None and hotlog.personal_where(None) is None)

# ── 4. the public help page and the helper download ─────────────────────────
import tempfile  # noqa: E402
from pathlib import Path  # noqa: E402

downloads = Path(tempfile.mkdtemp(prefix="kh_dl_"))
(downloads / "kh_helper-1.0.0-py3-none-any.whl").write_bytes(b"PK-fake-wheel")
(downloads / "secret.txt").write_text("not for download")
auth.DOWNLOADS_DIR = downloads
# The guide is a stored row; point it at a throwaway in-memory collection, never the real store.
import chromadb  # noqa: E402
import numpy as np  # noqa: E402

guide_coll = chromadb.EphemeralClient().get_or_create_collection("kh_test_guide_" + str(int(time.time())))
auth._guide_collection = lambda: guide_coll


class FakeModel:
    def encode(self, text, normalize_embeddings=True):
        return np.ones(8) / np.sqrt(8)


public = FastAPI()
public.state.model = FakeModel()
auth.install(public)
pc = TestClient(public)
check("with no stored guide the seed file is served", auth.guide_text() == auth.GUIDE_SEED.read_text(encoding="utf-8"))
check("start-up seeds the guide when it is missing", auth.seed_guide(FakeModel().encode) == "seeded")
check("a second start leaves it alone", auth.seed_guide(FakeModel().encode) == "present")
fwd = {"x-forwarded-proto": "https", "host": "kh.example.test"}
r = pc.get("/auth/help", headers=fwd)
check("help needs no sign-in", r.status_code == 200, r.status_code)
check("help carries the pip install link",
      "-m pip install https://kh.example.test/auth/download/kh_helper-1.0.0-py3-none-any.whl" in r.text, r.text[:400])
check("help names the KH url for login", "kh_helper.cli login --kh-url https://kh.example.test" in r.text)
check("help installs the helper inside the CLI profile", '-m venv "PROFILE/kh-helper"' in r.text)
check("help tells the assistant to install Python when it is missing", "winget install -e --id Python.Python.3.12" in r.text)
r = pc.get("/auth/download/kh_helper-1.0.0-py3-none-any.whl")
check("the helper wheel downloads without sign-in", r.status_code == 200 and r.content == b"PK-fake-wheel", r.status_code)
check("nothing else in the folder is served", pc.get("/auth/download/secret.txt").status_code == 404)
check("no path tricks", pc.get("/auth/download/..%2Fauth.py").status_code in (401, 404))
r = pc.get("/auth/config", headers=fwd)
check("config points at the helper",
      (r.json().get("helper") or "").endswith("/auth/download/kh_helper-1.0.0-py3-none-any.whl"), r.json())
check("other routes on that app still need sign-in", pc.get("/auth/me").status_code == 401)

# ── 5. the guide is data: edited without a redeploy, never overwritten by the seed ──
new_text = "EDITED GUIDE for {kh_url}; install {source}; literal {braces} stay"
r = pc.put("/auth/help", json={"text": new_text})
check("editing the guide needs sign-in", r.status_code == 401, r.status_code)
r = pc.put("/auth/help", json={"text": new_text}, headers=h(token(MEMBER)))
check("a member may not edit the guide", r.status_code == 403, r.status_code)
r = pc.put("/auth/help", json={"text": new_text}, headers=h(token(MAINTAINER, email="boss@example.invalid")))
check("a maintainer edits the guide", r.status_code == 200 and r.json().get("chars") == len(new_text), r.text)
r = pc.get("/auth/help", headers=fwd)
check("the edited guide is served with its values filled",
      r.text == "EDITED GUIDE for https://kh.example.test; install "
                "https://kh.example.test/auth/download/kh_helper-1.0.0-py3-none-any.whl; literal {braces} stay", r.text)
check("start-up does not overwrite an edited guide",
      auth.seed_guide(FakeModel().encode) == "present" and auth.guide_text() == new_text)
r = pc.put("/auth/help", json={"text": "  "}, headers=h(token(MAINTAINER, email="boss@example.invalid")))
check("an empty guide is refused", r.status_code == 422, r.status_code)

# ── 6. project registry rows in orchestrator knowledge (found by the two-person e2e run) ──
reg = lambda pid: {"kind": auth.REGISTRY_KIND, "project_id": pid, "scope": "knowledge"}  # noqa: E731
token_ = auth._current.set(auth.Principal.from_claims({"email": "member@example.invalid", "kh": MEMBER}))
try:
    check("a member sees the registry row of a project they may read", auth.row_visible(reg("alpha")))
    check("a member does not see the registry row of another project", not auth.row_visible(reg("gamma")))
    check("the same holds when only the row id is known",
          auth.row_visible(None, "project_registry__alpha") and not auth.row_visible(None, "project_registry__gamma"))
    check("ordinary rows are untouched", auth.row_visible({"kind": "note", "project_id": "gamma"}, "vec_1"))
finally:
    auth._current.reset(token_)
token_ = auth._current.set(auth.Principal.from_claims({"email": "boss@example.invalid", "kh": MAINTAINER}))
try:
    check("a maintainer sees every registry row", auth.row_visible(reg("gamma")))
finally:
    auth._current.reset(token_)
check("with sign-in off every row is visible", auth.row_visible(reg("gamma")))

print(f"\n{'ALL PASS' if not FAILURES else 'FAILED'}  ({len(FAILURES)} failed)")
sys.exit(1 if FAILURES else 0)
