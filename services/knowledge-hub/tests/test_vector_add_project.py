"""Tests for the top-level `project` on POST /vector/add, 2026-10-12.

WHAT IS UNDER TEST
  Callers wrote {"project": ...} at the top of the body, as /vector/query and /vector/delete take it,
  and it was dropped silently: the write fell to the orchestrator and came back 403. Now:
  1. A top-level project alone is used, and the row lands in that project.
  2. A blank metadata.project does not win over it (auth skips blanks; storage must too).
  3. A top-level project that disagrees with metadata.project or metadata.source_id is a 422.
  4. With no project anywhere, the 403 names the orchestrator fallback and where to name a project.

Run from the repo root with the project venv:
    .venv\Scripts\python tests\test_vector_add_project.py

Runs against a THROWAWAY chroma dir + hooks.db, a locally generated RSA key and a stubbed embedder.
"""
import os
import sys
import tempfile
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

TMP = tempfile.mkdtemp(prefix="kh_vadd_")
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


r = client.post("/projects", json={"id": "alpha"}, headers=ADMIN)
check("setup: alpha exists", r.status_code in (200, 201, 409), r.text)


def add(body, headers=ANA):
    return client.post("/vector/add", json={"scope": "log", **body}, headers=headers)


def logs_of(project):
    r = client.post("/vector/scroll", json={"scope": "log", "project": project, "limit": 500}, headers=ADMIN)
    return {h["source_text"]: h["metadata"] for h in r.json().get("hits", [])}


# ── 1. top-level project alone ──────────────────────────────────────────────
r = add({"text": "log one", "project": "alpha"})
check("a top-level project alone is accepted", r.status_code == 200, r.text)
check("the row lands in that project, tagged with it", logs_of("alpha").get("log one", {}).get("project") == "alpha",
      logs_of("alpha"))

# ── 2. blank metadata.project ───────────────────────────────────────────────
r = add({"text": "log two", "project": "alpha", "metadata": {"project": ""}})
check("a blank metadata.project with a top-level project is accepted", r.status_code == 200, r.text)
check("the row lands in the top-level project, not the shared store",
      logs_of("alpha").get("log two", {}).get("project") == "alpha", logs_of("alpha"))
r = add({"text": "log three", "project": " alpha ", "metadata": {"project": "  "}})
check("whitespace in both is trimmed, and the row lands in alpha",
      r.status_code == 200 and logs_of("alpha").get("log three", {}).get("project") == "alpha", r.text)

# ── 3. disagreement ─────────────────────────────────────────────────────────
r = add({"text": "log four", "project": "alpha", "metadata": {"project": "beta"}}, ADMIN)
check("top-level and metadata.project disagreeing is a 422", r.status_code == 422 and "metadata.project" in r.text, r.text)
r = add({"text": "log five", "project": "alpha", "metadata": {"source_id": "beta"}}, ADMIN)
check("top-level and metadata.source_id disagreeing is a 422 naming source_id",
      r.status_code == 422 and "metadata.source_id" in r.text, r.text)
r = add({"text": "log six", "project": "alpha", "metadata": {"project": "alpha"}})
check("both naming the same project is fine", r.status_code == 200, r.text)
check("no refused row was stored", not {"log four", "log five"} & set(logs_of("alpha")), list(logs_of("alpha")))

# ── 4. no project anywhere: the writer's own personal project (2026-10-13) ─────
r = add({"text": "log seven", "metadata": {}})
check("a worklog naming no project lands in the writer's personal project",
      r.status_code == 200 and logs_of(ANA_PID).get("log seven", {}).get("project") == ANA_PID, (r.text, list(logs_of(ANA_PID))))
r = add({"text": "finding one", "scope": "findings", "metadata": {}})
check("so does a finding naming no project", r.status_code == 200, r.text)
r = add({"text": "log eight", "project": "orchestrator"}, ADMIN)
check("the orchestrator takes no worklog, not even a maintainer's (409 naming the personal project)",
      r.status_code == 409 and "personal-root-example-invalid" in r.text, r.text)
r = add({"text": "finding two", "scope": "findings", "metadata": {"project": "orchestrator"}}, ADMIN)
check("nor a finding", r.status_code == 409, r.text)
r = add({"text": "log nine", "metadata": {}}, ADMIN)
check("a maintainer's unnamed worklog goes to their own personal project too",
      r.status_code == 200 and "log nine" in logs_of("personal-root-example-invalid"), r.text)
r = add({"text": "common knowledge", "scope": "knowledge", "metadata": {}}, ANA)
check("unnamed knowledge still targets the orchestrator, which a member cannot change", r.status_code == 403, r.text)

print()
print("FAILED: " + ", ".join(FAILURES) if FAILURES else "all passed")
sys.exit(1 if FAILURES else 0)
