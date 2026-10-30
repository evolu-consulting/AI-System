"""Tests for server-side recency and snippets (2026-09-30).

WHAT IS UNDER TEST
  1. /log/recent NAMING A PROJECT reads the project's whole log - hot window AND the rows
     already spilled into kh_log_<project> - sorted newest first on the server, so "the
     latest entry" is right however many rows the project has. ``topic`` narrows it.
  2. /vector/scroll order/since sort and filter by metadata.ts on the server; ``ids``
     fetches exact rows.
  3. max_chars returns snippets marked truncated + text_len, on scroll, recent and query;
     omitting it returns the full text exactly as before.

Run from the repo root with the project venv:
    .venv\\Scripts\\python tests\\test_recency_snippets.py

Runs against a THROWAWAY chroma dir with sign-in off and a stubbed embedder. Timestamps are
relative to now, so the window's age cap never spills them early.
"""
import os
import sys
import tempfile
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

TMP = tempfile.mkdtemp(prefix="kh_recency_")
os.environ["KH_HOOKS_DB"] = os.path.join(TMP, "hooks.db")
os.environ["CHROMA_PATH"] = os.path.join(TMP, "chroma")
os.environ["KH_PROJECTS_PATH"] = os.path.join(TMP, "projects")
os.environ["KH_KUZU_PROJECTS_PATH"] = os.path.join(TMP, "kuzu")
os.environ["KH_HOTLOG_MAX_PER_SLOT"] = "3"
os.environ.pop("KH_AUTH_ISSUER", None)

from fastapi.testclient import TestClient        # noqa: E402

from app import config                           # noqa: E402

assert TMP in config.CHROMA_PATH, "test must run against a throwaway chroma dir"

import main                                      # noqa: E402

FAILED = []


def check(name, cond, detail=""):
    print("%-4s %s%s" % ("ok" if cond else "FAIL", name, ("  <- " + str(detail)) if detail and not cond else ""))
    if not cond:
        FAILED.append(name)


class _Model:
    @staticmethod
    def encode(text, normalize_embeddings=True):
        import numpy
        v = numpy.zeros(384, dtype="float32")
        v[0] = 1.0
        return v


main.app.state.model = _Model()
client = TestClient(main.app)
NOW = datetime.now(timezone.utc).replace(microsecond=0)


def ts(minutes_ago):
    return (NOW - timedelta(minutes=minutes_ago)).strftime("%Y-%m-%dT%H:%M:%SZ")


def log(project, topic, text, minutes_ago):
    r = client.post("/vector/add", json={"text": text, "scope": "log", "metadata": {
        "scope": "log", "project": project, "topic": topic, "subject": topic, "ts": ts(minutes_ago)}})
    assert r.status_code == 200, r.text


# Written out of time order on purpose; 8 rows with a per-slot cap of 3 leave 5 spilled.
LONG = "x" * 3000
for i, ago in enumerate([50, 10, 70, 30, 60, 20, 80, 40]):
    log("alpha", "alpha-work" if i % 2 == 0 else "alpha-ops", f"ALPHA row ago={ago} {LONG}", ago)

# ── 1. /log/recent naming a project ────────────────────────────────────────
r = client.get("/log/recent", params={"project": "alpha", "limit": 1}).json()
check("the newest row comes back first", r["hits"] and "ago=10 " in r["hits"][0]["source_text"],
      [h["source_text"][:20] for h in r["hits"]])
r = client.get("/log/recent", params={"project": "alpha", "limit": 50}).json()
check("spilled rows are included (8, not only the 3 still hot)", r["matched"] == 8 and r["count"] == 8, r["matched"])
agos = [int(h["source_text"].split("ago=")[1].split()[0]) for h in r["hits"]]
check("sorted newest first on the server", agos == sorted(agos), agos)
r = client.get("/log/recent", params={"project": "alpha", "topic": "alpha-ops", "limit": 50}).json()
check("topic narrows to one subject", r["matched"] == 4 and all(h["metadata"]["topic"] == "alpha-ops" for h in r["hits"]),
      r["matched"])
r = client.get("/log/recent", params={"project": "alpha", "since": ts(35), "limit": 50}).json()
check("since keeps only the recent rows", r["matched"] == 3, r["matched"])
r = client.get("/log/recent", params={"limit": 50}).json()
check("no project named: still the hot window only", r["matched"] == 3, r["matched"])

# ── 2. /vector/scroll order, since, ids ─────────────────────────────────────
r = client.post("/vector/scroll", json={"scope": "log", "project": "alpha", "order": "newest", "limit": 2}).json()
check("scroll order=newest returns the two newest", [h["source_text"].split()[2] for h in r["hits"]] == ["ago=10", "ago=20"],
      [h["source_text"][:20] for h in r["hits"]])
check("matched stays the true total", r["matched"] == 8, r["matched"])
r = client.post("/vector/scroll", json={"scope": "log", "project": "alpha", "order": "oldest", "limit": 1}).json()
check("scroll order=oldest", "ago=80 " in r["hits"][0]["source_text"])
r = client.post("/vector/scroll", json={"scope": "log", "project": "alpha", "since": ts(25), "limit": 50}).json()
check("scroll since filters by ts", r["matched"] == 2, r["matched"])
wanted = [h["vector_id"] for h in client.get("/log/recent", params={"project": "alpha", "limit": 2}).json()["hits"]]
r = client.post("/vector/scroll", json={"scope": "log", "project": "alpha", "ids": wanted}).json()
check("scroll ids fetches exactly those rows, in the order asked", [h["vector_id"] for h in r["hits"]] == wanted,
      [h["vector_id"] for h in r["hits"]])
r = client.post("/vector/scroll", json={"scope": "log", "project": "beta", "ids": wanted}).json()
check("ids stay inside the named project", r["count"] == 0, r["count"])

# ── 3. snippets ─────────────────────────────────────────────────────────────
r = client.get("/log/recent", params={"project": "alpha", "limit": 3, "max_chars": 100}).json()
h = r["hits"][0]
check("recent max_chars clips the text", len(h["source_text"]) == 100 and h["truncated"] and h["text_len"] > 3000,
      (len(h["source_text"]), h.get("truncated"), h.get("text_len")))
r = client.post("/vector/scroll", json={"scope": "log", "project": "alpha", "ids": [h["vector_id"]]}).json()
check("the full text is one ids call away", len(r["hits"][0]["source_text"]) == h["text_len"] and not r["hits"][0]["truncated"])
r = client.post("/vector/scroll", json={"scope": "log", "project": "alpha", "limit": 1}).json()
check("without max_chars the text is whole, as before", len(r["hits"][0]["source_text"]) > 3000 and not r["hits"][0]["truncated"])
r = client.post("/vector/query", json={"text": "alpha", "scope": "log", "project": "alpha", "k": 3, "max_chars": 80}).json()
check("query max_chars clips every hit", r["hits"] and all(len(x["source_text"]) <= 80 and x["truncated"] for x in r["hits"]),
      [len(x["source_text"]) for x in r["hits"]])
r = client.post("/vector/query", json={"text": "alpha", "scope": "log", "project": "alpha", "k": 3}).json()
check("query without max_chars is unchanged", all(len(x["source_text"]) > 3000 for x in r["hits"]))

print(f"\n{'ALL PASS' if not FAILED else 'FAILED'}  ({len(FAILED)} failed)")
sys.exit(1 if FAILED else 0)
