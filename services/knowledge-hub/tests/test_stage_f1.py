"""Stage F1: the multi-instance concurrency core (docs/multi-agent-instance-design.md section 2).

WHAT IS UNDER TEST
  1. app/sqldb.py helpers: the database clock, conditional updates, kh_counter, kh_schema_migration,
     add_column, leases with fencing epochs and run_under_lease.
  2. Two-connection RACE tests on SQLite (threads, one connection each, released by a barrier):
     counters hand out every value once; two acquires give one winner; a stale epoch is fenced;
     two concurrent message reads deliver once; concurrent feedback bumps lose nothing and a finding is
     marked once; a distil batch is claimed once; a cron runs on one "instance" only.
  3. Behaviour kept: message v2 fields, legacy users_read imported as receipts, the feedback counter
     JSON shape, legacy counter.json imported once, per-row projects_store, forward-only distil cursor.

Run from the repo root with the project venv:
    .venv\\Scripts\\python tests\\test_stage_f1.py

Throwaway SQLite database and project dir; no network. The same rules run on HANA when
KH_TEST_HANA=1 and HANA_* are set (live part at the end; skipped otherwise).
"""
import json
import os
import sys
import tempfile
import threading
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "tests"))

import hana_test_env  # noqa: E402  (opt-in HANA run: KH_TEST_HANA=1 + KH_STORE_BACKEND=hana)

TMP = tempfile.mkdtemp(prefix="kh_f1_")
os.environ["KH_HOOKS_DB"] = os.path.join(TMP, "hooks.db")
os.environ["KH_STORE_BACKEND"] = hana_test_env.store_backend()
if os.environ["KH_STORE_BACKEND"] == "hana":
    hana_test_env.wipe_schema()
os.environ["CHROMA_PATH"] = os.path.join(TMP, "chroma")
os.environ["KH_PROJECTS_PATH"] = os.path.join(TMP, "projects")
os.environ["KH_FEEDBACK_CRON"] = "false"
os.environ.pop("KH_AUTH_ISSUER", None)

from app import config, sqldb  # noqa: E402

assert config.HOOKS_DB_PATH == os.environ["KH_HOOKS_DB"], "test must run against a throwaway db"

FAILURES = []
CHECKS = 0


def check(name, condition, detail=None):
    global CHECKS
    CHECKS += 1
    print(("ok   " if condition else "FAIL ") + name + ("" if condition or detail is None else f"  -> {detail}"))
    if not condition:
        FAILURES.append(name)


def race(n, fn):
    """Run fn(i) on n threads released together; returns the results in thread order."""
    barrier = threading.Barrier(n)
    out = [None] * n
    errors = []

    def run(i):
        try:
            barrier.wait()
            out[i] = fn(i)
        except Exception as exc:  # noqa: BLE001
            errors.append(repr(exc))
    threads = [threading.Thread(target=run, args=(i,)) for i in range(n)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    if errors:
        raise RuntimeError(errors[0])
    return out


# ── 1. helpers ───────────────────────────────────────────────────────────────
with sqldb.connect() as c:
    sqldb.ensure_core(c)
    db_now = sqldb.now_ms(c)
check("now_ms comes from the database and is UTC epoch ms", abs(db_now - time.time() * 1000) < 5000, db_now)

with sqldb.connect() as c:
    sqldb.create_table(c, "t_demo", "CREATE TABLE IF NOT EXISTS t_demo (id TEXT PRIMARY KEY, v INTEGER)",
                       "CREATE COLUMN TABLE t_demo (id NVARCHAR(64) PRIMARY KEY, v BIGINT)")
    check("insert_new: first insert wins", sqldb.insert_new(c, "t_demo", {"id": "a", "v": 1}))
    check("insert_new: duplicate key is False, not an error", not sqldb.insert_new(c, "t_demo", {"id": "a", "v": 2}))
    check("update returns rowcount 1 when the condition holds",
          sqldb.update(c, "UPDATE t_demo SET v=2 WHERE id='a' AND v=1") == 1)
    check("update returns 0 when it does not", sqldb.update(c, "UPDATE t_demo SET v=3 WHERE id='a' AND v=1") == 0)
    check("add_column adds once", sqldb.add_column(c, "t_demo", "extra", "TEXT", "NVARCHAR(10)")
          and not sqldb.add_column(c, "t_demo", "extra", "TEXT", "NVARCHAR(10)"))

applied = []
with sqldb.connect() as c:
    first = sqldb.migrate(c, "demo", [(2, lambda cc: applied.append(2)), (1, lambda cc: applied.append(1))])
    again = sqldb.migrate(c, "demo", [(1, lambda cc: applied.append(1)), (2, lambda cc: applied.append(2)),
                                      (3, lambda cc: applied.append(3))])
check("migrate applies steps in version order, each once", first == [1, 2] and again == [3] and applied == [1, 2, 3],
      (first, again, applied))

# ── 2. counters (race) ───────────────────────────────────────────────────────
def bump(_):
    got = []
    for _ in range(25):
        with sqldb.connect() as c:
            got.append(sqldb.counter_add(c, "demo:race"))
    return got


vals = [v for part in race(8, bump) for v in part]
with sqldb.connect() as c:
    total = sqldb.counter_get(c, "demo:race")
check("RACE counter: 8 connections x 25 increments = 200, every value handed out once",
      total == 200 and sorted(vals) == list(range(1, 201)), (total, len(set(vals))))

# ── 3. leases and fencing ────────────────────────────────────────────────────
with sqldb.connect() as c:
    a = sqldb.lease_acquire(c, "nsx", "unit/1", "A", 30000)
with sqldb.connect() as c:
    b = sqldb.lease_acquire(c, "nsx", "unit/1", "B", 30000)
check("lease: first acquire gets epoch 1", a and a["epoch"] == 1, a)
check("lease: a second holder is refused while it is held", b is None, b)
with sqldb.connect() as c:
    again = sqldb.lease_acquire(c, "nsx", "unit/1", "A", 30000)
    renewed = sqldb.lease_renew(c, "nsx", "unit/1", "A", 1, 30000)
check("lease: the holder re-acquires/renews at the same epoch", again["epoch"] == 1 and renewed["epoch"] == 1,
      (again, renewed))
with sqldb.connect() as c:
    c.execute("UPDATE kh_lease SET until_ms = until_ms - 60000 WHERE ns='nsx' AND name='unit/1'")   # expire it
with sqldb.connect() as c:
    b = sqldb.lease_acquire(c, "nsx", "unit/1", "B", 30000)
    lost = sqldb.lease_renew(c, "nsx", "unit/1", "A", 1, 30000)
    stale = sqldb.fence_ok(c, "nsx", "unit/1", 1)
    fresh = sqldb.fence_ok(c, "nsx", "unit/1", 2)
check("lease: after expiry another holder takes it with epoch+1", b and b["epoch"] == 2, b)
check("lease: the old holder's renew fails (lease lost)", lost is None, lost)
check("fence: the stale epoch is refused, the current one accepted", not stale and fresh, (stale, fresh))
with sqldb.connect() as c:
    sqldb.create_table(c, "t_fenced", "CREATE TABLE IF NOT EXISTS t_fenced (id TEXT PRIMARY KEY, v TEXT)",
                       "CREATE COLUMN TABLE t_fenced (id NVARCHAR(64) PRIMARY KEY, v NVARCHAR(256))")
    c.execute("INSERT INTO t_fenced VALUES ('x', 'init')")
with sqldb.connect() as c:
    n_stale = sqldb.update(c, f"UPDATE t_fenced SET v='A' WHERE id='x' AND {sqldb.fence_sql()}", ["nsx", "unit/1", 1])
    n_ok = sqldb.update(c, f"UPDATE t_fenced SET v='B' WHERE id='x' AND {sqldb.fence_sql()}", ["nsx", "unit/1", 2])
check("fence_sql inside the write: stale epoch changes 0 rows, current epoch 1", n_stale == 0 and n_ok == 1,
      (n_stale, n_ok))
with sqldb.connect() as c:
    rel = sqldb.lease_release(c, "nsx", "unit/1", "B", 2)
    after = sqldb.lease_get(c, "nsx", "unit/1")
    c2 = sqldb.lease_acquire(c, "nsx", "unit/1", "C", 30000)
check("lease: release frees it; the next holder gets epoch 3", rel and not after["held"] and c2["epoch"] == 3,
      (rel, after, c2))
with sqldb.connect() as c:
    listed = sqldb.lease_list(c, "nsx", "unit/")
    bumped = sqldb.lease_bump_all(c, "nsx")
    gone = sqldb.lease_get(c, "nsx", "unit/1")
check("lease_list by prefix; lease_bump_all fences every lease", len(listed) == 1 and bumped == 1
      and gone["epoch"] == 4 and gone["holder"] is None, (listed, gone))

winners_total = 0
for k in range(15):
    def grab(i, k=k):
        with sqldb.connect() as c:
            return sqldb.lease_acquire(c, "nsx", f"race/{k}", f"H{i}", 30000)
    res = race(4, grab)
    winners_total += sum(1 for r in res if r)
check("RACE lease: 15 rounds x 4 concurrent acquires on a new lease = exactly 1 winner each", winners_total == 15,
      winners_total)

ran = []
res = race(3, lambda i: sqldb.run_under_lease("cron.demo", 30, lambda: ran.append(i) or i, holder=f"inst{i}"))
check("RACE cron: run_under_lease on 3 instances runs the job once", len(ran) == 1
      and sum(1 for r in res if r[0]) == 1, (ran, res))

# ── 4. messages ──────────────────────────────────────────────────────────────
from app import messages  # noqa: E402

# a legacy row with users_read filled before receipts existed
with sqldb.connect() as c:
    for table in ("message_stack",):
        sqldb.create_table(c, table, f"""CREATE TABLE IF NOT EXISTS {table} (id TEXT PRIMARY KEY, project TEXT NOT NULL,
                  sender TEXT NOT NULL, receiver TEXT NOT NULL, content TEXT NOT NULL,
                  users_read TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL)""",
                           f"""CREATE COLUMN TABLE {table} (id NVARCHAR(64) PRIMARY KEY, project NVARCHAR(256) NOT NULL,
                  sender NVARCHAR(256) NOT NULL, receiver NVARCHAR(256) NOT NULL, content NCLOB NOT NULL,
                  users_read NCLOB NOT NULL, created_at NVARCHAR(32) NOT NULL)""")
    c.execute("INSERT INTO message_stack VALUES ('msg_legacy','alpha','ana@x.io','all','old news',"
              "'[\"ben@x.io\"]','2026-01-01T00:00:00Z')")
messages.init()
with sqldb.connect() as c:
    rec = [tuple(r) for r in c.execute("SELECT message_id, reader FROM message_receipt")]
check("messages: legacy users_read became receipts", rec == [("msg_legacy", "ben@x.io")], rec)
check("messages: ben does not get the legacy message again", messages.deliver("ben@x.io", None) == [])

m = messages.post("alpha", "ana@x.io", "please review", receiver="ben@x.io", kind="task", task_id="T-7",
                  reply_to="msg_legacy")
check("messages v2: kind, task_id, reply_to stored", (m["kind"], m["task_id"], m["reply_to"]) == ("task", "T-7",
                                                                                                    "msg_legacy"), m)
try:
    messages.post("alpha", "ana@x.io", "x", receiver="ben@x.io", kind="Bad Kind!")
    check("messages v2: a malformed kind is refused", False)
except ValueError:
    check("messages v2: a malformed kind is refused", True)
plain = messages.post("alpha", "ana@x.io", "hello all", receiver="all")
check("messages v2: kind defaults to note", plain["kind"] == "note", plain)

for k in range(10):
    messages.post("alpha", "ana@x.io", f"race {k}", receiver="cat@x.io")
# Since the channels (2026-10-16) a mention is delivered for the project the inbox names, and a post to
# "all" or the legacy row is a plain channel message: no notification.
got = race(4, lambda i: messages.deliver("cat@x.io", "alpha"))
contents = [mm["content"] for part in got for mm in part]
check("RACE messages: 4 concurrent inbox calls deliver each message exactly once",
      sorted(contents) == sorted(f"race {k}" for k in range(10)), sorted(contents))
d = messages.deliver("ben@x.io", "alpha")
check("messages: delivered rows carry v2 fields",
      any(x["kind"] == "task" and x["task_id"] == "T-7" and x["reply_to"] == "msg_legacy" for x in d), d)
with sqldb.connect() as c:                    # a project message is archived once it expires (MSG_PROJECT_TTL_HOURS)
    c.execute("UPDATE message_stack SET expires_at=? WHERE id=?", ["2000-01-01T00:00:00Z", m["id"]])
res = messages.sweep()
with sqldb.connect() as c:
    arch = {r["id"]: dict(r) for r in c.execute("SELECT * FROM message_archive")}
    left_receipts = c.execute("SELECT COUNT(*) FROM message_receipt WHERE message_id=?", [m["id"]]).fetchone()[0]
check("messages: sweep archives an expired message with kind and readers, and drops its receipts",
      m["id"] in arch and arch[m["id"]]["kind"] == "task" and json.loads(arch[m["id"]]["users_read"]) == ["ben@x.io"]
      and left_receipts == 0, (res, arch.get(m["id"])))

# ── 5. feedback counters ─────────────────────────────────────────────────────
from app import docstore, feedback, projects  # noqa: E402

projects.get_or_create_project("legacyproj")
docstore.write_json(projects.bundle_of("legacyproj").counter_file,
                    {"request_total": 7, "issues": {"i1": {"issue_id": "i1", "desc": "old", "count": 2,
                                                           "opened_at_request": 3, "last_marked_count": 0,
                                                           "created_at": "2026-01-01T00:00:00Z",
                                                           "updated_at": "2026-01-01T00:00:00Z"}}})
c0 = feedback._read("legacyproj")
check("feedback: legacy counter.json imported once, same shape", c0["request_total"] == 7
      and c0["issues"]["i1"]["count"] == 2 and c0["issues"]["i1"]["desc"] == "old", c0)
docstore.write_json(projects.bundle_of("legacyproj").counter_file, {"request_total": 99, "issues": {}})
feedback._IMPORTED.clear()
check("feedback: the import does not run twice", feedback._read("legacyproj")["request_total"] == 7)

projects.get_or_create_project("fbproj")
race(4, lambda i: [feedback.bump_issue("fbproj", "flaky", "flaky test") for _ in range(10)])
race(4, lambda i: [feedback.tick_request("fbproj") for _ in range(10)])
cnt = feedback._read("fbproj")
check("RACE feedback: 4 x 10 concurrent bumps = 40, 4 x 10 ticks = 40", cnt["issues"]["flaky"]["count"] == 40
      and cnt["request_total"] == 40, cnt)
check("feedback: projects.read_counter reads the same rows", projects.read_counter("fbproj") == cnt)
marks = []
feedback.mark_finding = lambda pid, issue, emb: marks.append(issue["issue_id"]) or {"issue_id": issue["issue_id"]}
race(4, lambda i: feedback.evaluate_project("fbproj"))
check("RACE feedback: 4 concurrent sweeps mark the finding once", marks == ["flaky"], marks)
feedback.evaluate_project("fbproj")
check("feedback: no re-mark at the same count", marks == ["flaky"], marks)
feedback.bump_issue("fbproj", "flaky")
feedback.evaluate_project("fbproj")
check("feedback: re-marked when the count grows", marks == ["flaky", "flaky"], marks)
feedback._findings_collection = lambda pid: type("C", (), {"delete": lambda self, ids: None})()
r = feedback.reset_issue("fbproj", "flaky")
check("feedback: reset clears the issue row", r["issue_cleared"] and "flaky" not in feedback._read("fbproj")["issues"])

# ── 6. projects_store per row ────────────────────────────────────────────────
from app import projects_store  # noqa: E402

stale = projects_store.load_all()                       # instance B's old copy
projects.get_or_create_project("newproj")               # instance A creates a project
projects_store.upsert_one({**stale["fbproj"], "descriptor": "edited on B"})   # B edits one row
check("projects_store: a per-row write from a stale copy keeps the project created meanwhile",
      "newproj" in projects_store.load_all() and projects_store.get_one("fbproj")["descriptor"] == "edited on B")
check("projects_store: delete_one removes exactly one row", projects_store.delete_one("newproj")
      and "newproj" not in projects_store.load_all() and "fbproj" in projects_store.load_all()
      and not projects_store.delete_one("newproj"))

# ── 7. distil batch claim and cursor ─────────────────────────────────────────
from app import distill  # noqa: E402

distill.init()
distill._save_batch("db_x", "fbproj", ["l1"], {"last_ts": 5.0, "last_ids": ["l1"], "signal_ids": [], "topics": []})
claims = race(4, lambda i: distill._claim_batch("db_x"))
check("RACE distil: 4 concurrent submits claim the batch once", claims.count(True) == 1, claims)
check("distil: cursor moves forward", distill._save_cursor("fbproj", {"last_ts": 10.0, "last_ids": ["b"],
                                                                     "signal_ids": [], "topics": []}))
moved_back = distill._save_cursor("fbproj", {"last_ts": 4.0, "last_ids": ["a"], "signal_ids": [], "topics": []})
check("distil: a late older batch cannot move the cursor back", not moved_back
      and distill.cursor("fbproj")["last_ts"] == 10.0, distill.cursor("fbproj"))
distill.reset_cursor("fbproj")
check("distil: after a reset the cursor starts again", distill._save_cursor(
    "fbproj", {"last_ts": 1.0, "last_ids": [], "signal_ids": [], "topics": []}) and
    distill.cursor("fbproj")["last_ts"] == 1.0)

# ── 8. live HANA (optional) ──────────────────────────────────────────────────
if os.getenv("KH_TEST_HANA") == "1":
    os.environ["KH_STORE_BACKEND"] = "hana"
    import importlib
    importlib.reload(config)
    with sqldb.connect() as c:
        sqldb.ensure_core(c)
        hn = sqldb.now_ms(c)
        name = f"f1test/{int(time.time())}"
        la = sqldb.lease_acquire(c, "_test", name, "A", 30000)
        lb = sqldb.lease_acquire(c, "_test", name, "B", 30000)
        v1 = sqldb.counter_add(c, "f1test:" + name)
        c.execute("DELETE FROM kh_lease WHERE ns='_test'")
        sqldb.counter_delete(c, "f1test:" + name)
    check("HANA: db clock, lease, counter", abs(hn - time.time() * 1000) < 60000 and la and lb is None and v1 == 1)
else:
    print("live HANA: skipped (set KH_TEST_HANA=1 with HANA_* credentials)")

print()
print(f"{CHECKS} checks, {len(FAILURES)} failure(s)" if FAILURES else f"{CHECKS} checks, all passed")
sys.exit(1 if FAILURES else 0)
