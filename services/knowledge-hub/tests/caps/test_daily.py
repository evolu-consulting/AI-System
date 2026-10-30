"""Contract test of the daily summary (app/caps/daily.py, docs/roadmap-e-to-5-design.md section 3.4, slice S6).

  1. Off by default: DEFAULT_ON = False; off, the four routes do not exist (404).
  2. Reading before E: /log/day answers the code listing (counts per topic and author, first lines); a member
     without project.read gets 403; the time zone edge at local midnight puts a log on the right day.
  3. /daily/next lists finished project-days with logs (oldest first, cut to 1,500 chars, at most 60 per day),
     not today and not a day that ended < 2 h ago; members are refused.
  4. /daily/submit: the four parts, the length cap, the leak gate (e-mail refused, a host kept: own-project rules),
     source ids of that day only, dry_run writes nothing, a good summary is stored (mode llm) and /log/day reads it.
  5. A late log rewrites the day: next lists it again, the rewrite is conditional on rev (stale rev 409, race).
  6. /log/week joins seven days in code; the worker: dry mode forces dry_run, the month budget answers 429.
"""
import os

from harness import H  # noqa: I001  (must be first: throwaway db, sign-in on)

from datetime import datetime, timezone  # noqa: E402

from fastapi.testclient import TestClient  # noqa: E402

from app import caps, sqldb  # noqa: E402
from app import vector_store as vs  # noqa: E402
from app.caps import daily, people, principals  # noqa: E402

MAINT = H.person("fen@x.io", maintainer=True)
READER = H.person("mia@x.io", member=["alpha"])
STRANGER = H.person("sam@x.io", member=["beta"])
for k in ("KH_CAP_PEOPLE", "KH_CAP_DAILY", "KH_DISTILL_WORKER", "KH_WORKER_CAP_MONTH_USD"):
    os.environ.pop(k, None)


def ms(iso: str) -> int:
    return int(datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp() * 1000)


# "now" = 2026-10-11 05:00 in Asia/Ho_Chi_Minh (+07) = 2026-10-10T22:00Z
NOW = ms("2026-10-10T22:00:00Z")
daily._now_ms = lambda: NOW
VEC = [0.0] * 383 + [1.0]


def log(vid: str, ts: str, text: str, topic: str = "build", author: str = "mia@x.io", project: str = "alpha",
        hot: bool = False):
    meta = {"scope": "log", "topic": topic, "author": author, "ts": ts}
    if hot:
        meta["project"] = project
        coll = vs.hotlog_collection()
    else:
        coll = vs.scope_collection("log", project)
    vs.upsert_vt(vid, VEC, text, meta, collection=coll)


def summary(extra: str = "") -> str:
    return ("Done: the build pipeline was fixed by Dev.\nDecided: keep Java 21.\n"
            f"Broken or open: flaky test in module A{extra}.\nWho: Dev, PO.")


# ── 1. off by default ────────────────────────────────────────────────────────
H.check("daily declares DEFAULT_ON = False", daily.DEFAULT_ON is False)
off = TestClient(H.app())
H.check("OFF: daily is not attached", not caps.is_loaded("daily"))
codes = [off.get("/daily/next", params={"project": "alpha"}, headers=MAINT).status_code,
         off.post("/daily/submit", json={}, headers=MAINT).status_code,
         off.get("/log/day", params={"project": "alpha", "date": "2026-10-09"}, headers=MAINT).status_code,
         off.get("/log/week", params={"project": "alpha"}, headers=MAINT).status_code]
H.check("OFF: the four routes answer 404", codes == [404] * 4, codes)

# ── 2. on; the code listing ─────────────────────────────────────────────────
os.environ["KH_CAP_PEOPLE"] = "on"
os.environ["KH_CAP_DAILY"] = "on"
c = TestClient(H.app())
H.check("ON: daily and people are attached", caps.is_loaded("daily") and caps.is_loaded("people"))
with sqldb.connect() as conn:
    H.check("ON: kh_daily exists", conn.execute("SELECT COUNT(*) FROM kh_daily").fetchone()[0] == 0)

# 2026-10-09 local (+07) = [10-08T17:00Z, 10-09T17:00Z)
log("l1", "2026-10-08T17:00:00Z", "Fixed the build pipeline\nsecond line", "build")              # 10-09 00:00 local
log("l2", "2026-10-09T03:00:00Z", "Decided to keep Java 21", "java", "hugh@x.io")
log("l3", "2026-10-09T16:59:59Z", "Flaky test in module A " + "x" * 2000, "build")              # 10-09 23:59:59
log("l4", "2026-10-09T17:00:00Z", "Started the release notes", "release")                       # 10-10 00:00 local
log("l5", "2026-10-10T20:00:00Z", "Today's work", "build")                                      # 10-11 local: today
log("h1", "2026-10-09T05:00:00Z", "Hot window row on alpha", "build", hot=True)
log("b1", "2026-10-09T05:00:00Z", "beta's private log", "build", project="beta")

r = c.get("/log/day", params={"project": "alpha", "date": "2026-10-09"}, headers=READER)
j = r.json()
H.check("DAY: before a summary, the code listing", r.status_code == 200 and j["mode"] == "code", r.text[:300])
lst = j.get("listing") or {}
H.check("DAY: four logs incl. the hot window, never another project's",
        lst.get("count") == 4 and {x["id"] for x in lst["lines"]} == {"l1", "l2", "l3", "h1"}, lst)
H.check("DAY: counts per topic and author", lst["by_topic"] == {"build": 3, "java": 1}
        and lst["by_author"] == {"mia@x.io": 3, "hugh@x.io": 1}, lst)
H.check("DAY: first line of each log, oldest first",
        [x["id"] for x in lst["lines"]] == ["l1", "l2", "h1", "l3"] and lst["lines"][0]["first_line"]
        == "Fixed the build pipeline", lst["lines"])
H.check("TZ: 23:59:59 local stays on the day, 00:00 local opens the next",
        "l3" in {x["id"] for x in lst["lines"]} and "l4" not in {x["id"] for x in lst["lines"]})
r = c.get("/log/day", params={"project": "alpha", "date": "2026-10-10"}, headers=READER)
H.check("TZ: the 00:00 log is on 2026-10-10", [x["id"] for x in r.json()["listing"]["lines"]] == ["l4"], r.text)
H.check("TZ: day bounds of Asia/Ho_Chi_Minh are +07",
        daily.day_bounds(daily.parse_day("2026-10-09"), daily.tz_of("Asia/Ho_Chi_Minh"))
        == (ms("2026-10-08T17:00:00Z"), ms("2026-10-09T17:00:00Z")))
H.check("TZ: a fixed offset parses", daily.tz_of("UTC-05:30").utcoffset(None).total_seconds() == -5.5 * 3600)
r = c.get("/log/day", params={"project": "alpha", "date": "2026-10-09"}, headers=STRANGER)
H.check("DAY: a non-reader gets 403", r.status_code == 403, r.text)
r = c.get("/log/week", params={"project": "alpha"}, headers=STRANGER)
H.check("WEEK: a non-reader gets 403", r.status_code == 403, r.text)
r = c.get("/log/day", params={"project": "alpha", "date": "2026-13-01"}, headers=READER)
H.check("DAY: a bad date is 422", r.status_code == 422, r.text)

# ── 3. next ──────────────────────────────────────────────────────────────────
r = c.get("/daily/next", params={"project": "alpha"}, headers=READER)
H.check("NEXT: a member is refused", r.status_code == 403, r.text)
r = c.get("/daily/next", params={"project": "alpha"}, headers=MAINT)
j = r.json()
H.check("NEXT: 200 for a maintainer", r.status_code == 200, r.text[:300])
H.check("NEXT: the finished days with logs, not today", [d["day"] for d in j["days"]] == ["2026-10-09", "2026-10-10"],
        [d["day"] for d in j.get("days", [])])
d9 = j["days"][0]
H.check("NEXT: logs oldest first, cut to 1,500 chars, with the listing",
        [x["id"] for x in d9["logs"]] == ["l1", "l2", "h1", "l3"] and len(d9["logs"][3]["text"]) == 1500
        and d9["listing"]["count"] == 4 and d9["rev"] == 0 and not d9["rewrite"], d9)
H.check("NEXT: built_from_ms is the newest log of the day", d9["built_from_ms"] == ms("2026-10-09T16:59:59Z"))
H.check("NEXT: a day that ended < 2 h ago is not listed",
        [d["day"] for d in daily.pending("alpha", now_ms=ms("2026-10-10T18:30:00Z"))["days"]] == ["2026-10-09"])
many = [{"id": f"m{i}", "ts_ms": i, "ts": i, "topic": "", "author": "", "text": "fixed a bug" if i == 0 else "x"}
        for i in range(80)]
kept = daily._sample(many)
H.check("NEXT: a large day keeps 60 logs, signal first, oldest first",
        len(kept) == 60 and kept[0]["id"] == "m0" and [k["ts_ms"] for k in kept] == sorted(k["ts_ms"] for k in kept),
        [k["id"] for k in kept[:3]])

# ── 4. submit ────────────────────────────────────────────────────────────────
base = {"project": "alpha", "day": "2026-10-09", "source_ids": ["l1", "l2", "l3"], "model": "claude-opus-5-5",
        "cost_usd": 0.01}


def sub(**kw):
    return c.post("/daily/submit", json={**base, **kw}, headers=MAINT)


r = c.post("/daily/submit", json={**base, "text": summary()}, headers=READER)
H.check("SUBMIT: a member is refused", r.status_code == 403, r.text)
r = sub(text="Done: x\nWho: y")
H.check("SUBMIT: missing parts refused", r.status_code == 422 and "four parts" in r.json()["detail"], r.text)
r = sub(text="Decided: a\nDone: b\nBroken or open: c\nWho: d")
H.check("SUBMIT: parts out of order refused", r.status_code == 422, r.text)
r = sub(text=summary("y" * 1200))
H.check("SUBMIT: over 1,200 chars refused", r.status_code == 422 and "at most 1200" in r.json()["detail"], r.text)
r = sub(text=summary(" - ask mia@x.io"))
H.check("SUBMIT: an e-mail is refused by the leak gate", r.status_code == 422 and r.json()["error"] == "leak_refused",
        r.text)
r = sub(text=summary(" on build-01.internal.example.com"), dry_run=True)
H.check("SUBMIT: a host passes (own-project rules)", r.status_code == 200 and r.json()["result"] == "dry_run", r.text)
r = sub(text=summary(), source_ids=["l1", "l4"])
H.check("SUBMIT: a log of another day is refused", r.status_code == 422 and "l4" in r.json()["detail"], r.text)
r = sub(text=summary(), source_ids=["b1"])
H.check("SUBMIT: another project's log is refused", r.status_code == 422, r.text)
r = sub(text=summary(), day="2026-10-11")
H.check("SUBMIT: a day not yet over is refused", r.status_code == 422, r.text)
r = sub(text=summary(), dry_run=True)
H.check("SUBMIT: dry_run returns the verdicts", r.status_code == 200 and r.json()["result"] == "dry_run"
        and r.json()["verdicts"] == {}, r.text)
H.check("SUBMIT: dry_run wrote nothing", daily.get_row("alpha", "2026-10-09") is None)
r = sub(text=summary(), built_from_ms=d9["built_from_ms"])
H.check("SUBMIT: accepted, rev 1", r.status_code == 200 and r.json()["result"] == "accepted" and r.json()["rev"] == 1,
        r.text)
row = daily.get_row("alpha", "2026-10-09")
H.check("SUBMIT: stored with mode llm, sources and model",
        row["mode"] == "llm" and row["source_ids"] == ["l1", "l2", "l3"] and row["model"] == "claude-opus-5-5"
        and row["built_from_ms"] == d9["built_from_ms"], row)
r = c.get("/log/day", params={"project": "alpha", "date": "2026-10-09"}, headers=READER)
H.check("DAY: the summary once it exists", r.json()["mode"] == "llm" and r.json()["text"] == summary(), r.text)
H.check("NEXT: a summarised day is not listed again",
        [d["day"] for d in daily.pending("alpha")["days"]] == ["2026-10-10"])
from app.caps import metrics  # noqa: E402
with sqldb.connect() as conn:
    lag = metrics.load_obs(conn, people.NS, "daily.lag_min", ["alpha"], {})
H.check("SUBMIT: daily.lag_min recorded in kh_people",
        len(lag) == 1 and abs(lag[0]["value"] - (NOW - ms("2026-10-09T17:00:00Z")) / 60000) < 1, lag)

# ── 5. late log rewrite ──────────────────────────────────────────────────────
log("l6", "2026-10-09T10:00:00Z", "Late log about the deploy", "deploy")
# its ts is inside the day but newer than nothing built? built_from_ms is the newest ts; make it newer:
log("l7", "2026-10-09T16:59:59.500000Z", "Very late log", "deploy")
nxt = daily.pending("alpha")["days"]
H.check("LATE: a newer log lists the day again as a rewrite of rev 1",
        nxt and nxt[0]["day"] == "2026-10-09" and nxt[0]["rewrite"] and nxt[0]["rev"] == 1, nxt and nxt[0])
r = sub(text=summary(), source_ids=["l1", "l7"], rev=0)
H.check("LATE: a stale rev is 409", r.status_code == 409 and r.json()["error"] == "write_conflict", r.text)
res = H.race(4, lambda i: c.post("/daily/submit", headers=MAINT, json={
    **base, "text": summary(f" #{i}"), "source_ids": ["l1", "l7"], "rev": 1}).status_code)
H.check("RACE: one rewrite of rev 1 wins", sorted(res) == [200, 409, 409, 409], res)
H.check("LATE: rev 2 now", daily.get_row("alpha", "2026-10-09")["rev"] == 2)
H.check("LATE: the day is not listed again", "2026-10-09" not in [d["day"] for d in daily.pending("alpha")["days"]])

# ── 6. week, worker ──────────────────────────────────────────────────────────
r = c.get("/log/week", params={"project": "alpha", "week": "2026-W41"}, headers=READER)
j = r.json()
H.check("WEEK: seven days Monday first", r.status_code == 200 and [x["date"] for x in j["days"]][0] == "2026-10-05"
        and len(j["days"]) == 7, r.text[:300])
H.check("WEEK: the summary of 10-09 and the listing of 10-10, joined in code",
        j["summarised"] == 1 and "## 2026-10-09" in j["text"] and "Decided: keep Java 21" in j["text"]
        and "## 2026-10-10 (Sat) - 1 logs" in j["text"], j["text"][:500])
r = c.get("/log/week", params={"project": "alpha", "week": "2026-10-07"}, headers=READER)
H.check("WEEK: a date selects its ISO week", r.json()["week"] == "2026-W41", r.text[:200])

os.environ["KH_DISTILL_WORKER"] = "dry"
WT = {"Authorization": "Bearer " + principals.issue(people.NS, "worker", "distiller", people.owner_email())["access_token"]}
r = c.post("/daily/submit", headers=WT, json={"project": "alpha", "day": "2026-10-10", "text": summary(),
                                              "source_ids": ["l4"], "model": "claude-opus-5-5", "cost_usd": 0.02})
H.check("WORKER dry: the submit is forced to a dry run", r.status_code == 200 and r.json()["dry_run"] is True
        and daily.get_row("alpha", "2026-10-10") is None, r.text)
r = c.post("/daily/submit", headers=WT, json={"project": "alpha", "day": "2026-10-10", "text": summary(),
                                              "source_ids": ["l4"]})
H.check("WORKER: must name its model", r.status_code == 422, r.text)
H.check("WORKER: next passes under the cap", c.get("/daily/next", params={"project": "alpha"}, headers=WT)
        .status_code == 200)
people.record_metrics([{"series": "worker.cost_usd", "value": 61, "unit_id": "run-x", "ts_ms": NOW - 1000,
                        "dims": {"job": "daily", "model": "claude-opus-5-5"}}])
H.check("BUDGET: the month spend is read from kh_people", daily.month_spend(NOW) >= 61, daily.month_spend(NOW))
before_bf = daily.month_spend(NOW)
people.record_metrics([{"series": "worker.cost_usd", "value": 500, "unit_id": "run-bf", "ts_ms": NOW - 1000,
                        "dims": {"job": "distil", "kind": "backfill", "model": "claude-opus-5-5"}}])
H.check("BUDGET: the backfill is kept out of the month spend, as on /distill/next and in the worker",
        daily.month_spend(NOW) == before_bf, (before_bf, daily.month_spend(NOW)))
r = c.get("/daily/next", params={"project": "alpha"}, headers=WT)
H.check("BUDGET: 429 budget for the worker over the month cap", r.status_code == 429 and r.json()["error"] == "budget",
        r.text)
H.check("BUDGET: a maintainer is not capped", c.get("/daily/next", params={"project": "alpha"}, headers=MAINT)
        .status_code == 200)
os.environ["KH_DISTILL_WORKER"] = "on"
r = c.post("/daily/submit", headers=WT, json={"project": "alpha", "day": "2026-10-10", "text": summary(),
                                              "source_ids": ["l4"], "model": "claude-opus-5-5"})
H.check("WORKER on: the summary is written", r.status_code == 200 and r.json()["result"] == "accepted"
        and daily.get_row("alpha", "2026-10-10")["rev"] == 1, r.text)

people._unwrap_decide()
for k in ("KH_CAP_PEOPLE", "KH_CAP_DAILY", "KH_DISTILL_WORKER"):
    os.environ.pop(k, None)
H.done()
