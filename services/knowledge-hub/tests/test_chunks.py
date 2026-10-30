"""Tests for chunk vectors (app/chunks.py), 2026-09-30.

WHAT IS UNDER TEST
  1. A long row's TAIL is searchable: a passage from its end brings the row back, whole, while
     the same row stored without chunks is missed (the embedder reads only 512 tokens).
  2. Chunks never show as rows: scroll counts, pages and the hot window are unchanged.
  3. Re-adding a row replaces its chunks; deleting it removes them.
  4. A spilled worklog is still found through its chunks.
  5. POST /vector/rechunk builds chunks for rows stored before (dry run counts only).

Run from the repo root with the project venv:
    .venv\\Scripts\\python tests\\test_chunks.py

Throwaway chroma dir, sign-in off, and the REAL embedder (models/bge-small-en-v1.5), because the
thing under test is what that embedder can and cannot see.
"""
import os
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

TMP = tempfile.mkdtemp(prefix="kh_chunks_")
os.environ["KH_HOOKS_DB"] = os.path.join(TMP, "hooks.db")
os.environ["CHROMA_PATH"] = os.path.join(TMP, "chroma")
os.environ["KH_PROJECTS_PATH"] = os.path.join(TMP, "projects")
os.environ["KH_KUZU_PROJECTS_PATH"] = os.path.join(TMP, "kuzu")
os.environ["KH_HOTLOG_MAX_PER_SLOT"] = "2"
os.environ.pop("KH_AUTH_ISSUER", None)

from fastapi.testclient import TestClient        # noqa: E402
from sentence_transformers import SentenceTransformer  # noqa: E402

from app import config, chunks                   # noqa: E402

assert TMP in config.CHROMA_PATH, "test must run against a throwaway chroma dir"

import main                                      # noqa: E402

FAILED = []


def check(name, cond, detail=""):
    print("%-4s %s%s" % ("ok" if cond else "FAIL", name, ("  <- " + str(detail)) if detail and not cond else ""))
    if not cond:
        FAILED.append(name)


main.app.state.model = SentenceTransformer(os.path.join(ROOT, "models", "bge-small-en-v1.5"), device="cpu")
client = TestClient(main.app)

FILLER = ("The deployment pipeline was reviewed step by step and the release checklist was updated with "
          "the new approval gates, rollback notes and the owners of each environment. ") * 18
TAIL = ("Finally the penguin mascot named Captain Waddles was chosen as the logo for the Antarctic "
        "research station newsletter by a vote of the whole team.")
LONG = FILLER + TAIL
OTHERS = [("vec_other_%d" % i, f"Row {i}: " + ("weekly status meeting notes about invoices and payroll. " * 30))
          for i in range(4)]


def add(vid, text, scope="knowledge", project="alpha", extra=None):
    meta = {"scope": scope, "project": project, **(extra or {})}
    r = client.post("/vector/add", json={"id": vid, "text": text, "scope": scope, "metadata": meta})
    assert r.status_code == 200, r.text


def query(text, scope="knowledge", project="alpha", k=3):
    return client.post("/vector/query", json={"text": text, "scope": scope, "project": project, "k": k}).json()["hits"]


check("the test row is well past the embedder's 512 tokens", len(LONG) > 2600, len(LONG))
for vid, text in OTHERS:
    add(vid, text)

# ── 1. the tail is searchable ───────────────────────────────────────────────
saved = config.CHUNK_MIN_CHARS
config.CHUNK_MIN_CHARS = 10 ** 9                  # store one row the old way: no chunks
add("vec_long_nochunk", LONG)
config.CHUNK_MIN_CHARS = saved
score_without = next((h["score"] for h in query(TAIL, k=10) if h["vector_id"] == "vec_long_nochunk"), 0.0)
client.post("/vector/delete", json={"ids": ["vec_long_nochunk"], "scope": "knowledge", "project": "alpha"})

add("vec_long", LONG)
coll = main.kh_chunks._sidecar("alpha", create=False)
n_chunks = len(main.get_vt({chunks.PARENT_KEY: {"$eq": "vec_long"}}, collection=coll)) if coll else 0
check("a long row gets chunk vectors", n_chunks >= 1, n_chunks)
hits = query(TAIL)
check("WITH chunks a passage from the tail finds the row first", hits and hits[0]["vector_id"] == "vec_long",
      [h["vector_id"] for h in hits])
check("and matches it far better than the row's own vector did", hits and hits[0]["score"] > score_without + 0.15,
      (hits[0]["score"] if hits else None, score_without))
check("the row comes back whole, not as a chunk", hits and hits[0]["source_text"] == LONG)
check("the row is listed once", [h["vector_id"] for h in hits].count("vec_long") == 1)
add("vec_short", "A short note that fits easily.")
check("a short row gets no chunks",
      not main.get_vt({chunks.PARENT_KEY: {"$eq": "vec_short"}}, collection=coll))

# ── 2. chunks never show as rows ────────────────────────────────────────────
r = client.post("/vector/scroll", json={"scope": "knowledge", "project": "alpha", "limit": 50}).json()
check("scroll counts rows, not chunks", r["matched"] == 6 and not any("#c" in h["vector_id"] for h in r["hits"]),
      r["matched"])

# ── 3. re-add replaces, delete removes ──────────────────────────────────────
add("vec_long", LONG)
again = len(main.get_vt({chunks.PARENT_KEY: {"$eq": "vec_long"}}, collection=coll))
check("re-adding a row replaces its chunks (no duplicates)", again == n_chunks, (again, n_chunks))
client.post("/vector/delete", json={"ids": ["vec_long"], "scope": "knowledge", "project": "alpha"})
check("deleting a row removes its chunks", not main.get_vt({chunks.PARENT_KEY: {"$eq": "vec_long"}}, collection=coll))
check("and it no longer comes back through them", "vec_long" not in [h["vector_id"] for h in query(TAIL)])

# ── 4. a spilled worklog is still found through its chunks ─────────────────
logmeta = {"topic": "alpha", "subject": "alpha", "ts": "2099-01-01T00:00:00Z"}
add("log_long", LONG, scope="log", extra=logmeta)
for i in range(3):          # push it out of the 2-row hot slot
    add(f"log_fill_{i}", f"filler log {i} about payroll", scope="log",
        extra={**logmeta, "ts": f"2099-01-0{i + 2}T00:00:00Z"})
hot = [s for s in client.get("/log/window").json()["slots"] if s["project"] == "alpha"]
check("the long log has spilled out of the hot window", hot and hot[0]["entries"] == 2, hot)
hits = query(TAIL, scope="log")
check("the spilled row is still found by its tail", hits and hits[0]["vector_id"] == "log_long",
      [h["vector_id"] for h in hits])

# ── 5. rechunk for rows stored before ───────────────────────────────────────
config.CHUNK_MIN_CHARS = 10 ** 9
add("vec_old", LONG, project="beta")
config.CHUNK_MIN_CHARS = saved
r = client.post("/vector/rechunk", json={"scope": "knowledge", "project": "beta"}).json()
check("rechunk is a dry run unless asked", r["dry_run"] and r["long_rows"] == 1 and r["chunks_written"] == 0, r)
before = next((h["score"] for h in query(TAIL, project="beta") if h["vector_id"] == "vec_old"), 0.0)
r = client.post("/vector/rechunk", json={"scope": "knowledge", "project": "beta", "dry_run": False}).json()
check("rechunk writes the chunks", r["chunks_written"] >= 1, r)
hits = query(TAIL, project="beta")
check("after rechunk the old row is matched by its tail", hits and hits[0]["vector_id"] == "vec_old"
      and hits[0]["score"] > before + 0.15, (hits[0]["score"] if hits else None, before))

print(f"\n{'ALL PASS' if not FAILED else 'FAILED'}  ({len(FAILED)} failed)")
sys.exit(1 if FAILED else 0)
