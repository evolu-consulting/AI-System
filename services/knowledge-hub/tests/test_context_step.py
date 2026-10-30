"""Tests for roadmap item C (2026-10-03): the matched piece in snippets, the score floor, /context/step.

WHAT IS UNDER TEST
  1. FIX 1 - THE PIECE THAT MATCHED. A long row found through a chunk past its head comes back, under
     max_chars, as its head plus that piece (piece_at says where). Without max_chars it is whole and
     unchanged; a row whose head matched keeps the plain head cut; no internal key leaks out.
  2. FIX 2 - SCORE FLOOR. /vector/query min_score leaves out hits below it; omitted, every hit returns.
  3. /context/step. Entity cards first; knowledge by meaning above the floor; the worklog only when
     knowledge found nothing; a time step (a date or a time word) reads the log by recency, inside
     that day; the pack stops at its budget; every item names its tier.
  4. ACCESS. An unreadable project is a 403, sign-in is required, rows of other projects stay out.

Run from the repo root with the project venv:
    .venv\\Scripts\\python tests\\test_context_step.py

Throwaway chroma dir + hooks.db, a locally generated RSA key and a bag-of-words stub embedder that,
like the real one, reads only the head of a text.
"""
import hashlib
import os
import re
import sys
import tempfile
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

TMP = tempfile.mkdtemp(prefix="kh_step_")
os.environ["KH_HOOKS_DB"] = os.path.join(TMP, "hooks.db")
os.environ["CHROMA_PATH"] = os.path.join(TMP, "chroma")
os.environ["KH_PROJECTS_PATH"] = os.path.join(TMP, "projects")
os.environ["KH_KUZU_PROJECTS_PATH"] = os.path.join(TMP, "kuzu")
os.environ["KH_STEP_FLOOR"] = "0.5"
os.environ["KH_STEP_KNOW_ENOUGH"] = "0.9"
os.environ["KH_STEP_BUDGET_CHARS"] = "4000"
ISSUER = "https://keycloak.test/realms/knowledge-hub"
os.environ["KH_AUTH_ISSUER"] = ISSUER
os.environ["KH_AUTH_AUDIENCE"] = "kh-api"

import jwt  # noqa: E402
import numpy  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import rsa  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import auth, config, projects  # noqa: E402

assert TMP in config.CHROMA_PATH, "test must run against a throwaway chroma dir"

import main  # noqa: E402

FAILURES = []


def check(name, condition, detail=None):
    print(("ok   " if condition else "FAIL ") + name + ("" if condition or detail is None else f"  -> {detail}"))
    if not condition:
        FAILURES.append(name)


class _Model:
    """Bag of words over the first HEAD characters (the real embedder also reads only a text's head)."""
    HEAD = 800

    @classmethod
    def _one(cls, text):
        v = numpy.zeros(384, dtype="float32")
        for w in re.findall(r"[a-z0-9]+", (text or "")[:cls.HEAD].lower()):
            if len(w) > 2:
                v[int(hashlib.md5(w.encode()).hexdigest(), 16) % 384] += 1.0
        n = numpy.linalg.norm(v)
        return v / n if n else v

    @classmethod
    def encode(cls, text, normalize_embeddings=True):
        return numpy.stack([cls._one(t) for t in text]) if isinstance(text, list) else cls._one(text)


KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
auth._keys.get = lambda kid: KEY.public_key() if kid == "k1" else None
FULL = ["project.read", "project.write", "project.log"]


def token(email, grants):
    now = int(time.time())
    kh = {"role": "member", "permissions": [], "all_projects": [], "projects": grants}
    claims = {"iss": ISSUER, "aud": "kh-api", "iat": now, "exp": now + 300, "email": email, "kh": kh}
    return {"Authorization": "Bearer " + jwt.encode(claims, KEY, algorithm="RS256", headers={"kid": "k1"})}


for pid in ("ticketing-system", "secret-deal", "lesson-learned"):
    projects.get_or_create_project(pid, descriptor=pid)
ANA = token("ana@example.invalid", {"ticketing-system": FULL, "lesson-learned": FULL, "secret-deal": FULL})
BEN = token("ben@example.invalid", {"ticketing-system": ["project.read"]})
main.app.state.model = _Model()
client = TestClient(main.app)


def add(text, scope, project, **meta):
    r = client.post("/vector/add", json={"text": text, "scope": scope,
                                         "metadata": {"project": project, **meta}}, headers=ANA)
    assert r.status_code == 200, r.text
    return r.json()["vector_id"]


FILLER = " ".join(f"routine maintenance note number {i} about unrelated housekeeping." for i in range(60))
TAIL = "PURVIEW SENSITIVITY LABEL encrypts the mail so the intake skips encrypted mails entirely."
LONG = "2026-09-20 ticketing intake review by the team. " + FILLER + " " + TAIL + " " + FILLER[:400]
long_id = add(LONG, "knowledge", "ticketing-system", topic="intake")
head_id = add("Deploy steps: dispatch the gcloud workflow, then check the support site after deploy.",
              "knowledge", "ticketing-system", topic="deploy")


def query(**body):
    r = client.post("/vector/query", json={"scope": "knowledge", "project": "ticketing-system", "k": 5, **body},
                    headers=ANA)
    assert r.status_code == 200, r.text
    return {h["vector_id"]: h for h in r.json()["hits"]}


# ── 1. fix 1: the piece that matched ───────────────────────────────────────
hits = query(text="purview sensitivity label encrypts mail intake skips encrypted mails", max_chars=600)
h = hits.get(long_id)
check("the long row is found through its tail chunk", h is not None, list(hits))
check("its snippet carries the piece that matched", h and "PURVIEW SENSITIVITY LABEL" in h["source_text"],
      h and h["source_text"][:300])
check("its snippet starts with the row's head", h and h["source_text"].startswith("2026-09-20 ticketing intake"),
      h and h["source_text"][:80])
check("its snippet stays within max_chars", h and len(h["source_text"]) <= 600, h and len(h["source_text"]))
check("piece_at says where the piece starts", h and h.get("piece_at") and h["piece_at"] > 600
      and LONG[h["piece_at"]:].startswith(h["source_text"].split(" [...] ", 1)[1][:40]), h and h.get("piece_at"))
check("truncated and text_len are set", h and h["truncated"] and h["text_len"] == len(LONG), h)
check("no internal piece key leaks out", h and "piece" not in h, h and list(h))

hits = query(text="purview sensitivity label encrypts mail intake skips encrypted mails")
check("without max_chars the row comes back whole", hits.get(long_id, {}).get("source_text") == LONG)
check("without max_chars no piece_at", hits.get(long_id, {}).get("piece_at") is None)

hits = query(text="ticketing intake review team routine maintenance", max_chars=600)
h = hits.get(long_id)
check("a row whose head matched keeps the plain head cut", h and h["source_text"] == LONG[:600]
      and h.get("piece_at") is None, h and h["source_text"][:120])

# ── 2. fix 2: score floor ──────────────────────────────────────────────────
every = query(text="dispatch the gcloud workflow deploy steps")
floored = query(text="dispatch the gcloud workflow deploy steps", min_score=0.5)
check("without min_score every hit comes back", set(every) == {long_id, head_id}, list(every))
check("min_score leaves out the far row", set(floored) == {head_id}, {k: v["score"] for k, v in every.items()})
r = client.post("/vector/query", json={"text": "x", "project": "ticketing-system", "min_score": 1.5}, headers=ANA)
check("min_score above 1 is refused", r.status_code == 422, r.status_code)

# ── 3. /context/step ───────────────────────────────────────────────────────
r = client.post("/entities", json={"project": "ticketing-system", "name": "Vincent Cao", "type": "person",
                                   "role": "developer"}, headers=ANA)
assert r.status_code == 200, r.text
client.post("/entities", json={"project": "secret-deal", "name": "Vincent Cao", "type": "person",
                               "role": "falcon negotiator"}, headers=ANA)
add("LESSON: before cf push, check cf target points at the right org and space.", "knowledge", "lesson-learned",
    topic="cf")
log_old = add("Worklog 2026-09-28: CS-294 create ticket hang fixed, PR merged, deployed with gcloud.",
              "log", "ticketing-system", topic="cs-294", ts="2026-09-28T09:00:00Z")
log_new = add("Worklog 2026-09-30: SLA filters reworked on the ticketing portal.",
              "log", "ticketing-system", topic="sla", ts="2026-09-30T09:00:00Z")


def step(text, who=ANA, **extra):
    resp = client.post("/context/step", json={"text": text, **extra}, headers=who)
    return resp.status_code, (resp.json() if resp.status_code == 200 else resp.text)


s, c = step("ask Vincent Cao about the gcloud workflow deploy steps", project="ticketing-system")
check("step answers 200", s == 200, c)
tiers = [i["tier"] for i in c["items"]]
check("entity cards come first", tiers and tiers[0] == "entity" and "developer" in c["items"][0]["text"], c["items"])
check("only the named project's card", sum(t == "entity" for t in tiers) == 1
      and "falcon" not in str(c["items"]), c["items"])
check("knowledge above the floor follows", head_id in [i["id"] for i in c["items"] if i["tier"] == "knowledge"],
      c["items"])
check("knowledge found, so the log is not read", "log" not in tiers, tiers)
check("every item is bounded by the item size", all(len(i["text"]) <= config.STEP_ITEM_CHARS for i in c["items"]))
check("the pack reports tiers, floor and budget", c["tiers"][0] == "entity" and c["floor"] == 0.5
      and c["used_chars"] <= c["budget_chars"], {k: c[k] for k in ("tiers", "floor", "used_chars", "budget_chars")})

s, c = step("ticket hang fixed PR merged deployed", project="ticketing-system")
check("no knowledge near the step, so the log is read", [i["id"] for i in c["items"] if i["tier"] == "log"]
      == [log_old], c["items"])

weak_know = add("Rollback note: rollback the portal release when the smoke check fails badly.", "knowledge",
                "ticketing-system", topic="rollback")
strong_log = add("Worklog: portal release rollback done, smoke check failed, rollback the portal release.",
                 "log", "ticketing-system", topic="rollback", ts="2026-09-29T09:00:00Z")
s, c = step("portal release rollback smoke check failed", project="ticketing-system")
order = [i["id"] for i in c["items"] if i["tier"] in ("knowledge", "log")]
check("knowledge near but not close enough, so the log is read too",
      weak_know in order and strong_log in order, c["items"])
check("the closer log row comes before the weaker knowledge row",
      strong_log in order and weak_know in order and order.index(strong_log) < order.index(weak_know), order)

s, c = step("person ticketing system role developer", project="ticketing-system")
check("a card described but not named is found by meaning",
      any(i["tier"] == "entity" and "Vincent Cao" in i["text"] for i in c["items"]), c["items"])

s, c = step("what was done on 2026-09-28 and did it reach production", project="ticketing-system")
ids = [i["id"] for i in c["items"] if i["tier"] == "log-recent"]
check("a dated step is a time step", c["time_step"] and c["since"] == "2026-09-28T00:00:00Z", c)
check("it reads that day's log only", ids == [log_old], ids)
r = client.get("/log/recent", params={"project": "ticketing-system", "since": "2026-09-28T00:00:00Z",
                                      "until": "2026-09-29T00:00:00Z"}, headers=ANA)
check("/log/recent until keeps one day", r.status_code == 200
      and [h["vector_id"] for h in r.json()["hits"]] == [log_old] and r.json()["matched"] == 1, r.text[:300])
r = client.get("/log/recent", params={"project": "ticketing-system", "limit": 1}, headers=ANA)
check("/log/recent reads the page only, newest first", r.status_code == 200
      and [h["vector_id"] for h in r.json()["hits"]] == [log_new] and r.json()["matched"] >= 2
      and r.json()["hits"][0]["source_text"].startswith("Worklog 2026-09-30"), r.text[:300])
check("time rows carry their ts", c["items"] and c["items"][0].get("ts") == "2026-09-28T09:00:00Z", c["items"][:1])

s, c = step("what is the latest on the portal", project="ticketing-system")
ids = [i["id"] for i in c["items"] if i["tier"] == "log-recent"]
check("a time word reads the newest log first", c["time_step"] and ids[:1] == [log_new] and log_old in ids
      and ids.index(strong_log) < ids.index(log_old), ids)

s, c = step("check cf target before cf push to the right org and space")
check("with no project, the shared lessons are read", any(i["tier"] == "knowledge" and "cf target" in i["text"]
                                                          for i in c["items"]), c["items"])

add("Release checklist: " + "release checklist gcloud rollout verify " * 30, "knowledge", "ticketing-system",
    topic="release")
s, c = step("release checklist gcloud rollout verify", project="ticketing-system", budget_chars=500)
check("the pack stops at its budget", c["used_chars"] <= 500 and c["cut_at_budget"] and c["count"] >= 1, c)
check("the item that did not fit is cut, and says so", c["items"] and c["items"][-1].get("truncated"), c["items"])

# ── 3b. open threads (2026-10-04) ──────────────────────────────────────────
client.post("/entities", json={"project": "ticketing-system", "name": "SLA Engine", "type": "system",
                               "role": "computes SLA deadlines"}, headers=ANA)
client.post("/entities", json={"project": "ticketing-system", "name": "Hugh Le", "type": "person",
                               "role": "product owner", "relations": [{"rel": "owns", "target": "SLA Engine"}]},
            headers=ANA)
s, c = step("who is Hugh Le", project="ticketing-system")
kinds = {t["kind"]: t for t in c["open_threads"]}
check("a relation target without its card is an open thread",
      "SLA Engine" in kinds.get("entity-not-loaded", {}).get("names", []), c["open_threads"])
check("the card that IS packed is not listed as a thread",
      "Hugh Le" not in kinds.get("entity-not-loaded", {}).get("names", []), c["open_threads"])
check("the pack reports its best score", isinstance(c.get("best_score"), (float, type(None))), c.get("best_score"))

s, c = step("ticket hang fixed PR merged deployed", project="ticketing-system")
kinds = {t["kind"]: t for t in c["open_threads"]}
check("a ticket id in a packed row is listed as a reference", "CS-294" in kinds.get("reference-not-looked-up", {})
      .get("refs", []), c["open_threads"])
check("a project log newer than the packed log rows is an open thread",
      kinds.get("newer-log", {}).get("ts", "") >= "2026-09-30", c["open_threads"])

add("SLA filters were reworked on the ticketing portal.", "knowledge", "ticketing-system", topic="sla")
s, c = step("SLA filters reworked on the ticketing portal", project="ticketing-system")
kinds = {t["kind"]: t for t in c["open_threads"]}
check("knowledge close enough: the skipped log rows are an open thread",
      "log" not in [i["tier"] for i in c["items"]] and kinds.get("log-skipped", {}).get("count", 0) >= 1, c["open_threads"])
s, c2 = step("SLA filters reworked on the ticketing portal", project="ticketing-system", include_log=True)
check("include_log packs the log even when knowledge is close",
      "log" in [i["tier"] for i in c2["items"]] and "log-skipped" not in {t["kind"] for t in c2["open_threads"]},
      c2["open_threads"])

add("Release checklist two: " + "release checklist gcloud rollout verify " * 30, "knowledge", "ticketing-system",
    topic="release")
s, c = step("release checklist gcloud rollout verify", project="ticketing-system", budget_chars=500)
kinds = {t["kind"]: t for t in c["open_threads"]}
check("rows left out at the budget are listed with ids",
      "cut-at-budget" in kinds and kinds["cut-at-budget"]["count"] >= 1 and kinds["cut-at-budget"]["ids"], c["open_threads"])

# ── 3c. daily tier (roadmap E slice S12) ───────────────────────────────────
# The daily capability is simulated: its table is migrated and it is marked loaded only for this section.
from app import caps, sqldb  # noqa: E402
from app.caps import daily  # noqa: E402

for i in range(6):                            # more recent rows on 2026-09-28 than the summary leaves room for
    add(f"Worklog 2026-09-28 item {i}: CS-29{i} small fix shipped.", "log", "ticketing-system",
        topic="cs", ts=f"2026-09-28T1{i}:00:00Z")
DATED = "what was done on 2026-09-28 and did it reach production"
base_s, base = step(DATED, project="ticketing-system")
check("S12 baseline: 7 log-recent rows on the dated day, no daily tier",
      base_s == 200 and "daily" not in base["tiers"]
      and sum(i["tier"] == "log-recent" for i in base["items"]) == 7, base)
with sqldb.connect() as conn:
    sqldb.ensure_core(conn)
    daily.init(conn)
    for day, text in (("2026-09-28", "Done: CS-294 hang fixed and deployed.\nDecided: -\nBroken or open: -\nWho: Dev."),):
        conn.execute("INSERT INTO kh_daily (ns, project, day, rev, mode, text, source_ids_json, built_from_ms, model,"
                     " cost_usd, created_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                     [daily.NS, "ticketing-system", day, 1, "llm", text, "[]", 0, "test", 0.0, 0])
    conn.commit()

os.environ["KH_STEP_DAILY"] = "1"             # flag on, capability still off: unchanged
s, c = step(DATED, project="ticketing-system")
check("S12 capability off (flag on): the response is unchanged",
      s == 200 and c["items"] == base["items"] and c["tiers"] == base["tiers"], c["tiers"])
caps._loaded["daily"] = daily
os.environ["KH_STEP_DAILY"] = "0"
s, c = step(DATED, project="ticketing-system")
check("S12 capability on, KH_STEP_DAILY=0: the response is unchanged",
      s == 200 and c["items"] == base["items"], c["tiers"])
os.environ["KH_STEP_DAILY"] = "1"
s, c = step(DATED, project="ticketing-system")
tiers = [i["tier"] for i in c["items"]]
check("S12 on: a dated time step gets the day's summary as tier daily",
      s == 200 and [i["id"] for i in c["items"] if i["tier"] == "daily"] == ["daily:ticketing-system:2026-09-28"]
      and "CS-294 hang fixed" in c["items"][tiers.index("daily")]["text"], c["items"])
check("S12 on: daily comes before log-recent", "daily" in tiers and "log-recent" in tiers
      and tiers.index("daily") < tiers.index("log-recent"), tiers)
check("S12 on: log-recent drops to 4 rows when a summary exists", tiers.count("log-recent") == 4, tiers)
s, c = step("what was done on 2026-09-27", project="ticketing-system")
check("S12 on: a day without a summary keeps the old pack (no daily tier)", s == 200 and "daily" not in c["tiers"],
      c["tiers"])
s, c = step("ticket hang fixed PR merged deployed", project="ticketing-system")
check("S12 on: a step that is not about time gets no daily tier", s == 200 and "daily" not in c["tiers"], c["tiers"])
s, c = step(DATED)
check("S12 on: no project, no daily tier", s == 200 and "daily" not in c["tiers"], c["tiers"])
# a time word: the newest summary of the last 7 local days
_, tz = daily.project_tz("ticketing-system")
yday = (daily.local_day(daily._now_ms(), tz) - daily.timedelta(days=1)).isoformat()
with sqldb.connect() as conn:
    conn.execute("INSERT INTO kh_daily (ns, project, day, rev, mode, text, source_ids_json, built_from_ms, model,"
                 " cost_usd, created_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                 [daily.NS, "ticketing-system", yday, 1, "llm", "Done: SLA filters shipped.\nWho: Dev.", "[]", 0,
                  "test", 0.0, 0])
    conn.commit()
s, c = step("what happened yesterday on the portal", project="ticketing-system")
check("S12 on: a time word reads the newest summary (yesterday)",
      s == 200 and [i["id"] for i in c["items"] if i["tier"] == "daily"] == [f"daily:ticketing-system:{yday}"],
      [(i["tier"], i["id"]) for i in c["items"]])
s, c = step(DATED, who=BEN, project="ticketing-system")
check("S12 on: a reader of the project gets the summary too", s == 200 and "daily" in c["tiers"], s)
caps._loaded.pop("daily", None)
os.environ.pop("KH_STEP_DAILY", None)

# ── 4. access ──────────────────────────────────────────────────────────────
s, c = step("Vincent Cao deploy", who=BEN, project="secret-deal")
check("an unreadable project is a 403", s == 403, s)
s, c = step("Vincent Cao falcon negotiator", who=BEN)
check("no project: other projects' cards stay out", s == 200 and "falcon" not in str(c["items"]), c)
check("no project: unreadable lessons stay out", all(i["tier"] != "knowledge" or "cf target" not in i["text"]
                                                     for i in c["items"]), c["items"])
s, _ = step("anything", who={})
check("sign-in is required", s == 401, s)

print(f"\n{'ALL PASS' if not FAILURES else 'FAILED'}  ({len(FAILURES)} failed)")
sys.exit(1 if FAILURES else 0)
