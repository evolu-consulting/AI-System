"""Contract test of the learning loop (app/caps/learn.py, docs/roadmap-e-to-5-design.md 5.3-5.4, slice S11).

  1. OFF by default: DEFAULT_ON False, KH_LEARN_MODE off, aliases shadow -> trial and on -> auto.
  2. ARMS: stable per (item, session), 50 +- 5% over 2,000 sessions.
  3. WITHHOLDING through the real distill.served: only trial items, only in trial/auto, only with a session; the
     withheld ids come back as the third value; a key emptied by withholding falls to the next key; the
     X-KH-Session header reaches the context variable through the middleware.
  4. OFFLINE GATE: pass (trial, dk row active), leak, lint, evidence, contradiction (contested), bench hook.
  5. THE RULE (pure): non-inferior accept, harm withdraw (stage F D12 via metrics.evaluate), continue below n and
     when inconclusive, the cap (accept / no_effect), the token guard.
  6. PLANTED EFFECTS end to end (kh.served + /step/outcome labels in kh_people): a lesson that truly helps
     (+15 pp) is accepted, one that truly harms (-15 pp) is withdrawn (kh_item and dk row), one with no effect
     stays in trial. Mode trial only recommends; mode auto applies.
  7. ROUTES: /learn/propose (D's submit checks, enrolment), /learn/trials and /learn/decide (maintainers).

Run:  .venv\\Scripts\\python tests\\caps\\test_learn.py
"""
import hashlib
import os
import re
import time

from harness import H  # noqa: I001  (must be first: throwaway db, sign-in on)

import numpy  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import config, distill, sqldb  # noqa: E402
from app.caps import items, learn, outcomes, people  # noqa: E402
from app.policy_actions import store as policy_store  # noqa: E402

MAINT = H.person("fen@x.io", maintainer=True)
ANA = H.person("ana@x.io", member=["alpha"])
for k in ("KH_CAP_LEARN", "KH_LEARN_MODE"):
    os.environ.pop(k, None)


def enc(text):
    v = numpy.zeros(64, dtype="float32")
    for w in re.findall(r"\w+", (text or "").lower()):
        v[int(hashlib.md5(w.encode()).hexdigest(), 16) % 64] += 1.0
    n = float(numpy.linalg.norm(v)) or 1.0
    return (v / n).tolist()


class _Model:
    @staticmethod
    def encode(text, normalize_embeddings=True):
        return numpy.array(enc(text))


def set_mode(m):
    if m is None:
        os.environ.pop("KH_LEARN_MODE", None)
    else:
        os.environ["KH_LEARN_MODE"] = m
    learn.invalidate()


def dk_row(project, iid, action, context, text, status="active", sources=("log1", "log2"), by="worker:test"):
    distill._write(project, {"id": iid, "kind": "lesson", "action": action, "context": context, "entities": [],
                             "title": text[:40], "text": text, "sources": list(sources), "dkey": iid,
                             "distilled_by": by, "status": status}, enc)


def dk_status(project, iid):
    got = learn._dk(project, iid)
    return got and got["status"]


# ── 1. off by default ────────────────────────────────────────────────────────
H.check("learn declares DEFAULT_ON = False", learn.DEFAULT_ON is False)
H.check("KH_LEARN_MODE defaults to off", learn.mode() == "off")
set_mode("shadow")
H.check("mode alias shadow -> trial", learn.mode() == "trial")
set_mode("on")
H.check("mode alias on -> auto", learn.mode() == "auto")
set_mode("bogus")
H.check("an unknown mode is off", learn.mode() == "off")
set_mode(None)

os.environ["KH_CAP_PEOPLE"] = "on"
os.environ["KH_CAP_OUTCOMES"] = "on"
with TestClient(H.app()) as off_client:
    r = off_client.get("/learn/trials", headers=MAINT)
    H.check("KH_CAP_LEARN unset: /learn/trials is not attached", r.status_code == 404, r.status_code)
H.check("KH_CAP_LEARN unset: split_trial withholds nothing",
        learn.split_trial([{"id": "x"}], "s1") == ([{"id": "x"}], []))

os.environ["KH_CAP_LEARN"] = "on"
app = H.app()
app.state.model = _Model()


@app.get("/_test/session")
async def _echo_session():
    return {"session": learn.current_session()}


client = TestClient(app)
client.__enter__()
H.check("kh_people is active", people.active())

# ── 2. arms ──────────────────────────────────────────────────────────────────
arms = [learn.arm("dk_x", "salt", f"sess-{i}") for i in range(2000)]
share = sum(arms) / len(arms)
H.check("arm split is 50 +- 5% over 2,000 sessions", 0.45 <= share <= 0.55, share)
H.check("arm is stable per session", all(learn.arm("dk_x", "salt", f"sess-{i}") == arms[i] for i in range(200)))
H.check("another item (or salt) randomizes independently",
        [learn.arm("dk_y", "salt", f"sess-{i}") for i in range(200)] != arms[:200])

# ── 3. withholding through distill.served ────────────────────────────────────
P = "alpha"
LT, LN, LF = "dk_trial0001", "dk_plain0001", "dk_fallbk001"
dk_row(P, LT, "deploy", "ci", "Pin the runner image before a deploy")
dk_row(P, LN, "deploy", "ci", "Run the smoke test after a deploy")
dk_row(P, "dk_only00001", "release", "web", "Tag the release before the build")
dk_row(P, LF, "release", "-", "Write the changelog before a release")
for iid, key in ((LT, ("deploy", "ci")), ("dk_only00001", ("release", "web"))):
    got = learn.enroll(P, {"id": iid, "action": key[0], "context": key[1], "text": "Pin it", "title": ""},
                       "distill", ["log1", "log2"])
    it = got["item"]
    learn._set_attrs(iid, it["rev"], {**it["attrs"], "trial_state": "trial", "opened_ms": int(time.time() * 1000)})
salt = learn.get(LT)["attrs"]["arm_salt"]
s0 = next(f"s-{i}" for i in range(100) if learn.arm(LT, salt, f"s-{i}") == 0)
s1 = next(f"s-{i}" for i in range(100) if learn.arm(LT, salt, f"s-{i}") == 1)


def served_in(session, action="deploy", context="ci"):
    tok = learn._session.set(session)
    try:
        return distill.served(P, action, context, None, 10)
    finally:
        learn._session.reset(tok)


set_mode("record")
r = served_in(s0)
H.check("mode record: nothing withheld (two values)", len(r) == 2 and {i["id"] for i in r[0]} == {LT, LN}, r)
set_mode("trial")
r = served_in(s0)
H.check("trial, control session: the trial lesson is withheld, the plain one served, ids returned",
        len(r) == 3 and [i["id"] for i in r[0]] == [LN] and r[2] == [LT], r)
r = served_in(s1)
H.check("trial, served session: both served, unchanged shape", len(r) == 2 and {i["id"] for i in r[0]} == {LT, LN}, r)
r = served_in(None)
H.check("no session: everything served, nothing counted", len(r) == 2 and {i["id"] for i in r[0]} == {LT, LN})
H.check("outcomes.split_served reads the third value", outcomes.split_served(served_in(s0))[1] == [LT])
salt2 = learn.get("dk_only00001")["attrs"]["arm_salt"]
s_ctl = next(f"q-{i}" for i in range(100) if learn.arm("dk_only00001", salt2, f"q-{i}") == 0)
r = served_in(s_ctl, "release", "web")
H.check("a key emptied by withholding falls to the next key (action only)",
        len(r) == 3 and r[1] == "action" and LF in [i["id"] for i in r[0]] and r[2] == ["dk_only00001"], r)
H.check("a non-trial item is never withheld", learn.split_trial([{"id": LN}], s0) == ([{"id": LN}], []))
set_mode("auto")
H.check("auto withholds too", served_in(s0)[2] == [LT])
set_mode("trial")
echo = client.get("/_test/session", headers={**MAINT, "X-KH-Session": "sess-hdr"}).json()
H.check("the X-KH-Session header reaches the context variable", echo == {"session": "sess-hdr"}, echo)
H.check("the context variable is reset after the request", learn.current_session() is None)
# by meaning (step knowledge tier, turn near/lessons): the same arm as the key read (S15 dev check 2026-10-11)
hits = [{"vector_id": LT, "score": 0.9}, {"vector_id": LN, "score": 0.8}]
held = [LT]
got = learn.withhold(hits, lambda h: h["vector_id"], held, session=s0)
H.check("by meaning, control session: the trial lesson is withheld too, its id recorded once",
        [h["vector_id"] for h in got] == [LN] and held == [LT], (got, held))
H.check("by meaning, served session: unchanged", learn.withhold(hits, lambda h: h["vector_id"], [], session=s1) == hits)
H.check("by meaning, no session: unchanged", learn.withhold(hits, lambda h: h["vector_id"], []) == hits)
import inspect  # noqa: E402
from app import step as kh_step, turn as kh_turn  # noqa: E402
H.check("step's knowledge tier and turn's near/lesson lines go through learn.withhold",
        "learn.withhold(" in inspect.getsource(kh_step._build)
        and "learn.withhold(" in inspect.getsource(kh_turn.near_part)
        and "learn.withhold(" in inspect.getsource(kh_turn.lessons_part))

# ── 4. offline gate ──────────────────────────────────────────────────────────


def serve(session, caller, action, context, project=P, ids=(), withheld=()):
    sid = outcomes.new_serve_id()
    outcomes.write_served({"serve_id": sid, "route": "step", "project": project, "action": action,
                           "context": context, "item_ids": list(ids), "withheld_ids": list(withheld),
                           "session": session, "caller": caller})
    return sid


def candidate(iid, text, evidence, status="proposed", source="agent", sources=("log1",)):
    dk_row(P, iid, "build", "ci", text, status=status, sources=sources)
    return learn.enroll(P, {"id": iid, "action": "build", "context": "ci", "text": text, "title": text[:30]},
                        source, evidence)["item"]


ev_good = [serve("g-1", "ana@x.io", "build", "ci"), serve("g-2", "bob@x.io", "build", "ci")]
ev_one = [serve("g-3", "ana@x.io", "build", "ci"), serve("g-3", "ana@x.io", "build", "ci")]
candidate("dk_gate_ok01", "Cache the dependencies before the build", ev_good)
g = learn.gate("dk_gate_ok01", enc)
H.check("gate pass: trial_state trial, verdict stored", g["trial_state"] == "trial" and g["gate"]["ok"]
        and learn.get("dk_gate_ok01")["attrs"]["offline_gate"]["ok"], g)
H.check("gate pass: the dk row is active so the served arm gets it", dk_status(P, "dk_gate_ok01") == "active")
H.check("gate pass: opened_ms set, bench skipped without a hook",
        learn.get("dk_gate_ok01")["attrs"].get("opened_ms") and g["gate"]["checks"]["bench"].get("skipped"))
H.check("a gated item is in the trial cache", "dk_gate_ok01" in learn.trial_salts())
candidate("dk_gate_lk01", "Send the report to ana@example.com before the build", ev_good)
g = learn.gate("dk_gate_lk01", enc)
H.check("gate: the leak gate refuses", g["trial_state"] == "proposed" and not g["gate"]["checks"]["leak_lint"]["ok"]
        and g["gate"]["checks"]["leak_lint"]["leak"], g)
candidate("dk_gate_ln01", "Maybe cache the build output", ev_good)
g = learn.gate("dk_gate_ln01", enc)
H.check("gate: lint refuses a hedge", g["trial_state"] == "proposed" and g["gate"]["checks"]["leak_lint"]["lint"], g)
candidate("dk_gate_ev01", "Clean the workspace before the build", ev_one)
g = learn.gate("dk_gate_ev01", enc)
H.check("gate: one session of evidence is not enough", g["trial_state"] == "proposed"
        and not g["gate"]["checks"]["evidence"]["ok"], g)
candidate("dk_gate_ds01", "Lock the toolchain version for the build", [], source="distill", sources=("l1", "l2"))
H.check("gate: a distilled lesson with 2 sources has its evidence", learn.gate("dk_gate_ds01", enc)["trial_state"] == "trial")
candidate("dk_gate_ct01", "Skip the cache for the build", ev_good, status="contested")
g = learn.gate("dk_gate_ct01", enc)
H.check("gate: a contested dk row makes the candidate contested", g["trial_state"] == "contested"
        and learn.get("dk_gate_ct01")["status"] == "contested", g)
learn.BENCH[0] = lambda it: {"ok": False, "dropped": ["q7"]}
candidate("dk_gate_bn01", "Warm the cache before the build", ev_good)
g = learn.gate("dk_gate_bn01", enc)
H.check("gate: a bench regression refuses", g["trial_state"] == "proposed" and g["gate"]["checks"]["bench"]["dropped"]
        == ["q7"], g)
learn.BENCH[0] = None
H.check("gate: a gated candidate is not gated twice", learn.gate("dk_gate_ok01", enc).get("skipped") == "trial")

# ── 5. the rule (pure) ───────────────────────────────────────────────────────


def arm_values(prefix, n, rate):
    k = round(n * rate)
    return {f"{prefix}{i}": 1 if i < k else 0 for i in range(n)}


C = learn.DEFAULTS
e = learn.evaluate(arm_values("c", 40, 0.70), arm_values("s", 40, 0.85), 3, C)
H.check("rule: +15 pp at n = 40 per arm is accepted (non-inferior)", (e["decision"], e["reason"]) ==
        ("accept", "non_inferior") and e["lower_bound"] > -0.05, e)
e = learn.evaluate(arm_values("c", 90, 0.70), arm_values("s", 90, 0.55), 3, C)
H.check("rule: -15 pp at n = 90 per arm is withdrawn for harm (D12)", (e["decision"], e["reason"]) ==
        ("withdraw", "harm") and e["p"] < 0.05, e)
e = learn.evaluate(arm_values("c", 40, 0.70), arm_values("s", 40, 0.70), 3, C)
H.check("rule: no effect at n = 40 stays in trial (inconclusive)", (e["decision"], e["reason"]) ==
        ("continue", "inconclusive"), e)
e = learn.evaluate(arm_values("c", 20, 0.70), arm_values("s", 20, 0.95), 3, C)
H.check("rule: n = 20 per arm continues (insufficient)", (e["decision"], e["reason"]) == ("continue", "insufficient"), e)
e = learn.evaluate(arm_values("c", 40, 0.70), arm_values("s", 40, 0.55), 3, C)
H.check("rule: -15 pp at n = 40 is not yet significant harm: continue", e["decision"] == "continue", e)
e = learn.evaluate(arm_values("c", 100, 0.70), arm_values("s", 100, 0.70), 10, C)
H.check("rule: no effect at the cap (100 per arm) is accepted", (e["decision"], e["reason"]) == ("accept", "cap_reached"), e)
e = learn.evaluate(arm_values("c", 12, 0.70), arm_values("s", 12, 0.60), 46, C)
H.check("rule: a negative difference at 45 days is withdrawn (no_effect)", (e["decision"], e["reason"]) ==
        ("withdraw", "no_effect"), e)
e = learn.evaluate(arm_values("c", 40, 0.70), arm_values("s", 40, 0.85), 3, C,
                   ([1000.0] * 10, [1200.0] * 10))
H.check("rule: the token guard (+20% median tokens) blocks an accept", (e["decision"], e["reason"]) ==
        ("continue", "token_guard") and not e["tokens"]["ok"], e)
e = learn.evaluate(arm_values("c", 40, 0.70), arm_values("s", 40, 0.85), 3, C, ([1000.0] * 10, [1050.0] * 10))
H.check("rule: +5% tokens passes the guard", e["decision"] == "accept", e)

# ── 6. planted effects end to end ────────────────────────────────────────────
PLANT = {"dk_plant_hlp": ("lint", 40, 0.70, 0.85), "dk_plant_hrm": ("test", 90, 0.70, 0.55),
         "dk_plant_neu": ("review", 40, 0.70, 0.70)}
for iid, (action, *_rest) in PLANT.items():
    dk_row(P, iid, action, "repo", f"Check the {action} config first")
    it = learn.enroll(P, {"id": iid, "action": action, "context": "repo", "text": f"Check the {action} config first",
                          "title": ""}, "distill", ["l1", "l2"])["item"]
    learn._set_attrs(iid, it["rev"], {**it["attrs"], "trial_state": "trial",
                                      "opened_ms": int(time.time() * 1000) - 1000})
for iid, (action, n, p_ctl, p_srv) in PLANT.items():
    salt_i = learn.get(iid)["attrs"]["arm_salt"]
    want = {0: [], 1: []}
    k = 0
    while len(want[0]) < n or len(want[1]) < n:
        s = f"{iid}-sess-{k}"
        a = learn.arm(iid, salt_i, s)
        if len(want[a]) < n:
            want[a].append(s)
        k += 1
    for a, sessions in want.items():
        good = round(n * (p_srv if a == 1 else p_ctl))
        for j, s in enumerate(sessions):
            sid = serve(s, "", action, "repo", ids=[iid] if a == 1 else [], withheld=[] if a == 1 else [iid])
            if j % 3 == 0:          # a second, unlabelled pack in the same session: does not count
                serve(s, "", action, "repo")
            got = outcomes.record([sid], "done" if j < good else "failed", "stop" if j < good else "tool",
                                  None if j < good else "exit 1", "")
            assert got["applied"] == 1, got
serve("noise-1", "", "lint", "other-context")           # another key, never eligible

set_mode("trial")
res = learn.decide_all(ids=list(PLANT), encode=enc)
by = {r["item_id"]: r for r in res["items"]}
H.check("planted +15 pp: accept recommended", (by["dk_plant_hlp"]["decision"], by["dk_plant_hlp"]["n_served"],
                                               by["dk_plant_hlp"]["n_control"]) == ("accept", 40, 40), by["dk_plant_hlp"])
H.check("planted -15 pp: withdraw (harm) recommended", (by["dk_plant_hrm"]["decision"], by["dk_plant_hrm"]["reason"])
        == ("withdraw", "harm"), by["dk_plant_hrm"])
H.check("planted no effect: stays in trial", by["dk_plant_neu"]["decision"] == "continue", by["dk_plant_neu"])
H.check("mode trial applies nothing", all(learn.get(i)["attrs"]["trial_state"] == "trial"
                                          and learn.get(i)["status"] == "proposed" for i in PLANT)
        and dk_status(P, "dk_plant_hrm") == "active")
with sqldb.connect() as c:
    recs = [r["id"] for r in c.execute("SELECT id FROM kh_event WHERE ns=? AND kind='learn.decision'",
                                       [people.NS]).fetchall()]
H.check("mode trial writes the recommendations as learn.decision", {"lr_a_dk_plant_hlp", "lr_w_dk_plant_hrm"} <= set(recs),
        recs)

set_mode("auto")
res = learn.decide_all(ids=list(PLANT), encode=enc)
H.check("mode auto: the helpful lesson is accepted (kh_item active, trial closed)",
        learn.get("dk_plant_hlp")["status"] == "active" and learn.get("dk_plant_hlp")["attrs"]["trial_state"] == "accepted"
        and "dk_plant_hlp" not in learn.trial_salts())
H.check("mode auto: the harmful lesson is withdrawn (kh_item and dk row)",
        learn.get("dk_plant_hrm")["status"] == "withdrawn" and dk_status(P, "dk_plant_hrm") == "withdrawn")
H.check("mode auto: the neutral lesson is still in trial", learn.get("dk_plant_neu")["attrs"]["trial_state"] == "trial")
H.check("an accepted lesson is watched by the F8 rollback (guard_metric step.success, activated)",
        learn.get("dk_plant_hlp")["guard_metric"] == "step.success" and learn.get("dk_plant_hlp")["activated_ms"])
set_mode("trial")

# ── 7. routes ────────────────────────────────────────────────────────────────
policy_store.menu = lambda project: [{"action": "build"}, {"action": "deploy"}]
distill.contexts = lambda project: [{"tag": "ci"}]
ev = [serve("r-1", "ana@x.io", "build", "ci"), serve("r-2", "bob@x.io", "build", "ci")]
r = client.post("/learn/propose", headers=ANA, json={"project": P, "action": "build", "context": "ci",
                                                     "text": "Prune the stale artifacts before the build",
                                                     "evidence": {"serve_ids": ev}})
H.check("POST /learn/propose: D's checks pass, the lesson is enrolled", r.status_code == 200
        and r.json()["result"]["result"] == "accepted" and r.json()["trial"]["attrs"]["source"] == "agent", r.text[:400])
new_id = r.json()["result"]["id"] if r.status_code == 200 else ""
meta = (learn._dk(P, new_id) or {}).get("meta") or {}
H.check("the proposed dk row is 'proposed' and distilled_by agent:<caller>",
        dk_status(P, new_id) == "proposed" and meta.get("distilled_by") == "agent:ana@x.io", meta)
r = client.post("/learn/propose", headers=ANA, json={"project": P, "action": "build", "context": "ci",
                                                     "text": "Prune more", "evidence": {"serve_ids": ["sv_nope"]}})
H.check("POST /learn/propose: unknown evidence ids are refused by D's sources check",
        r.status_code == 200 and r.json()["result"]["result"] == "rejected" and "trial" not in r.json(), r.text[:300])
r = client.post("/learn/propose", headers=H.person("zed@x.io", member=["beta"]),
                json={"project": P, "text": "Prune", "evidence": {}})
H.check("POST /learn/propose needs project.write on the project", r.status_code == 403, r.status_code)
r = client.get("/learn/trials", headers=ANA)
H.check("GET /learn/trials is for maintainers", r.status_code == 403, r.status_code)
r = client.get("/learn/trials", headers=MAINT, params={"state": "trial"})
H.check("GET /learn/trials lists trials with arm sizes", r.status_code == 200 and any(
    t["id"] == "dk_plant_neu" and t["arms"] == {"control": 40, "served": 40} for t in r.json()["trials"]), r.text[:300])
r = client.post("/learn/decide", headers=ANA, json={"id": "dk_plant_neu", "decision": "reject"})
H.check("POST /learn/decide is for maintainers", r.status_code == 403, r.status_code)
r = client.post("/learn/decide", headers=MAINT, json={"id": "dk_plant_neu", "decision": "reject"})
H.check("POST /learn/decide reject: withdrawn in mode trial (fen confirms)", r.status_code == 200
        and learn.get("dk_plant_neu")["status"] == "withdrawn" and dk_status(P, "dk_plant_neu") == "withdrawn", r.text[:300])
r = client.post("/learn/decide", headers=MAINT, json={"id": "dk_plant_neu", "decision": "accept"})
H.check("POST /learn/decide on a closed trial: 409", r.status_code == 409, r.text[:200])
set_mode("off")
r = client.post("/learn/decide", headers=MAINT, json={"id": "dk_trial0001", "decision": "accept"})
H.check("POST /learn/decide while mode off: 409", r.status_code == 409, r.status_code)
H.check("mode off: the crons do nothing", learn._cron_decide() == "" and learn._cron_gate() == "")

client.__exit__(None, None, None)
H.done()
