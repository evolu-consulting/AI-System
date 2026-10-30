"""Contract test of step outcomes (app/caps/outcomes.py, docs/roadmap-e-to-5-design.md 5.2, slice S7).

  1. OFF (KH_CAP_OUTCOMES unset): /context/step and /turn/context carry no serve_id, nothing is logged,
     /step/outcome answers 404.
  2. ON: serve_id returned, kh.served written in the background into kh_people (item ids, session header, caller,
     key, withheld ids); the rest of the answer is unchanged; a failing or slow writer never reaches the request.
  3. only_tiers / with_items: maintainers only, the budget goes to the kept tiers, candidates are packed in the
     distilled tier, a bench call logs no serve.
  4. POST /step/outcome: caller binding, label precedence (corrected > failed > done, a model never overrides a
     code signal, the 24 h window), duplicates, masking and error_kind, metric step.success.
  5. GET /step/outcomes: maintainers only.

Run:  .venv\\Scripts\\python tests\\caps\\test_outcomes.py
"""
import os
import time

from harness import H  # noqa: I001  (must be first: throwaway db, sign-in on)

from fastapi.testclient import TestClient  # noqa: E402

from app import distill as kh_distill  # noqa: E402
from app import entities as kh_entities  # noqa: E402
from app import sqldb, step, turn  # noqa: E402
from app.caps import outcomes, people  # noqa: E402

MAINT = H.person("fen@x.io", maintainer=True)
ANA = H.person("ana@x.io", member=["alpha"])
BOB = H.person("bob@x.io", member=["alpha"])
for k in ("KH_CAP_PEOPLE", "KH_CAP_OUTCOMES"):
    os.environ.pop(k, None)

# ── stubbed reads: the pack logic is real, the stores are not ────────────────
KNOW = [{"vector_id": f"k{i}", "score": 0.9 - i * 0.05, "source_text": f"knowledge row {i} " + "x" * 900,
         "metadata": {"project": "alpha"}} for i in range(4)]
KNOW.append({"vector_id": "dk_bymeaning1", "score": 0.6, "source_text": "a distilled item found by meaning",
             "metadata": {"project": "alpha"}})
DK = [{"id": "dk_aaa111", "kind": "lesson", "action": "deploy", "context": "ci", "title": "t",
       "text": "always pin the runner image", "status": "active"}]
SERVED_RET = [(DK, "action+context")]


async def by_meaning(text, scope, project, k, model):
    return [dict(h) for h in KNOW] if scope == "knowledge" and project == "alpha" else []


class _Res:
    hits = []


async def recent(**kw):
    return _Res()


step._by_meaning = by_meaning
kh_entities.match = lambda text, scope, limit: []
kh_distill.served = lambda *a, **kw: SERVED_RET[0]
kh_distill.contexts = lambda project: []
turn.project_part = lambda text, visible: {"best": "alpha", "ambiguous": False, "weak_only": False,
                                           "matches": [{"project": "alpha", "term": "alpha", "on": "name"}]}
turn.actions_part = lambda p: []
turn.findings_part = lambda p: []
turn.entities_part = lambda text, p, visible: []


async def _no_near(text, project, model, withheld=None):
    return ["dk_near01 (0.8): a near item"]


async def _lessons(text, model, withheld=None):
    return [{"id": "ll_1", "score": 0.7, "title": "a lesson"}]


turn.near_part = _no_near
turn.lessons_part = _lessons


def make_app():
    app = H.app()
    app.state.model = None
    turn.attach(app)
    step.attach(app, recent)
    return app


def served_row(serve_id, wait=5.0):
    end = time.time() + wait
    while time.time() < end:
        with sqldb.connect() as c:
            r = c.execute("SELECT * FROM kh_event WHERE ns=? AND id=? AND kind='kh.served'",
                          [people.NS, serve_id]).fetchone()
        if r is not None:
            return r
        time.sleep(0.05)
    return None


def count(kind):
    with sqldb.connect() as c:
        try:
            return c.execute("SELECT COUNT(*) FROM kh_event WHERE ns=? AND kind=?", [people.NS, kind]).fetchone()[0]
        except Exception:  # noqa: BLE001 - table not there yet
            return 0


STEP = {"text": "deploy the runner", "project": "alpha", "action": "deploy", "context": "ci"}
SESSION = {"X-KH-Session": "sess-1"}

# ── 1. off ───────────────────────────────────────────────────────────────────
H.check("outcomes declares DEFAULT_ON = False", outcomes.DEFAULT_ON is False)
os.environ["KH_CAP_PEOPLE"] = "on"                     # people on, outcomes off: answers still unchanged
with TestClient(make_app()) as off:
    r_off = off.post("/context/step", json=STEP, headers={**ANA, **SESSION})
    t_off = off.get("/turn/context", params={"text": "deploy alpha", "action": "deploy", "context": "ci"},
                    headers={**ANA, **SESSION})
    H.check("OFF: /context/step answers without serve_id", r_off.status_code == 200 and "serve_id" not in r_off.json(),
            r_off.text[:300])
    H.check("OFF: /turn/context answers without serve_id", t_off.status_code == 200 and "serve_id" not in t_off.json(),
            t_off.text[:300])
    H.check("OFF: /step/outcome is not attached (404)",
            off.post("/step/outcome", json={"serve_ids": ["sv_x"], "outcome": "done", "source": "stop"},
                     headers=ANA).status_code == 404)
    time.sleep(0.2)
    H.check("OFF: nothing is logged", count("kh.served") == 0)

# ── 2. on ────────────────────────────────────────────────────────────────────
os.environ["KH_CAP_OUTCOMES"] = "on"
app = make_app()
with TestClient(app) as c:
    H.check("ON: outcomes is attached and enabled", outcomes.enabled())
    r = c.post("/context/step", json=STEP, headers={**ANA, **SESSION})
    body = r.json()
    sid = body.get("serve_id")
    H.check("ON: /context/step returns a serve_id", r.status_code == 200 and isinstance(sid, str)
            and sid.startswith("sv_"), r.text[:300])
    H.check("ON: the rest of the step answer is unchanged",
            {k: v for k, v in body.items() if k != "serve_id"} == r_off.json())
    row = served_row(sid)
    H.check("ON: kh.served is written into kh_people with id = serve_id", row is not None)
    import json
    sb = json.loads(row["body_json"]) if row is not None else {}
    H.check("kh.served body: project, key, session, caller, route",
            sb.get("project") == "alpha" and sb.get("action") == "deploy" and sb.get("context") == "ci"
            and sb.get("session") == "sess-1" and sb.get("caller") == "ana@x.io" and sb.get("route") == "step", sb)
    H.check("kh.served body: item_ids are the packed ids, withheld_ids empty",
            sb.get("item_ids") == [i["id"] for i in body["items"]] and "dk_aaa111" in sb["item_ids"]
            and sb.get("withheld_ids") == [], sb)
    H.check("kh.served row: session column and key index columns",
            row["session_id"] == "sess-1" and row["ix_s1"] == "deploy" and row["ix_s2"] == "ci")
    H.check("kh.served row: unit_id = session (the stage F rollback watch reads it)", row["unit_id"] == "sess-1",
            row["unit_id"])

    t = c.get("/turn/context", params={"text": "deploy alpha", "action": "deploy", "context": "ci"},
              headers={**ANA, **SESSION})
    tb = t.json()
    H.check("ON: /turn/context returns a serve_id, the rest unchanged",
            t.status_code == 200 and tb.get("serve_id", "").startswith("sv_")
            and {k: v for k, v in tb.items() if k != "serve_id"} == t_off.json(), t.text[:300])
    trow = served_row(tb.get("serve_id", ""))
    tsb = json.loads(trow["body_json"]) if trow is not None else {}
    H.check("turn kh.served: distilled, near and lesson ids", tsb.get("route") == "turn"
            and tsb.get("item_ids") == ["dk_aaa111", "dk_near01", "ll_1"], tsb)

    SERVED_RET[0] = (DK, "action+context", ["dk_held99"])            # slice S11 shape: withheld ids
    r3 = c.post("/context/step", json=STEP, headers={**ANA, **SESSION})
    w = served_row(r3.json().get("serve_id", ""))
    H.check("withheld ids from distill.served reach kh.served (and the pack still builds)",
            r3.status_code == 200 and w is not None and json.loads(w["body_json"])["withheld_ids"] == ["dk_held99"])
    SERVED_RET[0] = (DK, "action+context")

    # fire and forget: a failing or slow writer never reaches the request
    orig = outcomes.write_served

    def boom(body):
        raise RuntimeError("store down")
    outcomes.write_served = boom
    r4 = c.post("/context/step", json=STEP, headers=ANA)
    H.check("a failing kh.served write never raises into the request",
            r4.status_code == 200 and r4.json().get("serve_id"), r4.text[:200])

    def slow(body):
        time.sleep(1.5)
    outcomes.write_served = slow
    t0 = time.time()
    r5 = c.post("/context/step", json=STEP, headers=ANA)
    H.check("the kh.served write is not awaited by the request", r5.status_code == 200 and time.time() - t0 < 1.2,
            time.time() - t0)
    outcomes.write_served = orig
    orig_enabled = outcomes.enabled
    outcomes.enabled = lambda: (_ for _ in ()).throw(RuntimeError("x"))
    out = {}
    outcomes.note_served(None, out, "step", "alpha", None, None, [])
    H.check("note_served never raises, even when its own check fails", out == {})
    outcomes.enabled = orig_enabled

    # ── 3. only_tiers / with_items ───────────────────────────────────────────
    H.check("without only_tiers a dk_ row found by meaning stays in the knowledge tier",
            any(i["id"] == "dk_bymeaning1" and i["tier"] == "knowledge"
                for i in c.post("/context/step", json={**STEP, "budget_chars": 40000}, headers=ANA).json()["items"]))
    time.sleep(0.3)
    before = count("kh.served")
    b = c.post("/context/step", json={**STEP, "only_tiers": ["entity", "distilled"], "budget_chars": 4000},
               headers=MAINT).json()
    H.check("only_tiers: only the kept tiers are packed",
            b.get("items") and {i["tier"] for i in b["items"]} <= {"entity", "distilled"}, b.get("tiers"))
    H.check("only_tiers: the other tiers cost no budget", b["used_chars"] == sum(len(i["text"]) for i in b["items"])
            and b["used_chars"] < 1000 and not b["cut_at_budget"], b["used_chars"])
    H.check("only_tiers: a distilled item found by meaning is packed as distilled (the p1bench shape)",
            any(i["id"] == "dk_bymeaning1" and i["tier"] == "distilled" for i in b["items"]), b.get("items"))
    H.check("only_tiers: a bench call returns no serve_id", "serve_id" not in b)
    full = c.post("/context/step", json={**STEP, "only_tiers": ["knowledge"], "budget_chars": 1000},
                  headers=MAINT).json()
    H.check("only_tiers: the budget still applies to the kept tiers",
            {i["tier"] for i in full["items"]} == {"knowledge"} and full["used_chars"] <= 1000, full.get("used_chars"))
    H.check("only_tiers: a member is refused (403)",
            c.post("/context/step", json={**STEP, "only_tiers": ["entity"]}, headers=ANA).status_code == 403)
    H.check("only_tiers: an unknown tier is a 422",
            c.post("/context/step", json={**STEP, "only_tiers": ["bogus"]}, headers=MAINT).status_code == 422)
    wi = c.post("/context/step", json={**STEP, "with_items": [{"id": "dk_cand01", "text": "candidate lesson"}]},
                headers=MAINT).json()
    cand = [i for i in wi.get("items", []) if i["id"] == "dk_cand01"]
    order = [i["id"] for i in wi.get("items", [])]
    H.check("with_items: the candidate is packed in the distilled tier after the keyed items",
            cand and cand[0]["tier"] == "distilled" and cand[0].get("injected") is True
            and order.index("dk_aaa111") < order.index("dk_cand01"), order)
    H.check("with_items: a member is refused (403)",
            c.post("/context/step", json={**STEP, "with_items": [{"id": "x", "text": "y"}]},
                   headers=ANA).status_code == 403)
    time.sleep(0.3)
    H.check("bench calls log no kh.served", count("kh.served") == before)

    # ── 4. POST /step/outcome ────────────────────────────────────────────────
    def label(ids, outcome, source, who=ANA, error=None):
        payload = {"serve_ids": ids, "outcome": outcome, "source": source}
        if error is not None:
            payload["error"] = error
        res = c.post("/step/outcome", json=payload, headers=who)
        return res.status_code, res.json()

    def fresh(who=ANA, session="sess-2"):
        x = c.post("/context/step", json=STEP, headers={**who, "X-KH-Session": session}).json()["serve_id"]
        served_row(x)
        return x

    s1 = fresh()
    st, res = label([s1, "sv_unknown"], "done", "stop", who=BOB)
    H.check("caller binding: another person's serve is forbidden, an unknown one unknown",
            st == 200 and [x["status"] for x in res["results"]] == ["forbidden", "unknown"] and res["applied"] == 0, res)
    st, res = label([s1], "done", "stop")
    H.check("done (stop) applied", res["results"][0]["status"] == "applied", res)
    st, res = label([s1], "done", "stop")
    H.check("the same label again is a duplicate", res["results"][0]["status"] == "duplicate", res)
    st, res = label([s1], "done", "model")
    H.check("a model's done never overrides a code signal", res["results"][0]["status"] == "code_signal_wins", res)
    st, res = label([s1], "failed", "tool", error="Traceback: File /srv/app/x.py line 12: KeyError 'abc' "
                                                    "password=Hunter2Secret!\nsecond line")
    r0 = res["results"][0]
    H.check("failed (tool) overrides done", r0["status"] == "applied" and len(r0.get("error_kind", "")) == 12, res)
    with sqldb.connect() as cx:
        ev = cx.execute("SELECT body_json, ix_s1, session_id FROM kh_event WHERE ns=? AND id=?",
                        [people.NS, outcomes.label_id("failed", "tool", s1)]).fetchone()
    eb = json.loads(ev["body_json"])
    H.check("the error line is masked, first line only, <= 300 chars",
            "Hunter2Secret" not in eb["error"] and "[REDACTED:" in eb["error"] and "second line" not in eb["error"]
            and len(eb["error"]) <= 300, eb)
    H.check("step.outcome: error_kind indexed, session and key carried",
            ev["ix_s1"] == eb["error_kind"] and ev["session_id"] == "sess-2" and eb["action"] == "deploy", dict(ev))
    st, res = label([s1], "done", "stop")
    H.check("a lower label is ignored (done after failed)", res["results"][0]["status"] == "lower_precedence", res)
    st, res = label([s1], "corrected", "correction")
    H.check("corrected overrides failed", res["results"][0]["status"] == "applied", res)
    st, res = label([s1], "failed", "tool")
    H.check("failed after corrected is ignored", res["results"][0]["status"] == "lower_precedence", res)
    with sqldb.connect() as cx:              # redaction may mask the body's serve_id: the event id still holds it
        cx.execute("UPDATE kh_event SET body_json=? WHERE ns=? AND id=?",
                   [json.dumps({"serve_id": "[REDACTED:high_entropy]", "outcome": "corrected", "source": "correction"}),
                    people.NS, outcomes.label_id("corrected", "correction", s1)])
    st, res = label([s1], "failed", "tool")
    H.check("a masked body serve_id still ranks the label (read from the event id)",
            res["results"][0]["status"] == "lower_precedence", res)
    so = c.get("/step/outcomes", params={"session": "sess-2"}, headers=MAINT).json()
    H.check("/step/outcomes shows the real serve_id even when the body copy is masked",
            all(e["body"]["serve_id"] != "[REDACTED:high_entropy]" for e in so.get("outcomes", [])), so)

    s2 = fresh()
    st, res = label([s2], "done", "model")
    H.check("a model's done on an unlabelled serve applies", res["results"][0]["status"] == "applied", res)
    st, res = label([s2], "done", "stop")
    H.check("a code signal of the same rank replaces the model's label", res["results"][0]["status"] == "applied", res)

    now = int(time.time() * 1000)
    H.check("the 24 h window: an older label is final",
            outcomes.decide({"outcome": "done", "source": "stop", "ts_ms": now - 25 * 3600 * 1000}, "failed", "tool",
                            now, 24 * 3600 * 1000) == "window_closed")

    k1 = outcomes.error_kind("alpha", "deploy", "ci", "File /a/b.py line 12: KeyError 0xdeadbeef in run_77ab")
    k2 = outcomes.error_kind("alpha", "deploy", "ci", "File C:\\x\\y.py line 99: KeyError 0x1234abcd in run_12cd")
    k3 = outcomes.error_kind("alpha", "build", "ci", "File /a/b.py line 12: KeyError 0xdeadbeef in run_77ab")
    H.check("error_kind: digits, paths, ids and hex stripped; the key is part of it", k1 == k2 and k1 != k3,
            (k1, k2, k3))

    with sqldb.connect() as cx:
        vals = [float(x[0]) for x in cx.execute(
            "SELECT val FROM kh_metric WHERE ns=? AND series='step.success' AND unit_id='sess-2' ORDER BY ts_ms",
            [people.NS]).fetchall()]
        dims = cx.execute("SELECT dims_json, project FROM kh_metric WHERE ns=? AND series='step.success' LIMIT 1",
                          [people.NS]).fetchone()
    H.check("step.success: 1 for done, 0 otherwise, one per applied label, unit = session",
            vals == [1.0, 0.0, 0.0, 1.0, 1.0], vals)
    H.check("step.success: dims project/action/context",
            json.loads(dims["dims_json"]) == {"project": "alpha", "action": "deploy", "context": "ci"}
            and dims["project"] == "alpha", dict(dims))
    H.check("an invalid outcome is a 422", label([s2], "maybe", "stop")[0] == 422)
    H.check("sign-in is required", c.post("/step/outcome", json={"serve_ids": [s2], "outcome": "done",
                                                                 "source": "stop"}).status_code == 401)

    # ── 5. GET /step/outcomes ────────────────────────────────────────────────
    g = c.get("/step/outcomes", params={"session": "sess-2"}, headers=MAINT)
    gb = g.json()
    H.check("GET /step/outcomes: a maintainer reads the session's serves and labels",
            g.status_code == 200 and {e["id"] for e in gb["served"]} >= {s1, s2} and len(gb["outcomes"]) == 5, g.text[:300])
    H.check("GET /step/outcomes: a member is refused",
            c.get("/step/outcomes", params={"session": "sess-2"}, headers=ANA).status_code == 403)

for k in ("KH_CAP_PEOPLE", "KH_CAP_OUTCOMES"):
    os.environ.pop(k, None)
H.done()
