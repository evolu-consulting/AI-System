"""Tests for personal projects (app/personal.py) and /log/recent naming a project, 2026-09-30.

WHAT IS UNDER TEST
  1. OWN PROJECT. A signed-in person storing scope=personalization with no project lands in their own
     personal-<e-mail slug> project, created on that first write, readable back by them alone -
     through /vector/scroll and /personalization/render - and not by another member.
  2. NO SQUATTING. POST /projects refuses an id in the personal namespace; a member cannot write into
     someone else's personal project; a maintainer can (a migration).
  3. /log/recent NAMING A PROJECT shows every author's worklogs on it to anyone who may read it, each
     marked with its author; without a project it stays the caller's own.

Run from the repo root with the project venv:
    .venv\\Scripts\\python tests\\test_personal.py

Runs against a THROWAWAY chroma dir + hooks.db, a locally generated RSA key and a stubbed embedder.
"""
import os
import sys
import tempfile
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

TMP = tempfile.mkdtemp(prefix="kh_personal_")
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

from app import auth, config, personal, projects  # noqa: E402

assert TMP in config.CHROMA_PATH, "test must run against a throwaway chroma dir"

import main  # noqa: E402

FAILURES = []


def check(name, condition, detail=None):
    print(("ok   " if condition else "FAIL ") + name + ("" if condition or detail is None else f"  -> {detail}"))
    if not condition:
        FAILURES.append(name)


class _Model:
    """Stand-in embedder: every row gets the same vector, so a query returns every row it may see."""
    @staticmethod
    def encode(text, normalize_embeddings=True):
        v = numpy.zeros(384, dtype="float32")
        v[0] = 1.0
        return v


KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
auth._keys.get = lambda kid: KEY.public_key() if kid == "k1" else None
auth.register_project = lambda pid, *rest: None          # no identity service here
auth.unregister_project = lambda pid: None


def token(email, projects_=None, admin=False):
    now = int(time.time())
    perms = ["project.read", "project.write", "project.log"]
    kh = {"role": "maintainer" if admin else "member", "permissions": ["project.create"],
          "all_projects": perms if admin else [],
          "projects": {p: list(v) for p, v in (projects_ or {}).items()}}
    claims = {"iss": ISSUER, "aud": "kh-api", "iat": now, "exp": now + 300, "email": email, "kh": kh}
    return {"Authorization": "Bearer " + jwt.encode(claims, KEY, algorithm="RS256", headers={"kid": "k1"})}


ANA_EMAIL, BEN_EMAIL = "ana.le@example.invalid", "ben@example.invalid"
ANA = token(ANA_EMAIL, {"alpha": ["project.read", "project.write", "project.log"]})
BEN = token(BEN_EMAIL, {"alpha": ["project.read"]})
ADMIN = token("root@example.invalid", admin=True)
ANA_PID = personal.personal_id(ANA_EMAIL)

main.app.state.model = _Model()
client = TestClient(main.app)


def pref(text, headers, project=None):
    meta = {"kind": "preference"}
    if project:
        meta["project"] = project
    return client.post("/vector/add", json={"text": text, "scope": "personalization", "metadata": meta}, headers=headers)


def scroll_pref(headers, project=None):
    body = {"scope": "personalization", "limit": 500}
    if project:
        body["project"] = project
    return client.post("/vector/scroll", json=body, headers=headers)


# ── 1. own project ──────────────────────────────────────────────────────────
check("the personal id is derived from the e-mail", ANA_PID == "personal-ana-le-example-invalid", ANA_PID)
r = pref("RULE: Ana wants short answers", ANA)
check("a member stores personalization naming no project", r.status_code == 200, r.text)
check("the first write creates the personal project", projects.get_project(ANA_PID) is not None)
r = scroll_pref(ANA)
texts = [h["source_text"] for h in r.json().get("hits", [])]
check("the owner reads it back", r.status_code == 200 and texts == ["RULE: Ana wants short answers"], (r.status_code, texts))
check("the row is tagged with the personal project",
      r.json()["hits"][0]["metadata"].get("project") == ANA_PID, r.json()["hits"][0]["metadata"])
r = client.get("/personalization/render", headers=ANA)
check("the SessionStart render shows the owner's own rule", r.status_code == 200 and "Ana wants short answers" in r.text, r.text[:300])
r = client.get("/personalization/render", headers=BEN)
check("another member's render does not show it", r.status_code == 200 and "Ana wants" not in r.text, r.text[:300])
CAL = token("cal@example.invalid")
for n in range(45):
    pref(f"RULE {n:02d}: Cal preference number {n}", CAL)
r = client.get("/personalization/render", headers=CAL)
check("the render loads every own row, not a top 40",
      r.status_code == 200 and all(f"RULE {n:02d}:" in r.text for n in range(45)), r.text[-300:])
check("the render says the personal layer wins", "PERSONAL LAYER" in r.text, r.text[:400])
r = scroll_pref(BEN)
check("another member's scroll does not show it",
      r.status_code == 200 and not any("Ana wants" in h["source_text"] for h in r.json().get("hits", [])), r.text[:300])
r = scroll_pref(BEN, ANA_PID)
check("another member naming the personal project is refused", r.status_code == 403, r.status_code)
r = client.get("/projects", headers=ANA)
check("the owner sees their personal project in the list", ANA_PID in r.json().get("projects", {}), list(r.json().get("projects", {})))
r = client.get("/projects", headers=BEN)
check("another member does not", ANA_PID not in r.json().get("projects", {}), list(r.json().get("projects", {})))

# ── 2. no squatting ─────────────────────────────────────────────────────────
r = client.post("/projects", json={"id": personal.personal_id(BEN_EMAIL)}, headers=ANA)
check("POST /projects refuses the personal namespace", r.status_code == 403, r.status_code)
r = pref("RULE: planted by Ben", BEN, ANA_PID)
check("a member cannot write into someone else's personal project", r.status_code == 403, r.status_code)
r = pref("RULE: migrated by admin", ADMIN, ANA_PID)
check("a maintainer can (a migration)", r.status_code == 200, r.text)
r = scroll_pref(ANA)
check("the owner sees the migrated row too", len(r.json().get("hits", [])) == 2, [h["source_text"] for h in r.json().get("hits", [])])
r = scroll_pref(ADMIN, ANA_PID)
check("the maintainer reads it naming the project", r.status_code == 200 and len(r.json().get("hits", [])) == 2, r.text[:300])

# ── 2b. deleting a personal project ─────────────────────────────────────────
auth.unregister_project = lambda pid: (_ for _ in ()).throw(auth.RegistryRefused(403, "not registered"))
r = client.delete(f"/projects/{ANA_PID}", params={"confirm": "true"}, headers=BEN)
check("another member cannot delete someone's personal project", r.status_code == 403, r.status_code)
r = client.delete(f"/projects/{ANA_PID}", params={"confirm": "true"}, headers=ANA)
check("the owner deletes their personal project without asking the identity service", r.status_code == 200, r.text[:200])
check("it is gone", projects.get_project(ANA_PID) is None)
auth.unregister_project = lambda pid: None

# ── 3. /log/recent naming a project ─────────────────────────────────────────
now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
r = client.post("/vector/add", headers=ANA, json={"text": "WORK LOG alpha by Ana", "scope": "log",
                "metadata": {"scope": "log", "project": "alpha", "topic": "alpha", "subject": "alpha", "ts": now}})
check("Ana logs on alpha", r.status_code == 200, r.text)
r = client.get("/log/recent", params={"project": "alpha", "limit": 50}, headers=BEN)
hits = r.json().get("hits", []) if r.status_code == 200 else []
check("a reader naming the project sees Ana's worklog, marked as Ana's",
      any(h["source_text"] == "WORK LOG alpha by Ana" and h["metadata"].get("author") == ANA_EMAIL for h in hits),
      (r.status_code, hits[:1]))
r = client.get("/log/recent", params={"limit": 50}, headers=BEN)
check("without a project the list stays Ben's own",
      r.status_code == 200 and not any("by Ana" in h["source_text"] for h in r.json().get("hits", [])), r.text[:300])
r = client.get("/log/recent", params={"project": "alpha", "limit": 50}, headers=token("cat@example.invalid"))
check("someone who may not read the project is refused", r.status_code == 403, r.status_code)

# ── every person has a personal project from session start (2026-10-13) ────────
DEE = token("dee@example.invalid")
dee = personal.personal_id("dee@example.invalid")
r = client.get("/auth/me", headers=DEE)
check("kh_me names the personal project and creates it", r.status_code == 200 and r.json().get("personal_project") == dee
      and projects.get_project(dee) is not None, r.text[:200])
projects.delete_project(dee, confirm=True)
r = client.get("/auth/me", headers=DEE)
check("a deleted personal project is made again at the next session start", projects.get_project(dee) is not None, r.text[:200])

# ── own lessons: scope lesson of the personal project (2026-10-29) ─────────────
r = client.post("/vector/add", json={"text": "LESSON: sign in to Workbeats through get_session('workbeats')",
                                     "scope": config.PERSONAL_LESSON_SCOPE, "metadata": {"kind": "lesson"}}, headers=ANA)
check("a member stores a lesson naming no project", r.status_code == 200, r.text[:200])
r = client.post("/vector/scroll", json={"scope": config.PERSONAL_LESSON_SCOPE, "project": ANA_PID, "limit": 50},
                headers=ANA)
check("it lands in their personal project", r.status_code == 200 and len(r.json().get("hits", [])) == 1, r.text[:300])
r = client.post("/context/step", json={"text": "sign in to Workbeats", "project": "alpha"}, headers=ANA)
mine = [i for i in r.json().get("items", []) if i["tier"] == "personal-lesson"] if r.status_code == 200 else []
check("the owner's step packs their own lesson", len(mine) == 1 and mine[0]["project"] == ANA_PID, r.text[:300])
r = client.post("/context/step", json={"text": "sign in to Workbeats", "project": "alpha"}, headers=BEN)
check("another member's step does not",
      r.status_code == 200 and not any(i["tier"] == "personal-lesson" for i in r.json().get("items", [])), r.text[:300])
r = client.get("/turn/context", params={"text": "sign in to Workbeats"}, headers=ANA)
check("the turn context lists the owner's own lessons", r.status_code == 200 and "YOUR OWN LESSONS" in r.text, r.text[-400:])
r = client.get("/turn/context", params={"text": "sign in to Workbeats"}, headers=BEN)
check("and not another member's", r.status_code == 200 and "YOUR OWN LESSONS" not in r.text, r.text[-400:])

print(f"\n{'ALL PASS' if not FAILURES else 'FAILED'}  ({len(FAILURES)} failed)")
sys.exit(1 if FAILURES else 0)
