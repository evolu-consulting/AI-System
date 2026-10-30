"""Contract test of the S11/S14 wiring: tuned parameters, POST /context/step ``overrides`` and the bench hook
(app/caps/benchhook.py, app/step.py, app/caps/learn.py, app/caps/improve.py).

  1. /context/step ``overrides``: absent = unchanged (the config floor); a maintainer's override is in force for
     the request only; a member gets 403; an unknown name or a bad value is a 422; a call with overrides logs no
     serve. The consumers read through improve.param (step floor, know-enough, turn lesson floor, distill).
  2. Registration: without KH_BENCH_HOOK the hooks stay unset (learn gate skipped, param proposals hold);
     KH_BENCH_HOOK=1 sets learn.BENCH[0] and improve.BENCH[0].
  3. The guard (stubbed scorer): a candidate more than 2% worse fails, within 2% passes, an unmeasured baseline
     or new errors fail; the hooks hand the candidate over as with_items / overrides; improve and learn use them.
  4. learn.propose(source=...) marks the trial's source.
  5. The real scorer, in-process, on a few p1bench questions and tier-1 tasks (empty data: equal scores, pass).

Run:  .venv\\Scripts\\python tests\\caps\\test_benchhook.py
"""
import os

from harness import H  # noqa: I001  (must be first: throwaway db, sign-in on)

from fastapi.testclient import TestClient  # noqa: E402

from app import config, distill, step, turn  # noqa: E402
from app import entities as kh_entities  # noqa: E402
from app.caps import benchhook, improve, learn  # noqa: E402

MAINT = H.person("fen@x.io", maintainer=True)
ANA = H.person("ana@x.io", member=["alpha"])
for k in ("KH_CAP_PEOPLE", "KH_CAP_OUTCOMES", "KH_CAP_LEARN", "KH_CAP_IMPROVE", "KH_IMPROVE_MODE", "KH_LEARN_MODE",
          "KH_BENCH_HOOK", "KH_BENCH_HOOK_URL", "KH_BENCH_HOOK_TOKEN"):
    os.environ.pop(k, None)

SCORES = [0.95, 0.80, 0.72, 0.66, 0.55]
CALLS = []


async def fake_query(text, k, model, scope=None, project=None, where=None):
    CALLS.append((scope, project))
    from app import hotlog
    if scope == hotlog.config.HOTLOG_SCOPE and project == "alpha":
        return [{"vector_id": "log1", "score": 0.7, "source_text": "a worklog row", "metadata": {"project": "alpha"}}]
    if scope != "knowledge" or project != "alpha":
        return []
    return [{"vector_id": f"k{i}", "score": s, "source_text": f"knowledge row {i}", "metadata": {"project": "alpha"}}
            for i, s in enumerate(SCORES)]


class _Res:
    hits = []


async def recent(**kw):
    return _Res()


step.query_quick_knowledge = fake_query
kh_entities.match = lambda text, scope, limit: []
distill.contexts = lambda project: []


def make_app():
    app = H.app()
    app.state.model = None
    step.attach(app, recent)
    return app


# ── 1. overrides on /context/step ────────────────────────────────────────────
c = TestClient(make_app())
c.__enter__()
STEP = {"text": "how do we deploy the runner", "project": "alpha"}
H.check("improve is not attached by default", not __import__("app.caps", fromlist=["x"]).is_loaded("improve"))
r = c.post("/context/step", json=STEP, headers=MAINT)
base = r.json()
H.check("no overrides: 200 and the config floor", r.status_code == 200 and base["floor"] == config.STEP_FLOOR,
        r.text[:200])
n_base = sum(1 for i in base["items"] if i["tier"] == "knowledge")
H.check("no overrides: knowledge rows at or above the config floor",
        n_base == sum(1 for s in SCORES if s >= config.STEP_FLOOR), (n_base, config.STEP_FLOOR))
r = c.post("/context/step", json={**STEP, "overrides": {"KH_STEP_FLOOR": 0.9}}, headers=MAINT)
H.check("maintainer override: the floor is in force for the request", r.status_code == 200
        and r.json()["floor"] == 0.9 and sum(1 for i in r.json()["items"] if i["tier"] == "knowledge") == 1,
        r.text[:300])
H.check("override is gone after the request", c.post("/context/step", json=STEP, headers=MAINT).json() == base)
H.check("outside a request param() is the default", improve.param("KH_STEP_FLOOR", config.STEP_FLOOR)
        == config.STEP_FLOOR)
r = c.post("/context/step", json={**STEP, "overrides": {"KH_STEP_FLOOR": 0.9}}, headers=ANA)
H.check("a member sending overrides: 403", r.status_code == 403, r.status_code)
r = c.post("/context/step", json={**STEP, "overrides": {}}, headers=ANA)
H.check("a member sending empty overrides: 403", r.status_code == 403, r.status_code)
r = c.post("/context/step", json={**STEP, "overrides": {"KH_AUTH_ISSUER": 1}}, headers=MAINT)
H.check("unknown override name: 422", r.status_code == 422, r.status_code)
r = c.post("/context/step", json={**STEP, "overrides": {"KH_STEP_FLOOR": 7}}, headers=MAINT)
H.check("override out of bounds: 422", r.status_code == 422, r.status_code)
H.check("overrides make a bench call (no serve logged)", step.bench_call(step.StepRequest(**STEP, overrides={}))
        and not step.bench_call(step.StepRequest(**STEP)))
# know-enough: best knowledge 0.95 >= the default -> the log rows are skipped; an override above 0.95 reads them
H.check("default know-enough: the log row is skipped", any(t["kind"] == "log-skipped" for t in base["open_threads"])
        and not any(i["tier"] == "log" for i in base["items"]), base["open_threads"])
r = c.post("/context/step", json={**STEP, "overrides": {"KH_STEP_KNOW_ENOUGH": 0.99}}, headers=MAINT)
H.check("KH_STEP_KNOW_ENOUGH override reaches the log decision (no log-skipped thread)", r.status_code == 200
        and not any(t["kind"] == "log-skipped" for t in r.json()["open_threads"])
        and any(i["tier"] == "log" for i in r.json()["items"]), r.text[:300])

# the other consumers read through improve.param (per-request override = what improve on would serve)
with improve.request_overrides({"KH_DISTILL_SAMPLE_PCT": 100}):
    H.check("distill sample pct is tuned", distill._sampled("any-log-id"))
with improve.request_overrides({"KH_DISTILL_SAMPLE_PCT": 0}):
    H.check("distill sample pct 0 samples nothing", not distill._sampled("any-log-id"))
H.check("distill sample pct default unchanged", distill._sampled("x", config.DISTILL_SAMPLE_PCT)
        == distill._sampled("x"))
with improve.request_overrides({"signal_words": {"add": ["zzbench"], "remove": []}}):
    H.check("signal words are tuned", "zzbench" in distill._tuned("signal_words", ["failed"]))
H.check("signal words default unchanged", distill._tuned("signal_words", ["failed"]) == ["failed"])


async def _lessons_probe():
    old = turn.query_quick_knowledge, config.TURN_LESSON_PROJECT

    async def q(text, k, model, scope=None, project=None, where=None):
        return [{"vector_id": "l1", "score": 0.5, "source_text": "a lesson", "metadata": {}}]
    turn.query_quick_knowledge = q
    config.TURN_LESSON_PROJECT = "alpha"
    try:
        plain = await turn.lessons_part("x", None)
        with improve.request_overrides({"KH_TURN_LESSON_FLOOR": 0.4}):
            tuned = await turn.lessons_part("x", None)
    finally:
        turn.query_quick_knowledge, config.TURN_LESSON_PROJECT = old
    return plain, tuned


import asyncio  # noqa: E402

plain, tuned = asyncio.run(_lessons_probe())
H.check("turn lesson floor: the default keeps a 0.5 lesson out, the override lets it in",
        plain == [] and len(tuned) == 1, (plain, tuned))
c.__exit__(None, None, None)

# ── 2. registration ──────────────────────────────────────────────────────────
os.environ.update(KH_CAP_PEOPLE="on", KH_CAP_LEARN="on", KH_CAP_IMPROVE="on")
learn.BENCH[0] = improve.BENCH[0] = None
app = make_app()
H.check("KH_BENCH_HOOK unset: learn.BENCH stays unset", learn.BENCH[0] is None)
H.check("KH_BENCH_HOOK unset: improve.BENCH stays unset", improve.BENCH[0] is None)
H.check("KH_BENCH_HOOK unset: register() does nothing", benchhook.register(app) is False and learn.BENCH[0] is None)
os.environ["KH_BENCH_HOOK"] = "1"
app = make_app()
H.check("KH_BENCH_HOOK=1: learn.BENCH is the bench hook", learn.BENCH[0] is benchhook.learn_hook)
H.check("KH_BENCH_HOOK=1: improve.BENCH is the bench hook", improve.BENCH[0] is benchhook.improve_hook)
benchhook.unregister()
H.check("unregister clears both", learn.BENCH[0] is None and improve.BENCH[0] is None)

# ── 3. the guard, stubbed scorer ─────────────────────────────────────────────
BASE = {"p1_answered": 0.85, "p1_coverage": 0.90, "tier1_coverage": 0.70, "errors": 0}
seen = []


def stub(factor, metric="p1_coverage", errors=0, base_errors=0):
    def scorer(extra):
        seen.append(extra)
        if extra == {"overrides": {}}:
            return {**BASE, "errors": base_errors}
        return {**BASE, metric: BASE[metric] * factor, "errors": errors}
    return scorer


benchhook.SCORER[0] = stub(0.97)
got = benchhook.improve_hook({"kind": "param", "target": "KH_STEP_FLOOR", "value": 0.7})
H.check("a candidate 3% worse fails the guard", got["ok"] is False and got["reason"] == "regression"
        and got["worse"] == ["p1_coverage"], got)
H.check("improve hook: baseline overrides {} then the candidate as a per-request override",
        seen[-2:] == [{"overrides": {}}, {"overrides": {"KH_STEP_FLOOR": 0.7}}], seen[-2:])
benchhook.SCORER[0] = stub(0.99, "tier1_coverage")
got = benchhook.improve_hook({"kind": "param", "target": "KH_STEP_FLOOR", "value": 0.7})
H.check("a candidate 1% worse passes", got["ok"] is True and got["reason"] == "within_guard", got)
benchhook.SCORER[0] = stub(1.0, base_errors=2)
H.check("an unmeasured baseline never passes", benchhook.run({"overrides": {"KH_STEP_FLOOR": 0.7}})["ok"] is False)
benchhook.SCORER[0] = stub(1.0, errors=1)
H.check("new failed calls fail", benchhook.run({"overrides": {"KH_STEP_FLOOR": 0.7}})["reason"] == "candidate_errors")


def boom(extra):
    raise RuntimeError("server down")


benchhook.SCORER[0] = boom
H.check("a broken scorer fails closed", benchhook.run({})["ok"] is False)
H.check("zero baseline: an absolute 2-point guard", benchhook.compare({"p1_coverage": 0.0}, {"p1_coverage": 0.0})["ok"]
        and not benchhook.compare({"p1_coverage": 0.0}, {"p1_coverage": -0.05})["ok"])

benchhook.SCORER[0] = stub(0.90)
got = benchhook.learn_hook({"item_id": "dk_cand01", "text": "Pin the runner image before a deploy."})
H.check("learn hook: the candidate goes in as with_items", seen[-1] == {
    "overrides": {}, "with_items": [{"id": "dk_cand01", "text": "Pin the runner image before a deploy."}]}, seen[-1])
H.check("learn hook: a 10% drop fails", got["ok"] is False, got)
H.check("learn hook: an item without text fails", benchhook.learn_hook({"item_id": "x"})["ok"] is False)

# improve's propose path consumes the hook result (bench_regression / bench_ok)
learn_mode = os.environ.pop("KH_LEARN_MODE", None)
benchhook.register(app)
H.check("hooks registered again for the propose path", improve.BENCH[0] is benchhook.improve_hook)
res = improve.BENCH[0]({"kind": "param", "target": "KH_STEP_KNOW_ENOUGH", "value": 0.7})
H.check("improve.BENCH result is ok False for a 10% drop", res["ok"] is False)
benchhook.SCORER[0] = stub(1.0)
H.check("improve.BENCH result is ok True for no change",
        improve.BENCH[0]({"kind": "param", "target": "KH_STEP_KNOW_ENOUGH", "value": 0.7})["ok"] is True)
H.check("signal words value goes over as a dict override",
        benchhook.improve_hook({"target": "signal_words", "value": {"add": ["zz"], "remove": []}})["ok"]
        and seen[-1] == {"overrides": {"signal_words": {"add": ["zz"], "remove": []}}}, seen[-1])
benchhook.SCORER[0] = None
benchhook.unregister()

# ── 4. learn.propose(source=) ────────────────────────────────────────────────
import inspect  # noqa: E402

H.check("learn.propose has source= defaulting to agent",
        inspect.signature(learn.propose).parameters["source"].default == "agent")
os.environ["KH_LEARN_MODE"] = "trial"
try:
    learn.propose({"project": "alpha", "text": "x"}, "t", None, actions=set(), source="bogus")
    H.check("learn.propose refuses an unknown source", False)
except Exception as exc:  # noqa: BLE001
    H.check("learn.propose refuses an unknown source", getattr(exc, "code", None) == "invalid", exc)
src = inspect.getsource(improve._to_learn)
H.check("improve hands items over with source='improve' (no _set_attrs)",
        'source="improve"' in src and "_set_attrs" not in src)
if learn_mode is None:
    os.environ.pop("KH_LEARN_MODE", None)

# ── 5. the real scorer, in-process ───────────────────────────────────────────
c = TestClient(app)
c.__enter__()
benchhook.LIMIT[0] = 3


class _Client(benchhook._InProcess):
    def __init__(self):
        self.client, self.label, self.bodies = c, "test", []

    def call(self, method, path, body=None, params=None, timeout=120):
        self.bodies.append(body)
        r = self.client.request(method, path, json=body, params=params, headers=MAINT)
        return r.status_code, r.json(), 0.0


kh = _Client()
benchhook._state["client"] = kh
os.environ.pop("KH_BENCH_HOOK_URL", None)
got = benchhook.run({"overrides": {"KH_STEP_FLOOR": 0.9}})
H.check("real scorer, in-process: both suites ran without errors", got.get("baseline_errors") == 0
        and got.get("candidate_errors") == 0, got)
H.check("real scorer: every call carried overrides (bench calls)", kh.bodies and all("overrides" in b for b in kh.bodies))
H.check("real scorer: the candidate calls carried the override",
        any(b["overrides"] == {"KH_STEP_FLOOR": 0.9} for b in kh.bodies))
H.check("real scorer: p1 calls use only_tiers", any(b.get("only_tiers") == ["entity", "distilled"] for b in kh.bodies))
benchhook.LIMIT[0] = None
benchhook._state["client"] = None
c.__exit__(None, None, None)

for k in ("KH_CAP_PEOPLE", "KH_CAP_LEARN", "KH_CAP_IMPROVE", "KH_BENCH_HOOK", "KH_LEARN_MODE"):
    os.environ.pop(k, None)
H.done()
