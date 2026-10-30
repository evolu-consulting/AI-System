"""Tests for the hot log window and the /vector/scroll total (2026-08-29).

WHAT IS UNDER TEST
  1. THE WINDOW. Worklogs are written to ONE shared partition tagged with the project
     that owns them, so a recency question needs no project. The window holds SLOTS,
     one per project, and evicting a slot SPILLS it into kh_log_<project> — a cache in
     front of the per-project logs, never a second source of truth.
  2. THE TOTAL. /vector/scroll used to report `matched` as the number of rows it had
     FETCHED, which is capped by `limit`, so a caller reading with a small limit saw a
     small "total" and believed the partition was exhausted. It now reports the true
     count, and `offset` pages through the whole partition instead of going empty
     after the first page.

Run from the repo root with the project venv:
    .venv\Scripts\python tests\test_hotlog.py

Runs against a THROWAWAY chroma dir, so it never touches the live install, and stubs
the embedder — every assertion here is about routing and bookkeeping, not similarity.
"""
import os
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

TMP = tempfile.mkdtemp(prefix="kh_hotlog_")
os.environ["KH_HOOKS_DB"] = os.path.join(TMP, "hooks.db")
os.environ["CHROMA_PATH"] = os.path.join(TMP, "chroma")
os.environ["KH_PROJECTS_PATH"] = os.path.join(TMP, "projects")
os.environ["KH_KUZU_PROJECTS_PATH"] = os.path.join(TMP, "kuzu")
os.environ["KH_HOTLOG_SLOTS"] = "3"
os.environ["KH_HOTLOG_MAX_PER_SLOT"] = "4"
# The rows below carry fixed 2026-08-29 timestamps; with the default 14-day age cap they spill on
# write once that date is past. The cap is set to "age of those rows + 30 days", which keeps them
# hot and still puts the 2026-01-01 row of the age check (240 days older) outside it.
from datetime import datetime, timezone  # noqa: E402
os.environ["KH_HOTLOG_MAX_AGE_DAYS"] = str((datetime.now(timezone.utc) - datetime(2026, 8, 29, tzinfo=timezone.utc)).days + 30)

from fastapi.testclient import TestClient        # noqa: E402

from app import config                           # noqa: E402

assert TMP in config.CHROMA_PATH, "test must run against a throwaway chroma dir"

import main                                      # noqa: E402

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


# TestClient WITHOUT the context manager, so the real lifespan (model download, graph
# bootstrap) never runs — the stub below is all these routes need.
main.app.state.model = _Model()
client = TestClient(main.app)


def write_log(project, text, ts):
    body = {"text": text, "scope": "log",
            "metadata": {"scope": "log", "topic": f"{project}-work",
                         "subject": f"{project}-work", "ts": ts}}
    if project:
        body["metadata"]["project"] = project
    return client.post("/vector/add", json=body)


def project_rows(project):
    return client.post("/vector/scroll",
                       json={"scope": "log", "project": project, "limit": 500}).json()


def window():
    return client.get("/log/window").json()


for i in range(6):
    write_log("alpha", f"WORK LOG alpha entry {i}", f"2026-08-29T10:0{i}:00Z")
for i in range(2):
    write_log("beta", f"WORK LOG beta entry {i}", f"2026-08-29T11:0{i}:00Z")
for i in range(2):
    write_log("gamma", f"WORK LOG gamma entry {i}", f"2026-08-29T12:0{i}:00Z")

slots = {s["project"]: s["entries"] for s in window()["slots"]}
check("a slot never grows past the per-slot cap", slots.get("alpha") == 4, slots)
check("overflow is spilled, not dropped", project_rows("alpha")["count"] == 6)
check("a project-scoped read sees only that project",
      {h["metadata"]["project"] for h in project_rows("alpha")["hits"]} == {"alpha"})

recent = client.get("/log/recent", params={"limit": 20}).json()
check("recency is answerable with NO project named", recent["count"] == 8, recent["count"])
check("newest comes first",
      recent["hits"][0]["metadata"]["ts"] == "2026-08-29T12:01:00Z",
      recent["hits"][0]["metadata"]["ts"])
check("every recent row names the project that owns it",
      all(h["metadata"].get("project") for h in recent["hits"]))

write_log("delta", "WORK LOG delta entry 0", "2026-08-29T13:00:00Z")
live = [s["project"] for s in window()["slots"]]
check("a new project evicts the least-recently-used slot",
      "alpha" not in live and len(live) == 3, live)
check("an evicted project stays fully readable", project_rows("alpha")["count"] == 6)

write_log(None, "WORK LOG with no project named", "2026-08-29T14:00:00Z")
check("an untagged log is tagged with the orchestrator, never orphaned",
      "orchestrator" in [s["project"] for s in window()["slots"]])

client.post("/vector/add", json={"text": "KNOWLEDGE beta fact", "scope": "knowledge",
                                 "metadata": {"scope": "knowledge", "project": "beta"}})
check("scopes other than log bypass the window",
      client.post("/vector/scroll",
                  json={"scope": "knowledge", "project": "beta", "limit": 50}
                  ).json()["count"] == 1)

write_log("gamma", "WORK LOG gamma ancient", "2026-01-01T00:00:00Z")
slots = {s["project"]: s["entries"] for s in window()["slots"]}
check("an entry older than the age cap spills straight through", slots.get("gamma") == 2, slots)
check("the aged-out entry is still readable", project_rows("gamma")["count"] == 3)

totals = set()
for limit in (1, 2, 3, 6, 500):
    totals.add(client.post("/vector/scroll",
                           json={"scope": "log", "project": "alpha", "limit": limit}
                           ).json()["matched"])
check("matched is the true total, not the fetched count", totals == {6}, totals)

walked, offset = [], 0
while offset < 40:
    page = client.post("/vector/scroll",
                       json={"scope": "log", "project": "alpha",
                             "limit": 2, "offset": offset}).json()
    if page["count"] == 0:
        break
    walked += [h["vector_id"] for h in page["hits"]]
    offset += 2
check("offset pages through the whole partition",
      len(walked) == 6 and len(set(walked)) == 6, len(walked))

# ── a log still in the hot window can be deleted (2026-10-30) ─────────────────
fresh = write_log("delta", "WORK LOG delta noise", "2026-08-29T13:00:00Z").json()["vector_id"]
other = write_log("epsilon", "WORK LOG epsilon keep", "2026-08-29T13:01:00Z").json()["vector_id"]
gone = client.request("DELETE", "/knowledge", json={"ids": [fresh], "scope": "vector", "project": "delta",
                                                    "data_scope": "log"}).json()
check("DELETE /knowledge removes a hot log row of its project",
      gone["vectors_deleted"] == 1 and gone["not_found"] == []
      and fresh not in [h["vector_id"] for h in project_rows("delta")["hits"]], gone)
kept = client.request("DELETE", "/knowledge", json={"ids": [other], "scope": "vector", "project": "delta",
                                                    "data_scope": "log"}).json()
check("a hot row of another project is not deleted through this project",
      kept["not_found"] == [other] and other in [h["vector_id"] for h in project_rows("epsilon")["hits"]], kept)

print("\n%d checks, %d failed" % (CHECKS, len(FAILED)))
if FAILED:
    print("FAILED:", FAILED)
    sys.exit(1)
