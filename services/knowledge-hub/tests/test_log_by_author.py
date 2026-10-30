"""Tests for GET /log/by and POST /log/backfill-author (2026-09-26).

WHAT IS UNDER TEST

  1. ONE PERSON'S LOG, FOR A MAINTAINER. With sign-in on, every worklog carries the e-mail of
     the person who wrote it (metadata.author, stamped by the server). /log/recent only shows
     the caller's own window, so "what did Hugh do on Friday?" had no answer. /log/by reads
     every worklog lane - each project's own log AND the hot window - for one author, keeps
     a time window given in the asker's own offset, and sorts newest first.

  2. NAMING THE WRITER OF OLD ROWS. Worklogs copied over from the store before sign-in carry
     no author, so /log/by cannot see them. /log/backfill-author stamps one on the named
     projects only, only on rows that have none, and looks before it writes.

  3. MAINTAINERS ONLY. Both routes read or change other people's rows.

Run from the repo root with the project venv:
    .venv\\Scripts\\python tests\\test_log_by_author.py

Runs against a THROWAWAY chroma dir + hooks.db with sign-in off, so metadata.author is
seeded directly; the stamping at store time is pinned in tests/test_auth.py.
"""
import os
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

TMP = tempfile.mkdtemp(prefix="kh_logby_")
os.environ["KH_HOOKS_DB"] = os.path.join(TMP, "hooks.db")
os.environ["CHROMA_PATH"] = os.path.join(TMP, "chroma")
os.environ["KH_PROJECTS_PATH"] = os.path.join(TMP, "projects")
os.environ["KH_KUZU_PROJECTS_PATH"] = os.path.join(TMP, "kuzu")

from fastapi.testclient import TestClient        # noqa: E402

from app import config                           # noqa: E402

assert TMP in config.CHROMA_PATH, "test must run against a throwaway chroma dir"

import main                                      # noqa: E402
from app import auth                             # noqa: E402
from app import projects as kh_projects          # noqa: E402
from app.vector_store import scope_collection, upsert_vt   # noqa: E402

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
kh_projects.ensure_orchestrator()
for pid in ("alpha", "beta", "gamma"):
    kh_projects.get_or_create_project(pid)

HUGH = "hugh@example.invalid"
OTHER = "other@example.invalid"
VEC = [0.0] * 384


def hot(text, project, ts, author=None):
    """A worklog written through the API: lands in the hot window."""
    meta = {"project": project, "topic": "t", "subject": "t", "ts": ts}
    if author:
        meta["author"] = author
    return client.post("/vector/add", json={"text": text, "scope": "log", "metadata": meta}).json()["vector_id"]


def spilled(vid, text, project, ts, author=None):
    """A worklog already resting in the project's own log (spilled, or copied from the old store)."""
    meta = {"scope": "log", "project": project, "topic": "t", "subject": "t", "ts": ts}
    if author:
        meta["author"] = author
    upsert_vt(vid, VEC, text, meta, scope_collection("log", project))
    return vid


def log_by(**params):
    return client.get("/log/by", params=params).json()


def backfill(**body):
    return client.post("/log/backfill-author", json=body).json()


def ids(res):
    return [h["vector_id"] for h in res.get("hits", [])]


# ---------------------------------------------------------------- seed
# Friday 2026-09-25 in Vietnam (+07:00) is 2026-09-24T17:00Z .. 2026-09-25T17:00Z.
fri_hot = hot("hugh friday afternoon, alpha", "alpha", "2026-09-25T08:00:00Z", HUGH)
fri_other = hot("someone else friday, alpha", "alpha", "2026-09-25T09:00:00Z", OTHER)
fri_early = spilled("vec_fri_early", "hugh friday 06:30 VN time, alpha", "alpha", "2026-09-24T23:30:00Z", HUGH)
thu = spilled("vec_thu", "hugh thursday afternoon VN time, alpha", "alpha", "2026-09-24T08:00:00Z", HUGH)
old_b1 = spilled("vec_old_b1", "old beta row without author, friday", "beta", "2026-09-25T02:00:00Z")
old_b2 = spilled("vec_old_b2", "old beta row without author, monday", "beta", "2026-09-22T02:00:00Z")
kept_b = spilled("vec_kept_b", "beta row already named", "beta", "2026-09-25T03:00:00Z", OTHER)
old_g = spilled("vec_old_g", "old gamma row without author", "gamma", "2026-09-25T04:00:00Z")

# ---------------------------------------------------------------- 1. /log/by
res = log_by(author=HUGH)
check("only that person's rows come back, from the hot window AND the project logs",
      set(ids(res)) == {fri_hot, fri_early, thu}, ids(res))
check("newest first", ids(res) == [fri_hot, fri_early, thu], ids(res))
check("matched is the true total", res["matched"] == 3, res)
check("the e-mail is matched case-insensitively", set(ids(log_by(author=HUGH.upper()))) == {fri_hot, fri_early, thu})

res = log_by(author=HUGH, since="2026-09-25T00:00:00+07:00", until="2026-09-26T00:00:00+07:00")
check("a day in the asker's time zone keeps the early-morning row and drops Thursday",
      ids(res) == [fri_hot, fri_early], ids(res))
res = log_by(author=HUGH, since="2026-09-25T00:00:00Z")
check("since alone is an open window", ids(res) == [fri_hot], ids(res))
res = log_by(author=HUGH, until="2026-09-25T00:00:00Z")
check("until is exclusive and alone is an open window", ids(res) == [fri_early, thu], ids(res))
check("project narrows", ids(log_by(author=HUGH, project="beta")) == [])
check("limit caps the page but not matched",
      (lambda r: r["count"] == 1 and r["matched"] == 3)(log_by(author=HUGH, limit=1)))
check("an author with no rows is an empty answer, not an error", log_by(author="nobody@example.invalid")["matched"] == 0)
check("rows without an author are not found yet", old_b1 not in ids(log_by(author=HUGH, project="beta")))

# ---------------------------------------------------------------- 2. /log/backfill-author
dry = backfill(author=HUGH, projects=["beta"])
check("dry run is the default", dry["applied"] is False, dry)
check("dry run counts only the rows without an author",
      dry["missing"] == 2 and dry["projects"] == [{"project": "beta", "scanned": 3, "missing": 2}], dry)
check("dry run writes nothing", log_by(author=HUGH, project="beta")["matched"] == 0)

done = backfill(author=HUGH, projects=["beta"], apply=True)
check("apply stamps the rows without an author", done["applied"] is True and done["missing"] == 2, done)
check("the stamped rows are now found", set(ids(log_by(author=HUGH, project="beta"))) == {old_b1, old_b2})
check("a row that already had an author keeps it", ids(log_by(author=OTHER, project="beta")) == [kept_b])
check("a project that was not named is untouched", log_by(author=HUGH, project="gamma")["matched"] == 0)
again = backfill(author=HUGH, projects=["beta"], apply=True)
check("running it again changes nothing", again["missing"] == 0, again)
check("the hot window is covered too",
      backfill(author=HUGH, projects=["alpha"])["projects"][0]["scanned"] == 4)
check("the author is stored lower-case", backfill(author="Hugh@Example.Invalid", projects=["gamma"])["author"] == HUGH)
check("projects must be named", client.post("/log/backfill-author", json={"author": HUGH, "projects": []}).status_code == 422)
check("a project with no log yet is reported empty, not created",
      backfill(author=HUGH, projects=["delta"])["projects"] == [{"project": "delta", "scanned": 0, "missing": 0}])

# ---------------------------------------------------------------- 3. maintainers only
rules = auth.load_rules()
member = auth.Principal.from_claims({"email": "m@example.invalid", "kh": {
    "role": "member", "permissions": [], "all_projects": [],
    "projects": {"alpha": ["project.read", "project.write", "project.log"]}}})
maintainer = auth.Principal.from_claims({"email": "boss@example.invalid", "kh": {
    "role": "maintainer", "permissions": [], "all_projects": ["project.read"], "projects": {}}})
for method, path in (("GET", "/log/by"), ("POST", "/log/backfill-author")):
    rule, params = auth.match(rules, method, path)
    check(f"{method} {path} has a rule", rule is not None)
    check(f"{method} {path} is refused to a member, even on their own project",
          auth.decide(rule, member, params, {"project": "alpha"}, {"projects": ["alpha"]}) is not None)
    check(f"{method} {path} is open to a maintainer", auth.decide(rule, maintainer, params, {}, {}) is None)

print(f"\n{CHECKS} checks, {len(FAILED)} failed")
sys.exit(1 if FAILED else 0)
