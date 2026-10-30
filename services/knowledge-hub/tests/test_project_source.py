"""Tests for the optional `source` of a project, 2026-10-22.

WHAT IS UNDER TEST
  A project names the system that made it, so a client lists only its own projects (the DLC engine sends
  "AI-SDLC" and asks GET /projects?source=AI-SDLC; projects synced or made by people stay "KH").
  1. POST /projects without the key, with "" / "   " / null: source "KH".
  2. With "AI-SDLC": stored and returned; GET /projects?source=AI-SDLC lists only those.
  3. A later call without source keeps it; one with another source changes it.
  4. A non-string source is a 400.
  5. A registry made before the column: the column is added and old rows read "KH".

Run from the repo root with the project venv:
    .venv\\Scripts\\python tests\\test_project_source.py

Runs against a THROWAWAY chroma dir + hooks.db with sign-in off (as the DLC stack runs KH) and a stubbed embedder.
"""
import os
import sqlite3
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

TMP = tempfile.mkdtemp(prefix="kh_source_")
os.environ["KH_HOOKS_DB"] = os.path.join(TMP, "hooks.db")
os.environ["CHROMA_PATH"] = os.path.join(TMP, "chroma")
os.environ["KH_PROJECTS_PATH"] = os.path.join(TMP, "projects")
os.environ["KH_KUZU_PROJECTS_PATH"] = os.path.join(TMP, "kuzu")
os.environ.pop("KH_AUTH_ISSUER", None)

# 5. a registry from before the column: one old row, no `source`
with sqlite3.connect(os.environ["KH_HOOKS_DB"]) as c:
    c.execute("""CREATE TABLE projects (id TEXT PRIMARY KEY, role TEXT NOT NULL DEFAULT 'project',
                 aliases TEXT NOT NULL DEFAULT '[]', keywords TEXT NOT NULL DEFAULT '[]',
                 tools TEXT NOT NULL DEFAULT '[]', descriptor TEXT NOT NULL DEFAULT '',
                 conflicts_with TEXT NOT NULL DEFAULT '[]', paths TEXT NOT NULL DEFAULT '{}',
                 created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '')""")
    c.execute("INSERT INTO projects (id, descriptor) VALUES ('old-one', 'made before source existed')")

import numpy  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import auth, config  # noqa: E402

assert TMP in config.CHROMA_PATH, "test must run against a throwaway chroma dir"
auth.register_project = lambda pid, *rest: None
auth.unregister_project = lambda pid: None

import main  # noqa: E402

FAILURES = []


def check(name, condition, detail=None):
    print(("ok   " if condition else "FAIL ") + name + ("" if condition or detail is None else f"  -> {detail}"))
    if not condition:
        FAILURES.append(name)


class _Model:
    @staticmethod
    def encode(text, normalize_embeddings=True):
        v = numpy.zeros(384, dtype="float32")
        v[0] = 1.0
        return v


main.app.state.model = _Model()
client = TestClient(main.app)


def create(body):
    return client.post("/projects", json=body)


def source_of(pid):
    return client.get("/projects/" + pid).json().get("source")


# ── 1. no source, blank, null ───────────────────────────────────────────────
for pid, body in (("no-key", {}), ("empty", {"source": ""}), ("blank", {"source": "   "}), ("null", {"source": None})):
    r = create({"id": pid, **body})
    check(f"create {pid}: accepted", r.status_code in (200, 201), r.text)
    check(f"create {pid}: source KH in the answer", r.json().get("source") == "KH", r.json())
    check(f"create {pid}: source KH when read back", source_of(pid) == "KH", source_of(pid))

# ── 2. AI-SDLC ──────────────────────────────────────────────────────────────
r = create({"id": "dlc-shop", "source": "AI-SDLC", "descriptor": "made by DLC"})
check("create with source AI-SDLC: accepted", r.status_code in (200, 201), r.text)
check("its answer carries the source", r.json().get("source") == "AI-SDLC", r.json())
check("read back: AI-SDLC", source_of("dlc-shop") == "AI-SDLC", source_of("dlc-shop"))
listed = client.get("/projects", params={"source": "AI-SDLC"}).json()["projects"]
check("GET /projects?source=AI-SDLC lists only DLC's projects", set(listed) == {"dlc-shop"}, sorted(listed))
everything = client.get("/projects").json()["projects"]
check("GET /projects without the filter still lists all", {"no-key", "dlc-shop", "old-one"} <= set(everything),
      sorted(everything))
check("every listed project has a source", all(e.get("source") for e in everything.values()),
      {k: v.get("source") for k, v in everything.items()})

# ── 3. later calls ──────────────────────────────────────────────────────────
create({"id": "dlc-shop", "aliases": ["shop"]})
check("a later call without source keeps AI-SDLC", source_of("dlc-shop") == "AI-SDLC", source_of("dlc-shop"))
create({"id": "dlc-shop", "source": " "})
check("a later blank source keeps AI-SDLC", source_of("dlc-shop") == "AI-SDLC", source_of("dlc-shop"))
create({"id": "no-key", "source": "AI-SDLC"})
check("a later call naming a source changes it", source_of("no-key") == "AI-SDLC", source_of("no-key"))

# ── 4. bad type ─────────────────────────────────────────────────────────────
r = create({"id": "bad", "source": 5})
check("a non-string source is a 400", r.status_code == 400, r.text)
check("and creates nothing", client.get("/projects/bad").status_code == 404)

# ── 5. old rows ─────────────────────────────────────────────────────────────
check("a row from before the column reads KH", source_of("old-one") == "KH", source_of("old-one"))

print()
print("FAILED: " + ", ".join(FAILURES) if FAILURES else "all passed")
sys.exit(1 if FAILURES else 0)
