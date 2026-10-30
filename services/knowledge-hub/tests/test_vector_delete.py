"""Tests for POST /vector/delete and the project registry in the database (2026-09-22).

WHAT IS UNDER TEST

  1. DELETE BY ID. Until today /vector/* could only add: the finding
     `kh-no-vector-delete-or-update` (2026-08-27) recorded that a stored row could never
     be removed, only superseded by a second row saying the first was wrong - and both
     then load forever. These pin the door that was missing, and the three things it
     must never get wrong: it deletes the id it was given and nothing beside it, it
     finds a row whose collection the caller cannot name, and `dry_run` looks without
     touching.

  2. THE ORPHAN CASE, which is why the sweep exists. Passing `scope` only inside
     `metadata` on /vector/add writes the row to the DEFAULT scope's collection while
     its metadata claims another, so every scoped read misses it and nothing can name
     where it went. That is how four worklogs were lost on 2026-09-22. A scoped delete
     cannot reach such a row; the unscoped sweep can.

  3. THE REGISTRY IS A TABLE. Projects used to live in projects_manifest.json, rewritten
     whole on every change. They now live in hooks.db, one row each, and the legacy file
     is imported ONCE and then retired rather than deleted.

Run from the repo root with the project venv:
    .venv\\Scripts\\python tests\\test_vector_delete.py

Runs against a THROWAWAY chroma dir + hooks.db, so it never touches the live install,
and stubs the embedder - nothing here is about similarity.
"""
import json
import os
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

TMP = tempfile.mkdtemp(prefix="kh_delete_")
os.environ["KH_HOOKS_DB"] = os.path.join(TMP, "hooks.db")
os.environ["CHROMA_PATH"] = os.path.join(TMP, "chroma")
os.environ["KH_PROJECTS_PATH"] = os.path.join(TMP, "projects")
os.environ["KH_KUZU_PROJECTS_PATH"] = os.path.join(TMP, "kuzu")

from fastapi.testclient import TestClient        # noqa: E402

from app import config                           # noqa: E402

assert TMP in config.CHROMA_PATH, "test must run against a throwaway chroma dir"

import main                                      # noqa: E402
from app import projects as kh_projects          # noqa: E402
from app import projects_store                   # noqa: E402

FAILED = []
CHECKS = 0


def check(name, cond, detail=""):
    global CHECKS
    CHECKS += 1
    print("%-4s %s%s" % ("ok" if cond else "FAIL", name,
                         ("  <- " + str(detail)) if detail and not cond else ""))
    if not cond:
        FAILED.append(name)


class _Model:
    """Stand-in embedder: writes need a vector, none of these assertions read it."""
    @staticmethod
    def encode(text, normalize_embeddings=True):
        import numpy
        return numpy.zeros(384, dtype="float32")


main.app.state.model = _Model()
client = TestClient(main.app)

# The lifespan never runs here (no model download, no graph bootstrap), so the one
# startup step these assertions depend on is done by hand: the manage-role orchestrator
# project. Without it the registry is legitimately empty, and an empty registry is what
# the legacy-file import is allowed to overwrite - which would make the guard below look
# broken when it is the harness that is incomplete.
kh_projects.ensure_orchestrator()


def add(text, scope=None, metadata=None):
    body = {"text": text}
    if scope is not None:
        body["scope"] = scope
    if metadata is not None:
        body["metadata"] = metadata
    return client.post("/vector/add", json=body).json()["vector_id"]


def delete(ids, **kw):
    return client.post("/vector/delete", json={"ids": ids, **kw}).json()


def scroll(**kw):
    return client.post("/vector/scroll", json={"limit": 500, **kw}).json()


# ---------------------------------------------------------------- delete by id

kept = add("KEEP THIS ROW", scope="knowledge",
           metadata={"project": "alpha", "topic": "t"})
doomed = add("DELETE THIS ROW", scope="knowledge",
             metadata={"project": "alpha", "topic": "t"})

before = scroll(scope="knowledge", project="alpha")["matched"]
check("both rows are there to start with", before == 2, before)

seen = delete([doomed], scope="knowledge", project="alpha", dry_run=True)
check("dry_run reports where the row lives",
      seen["found"].get(doomed, "").endswith("alpha"), seen)
check("dry_run deletes nothing", seen["deleted"] == [] and seen["dry_run"] is True, seen)
check("dry_run left the row in place",
      scroll(scope="knowledge", project="alpha")["matched"] == 2)

gone = delete([doomed], scope="knowledge", project="alpha")
check("the row is deleted", gone["deleted"] == [doomed], gone)
check("only that row went", scroll(scope="knowledge", project="alpha")["matched"] == 1)
rows = [h["vector_id"] for h in scroll(scope="knowledge", project="alpha")["hits"]]
check("the neighbour survived", rows == [kept], rows)

again = delete([doomed], scope="knowledge", project="alpha")
check("deleting it twice is not an error", again["deleted"] == [], again)
check("an absent id comes back as not_found", again["not_found"] == [doomed], again)

check("an unknown id is reported, never invented",
      delete(["vec_doesnotexist"])["not_found"] == ["vec_doesnotexist"])

# ------------------------------------------------- the orphan the sweep is for
# scope ONLY in metadata: the row goes to the DEFAULT scope's collection while its
# metadata says 'log'. This is the shape that lost four worklogs on 2026-09-22.

orphan = add("ORPHANED WORKLOG, scope only in metadata",
             metadata={"scope": "log", "project": "alpha", "topic": "a", "ts": "2026-09-22T00:00:00Z"})

check("a scoped read cannot see the orphan",
      all(h["vector_id"] != orphan for h in scroll(scope="log", project="alpha")["hits"]))
check("a scoped delete cannot reach it either",
      delete([orphan], scope="log", project="alpha")["not_found"] == [orphan])

swept = delete([orphan], dry_run=True)
check("the sweep finds it without being told the collection",
      orphan in swept["found"], swept)
check("the sweep searched more than one collection", swept["searched"] > 1, swept["searched"])
check("the sweep deletes it", delete([orphan])["deleted"] == [orphan])
check("and then it is gone", delete([orphan])["not_found"] == [orphan])

# ------------------------------------------------------ the registry is a table

reg = client.get("/projects").json()
check("the registry reports the database it lives in",
      reg["store"]["db"].endswith("hooks.db") and reg["store"]["table"] == "projects", reg.get("store"))
check("the orchestrator is registered", "orchestrator" in reg["projects"])

kh_projects.get_or_create_project("beta", aliases=["Beta", "b"], keywords=["one"])
entry = kh_projects.get_project("beta")
check("a project round-trips through the table",
      entry["aliases"] == ["Beta", "b"] and entry["keywords"] == ["one"], entry)
check("its paths came back as a dict",
      entry["paths"]["knowledge"] == "kh_know_beta", entry.get("paths"))

kh_projects.get_or_create_project("beta", aliases=["another"])
entry2 = kh_projects.get_project("beta")
check("re-creating merges aliases and keeps created_at",
      entry2["aliases"] == ["Beta", "b", "another"]
      and entry2["created_at"] == entry["created_at"], entry2)

check("rows survive a fresh read of the table",
      "beta" in projects_store.load_all())

# Whole-set save: a project popped from the dict must leave the table, or a deleted
# project stays routed to while its data is gone.
man = kh_projects._load()
man["projects"].pop("beta")
kh_projects._save(man)
check("saving without a project removes its row",
      "beta" not in projects_store.load_all())
check("the other projects are untouched",
      "orchestrator" in projects_store.load_all())

# -------------------------------------------------- the legacy file is imported

legacy = projects_store.legacy_manifest_path()
os.makedirs(os.path.dirname(legacy), exist_ok=True)
with open(legacy, "w", encoding="utf-8") as f:
    json.dump({"version": 2, "projects": {
        "gamma": {"id": "gamma", "role": "project", "aliases": ["G"], "keywords": [],
                  "tools": [], "descriptor": "d", "conflicts_with": [],
                  "paths": {"knowledge": "kh_know_gamma"},
                  "created_at": "2026-01-01T00:00:00Z", "updated_at": "2026-01-01T00:00:00Z"}}}, f)

check("a non-empty table is NOT overwritten by the legacy file",
      projects_store.migrate_from_file() == 0 and "gamma" not in projects_store.load_all())
check("and the file is left where it is", os.path.exists(legacy))

# Now empty the table, which is what a first run after the upgrade looks like.
projects_store.save_all({})
imported = projects_store.migrate_from_file()
check("an empty table imports the legacy file", imported == 1, imported)
check("the imported project kept its fields",
      projects_store.load_all()["gamma"]["aliases"] == ["G"]
      and projects_store.load_all()["gamma"]["created_at"] == "2026-01-01T00:00:00Z")
check("the file is retired, not deleted", not os.path.exists(legacy))
retired = [n for n in os.listdir(os.path.dirname(legacy)) if ".migrated-" in n]
check("it is renamed beside itself so the import is reversible", len(retired) == 1, retired)
check("importing again does nothing", projects_store.migrate_from_file() == 0)

print("\n%d checks, %d failed" % (CHECKS, len(FAILED)))
if FAILED:
    print("FAILED:", FAILED)
    sys.exit(1)
