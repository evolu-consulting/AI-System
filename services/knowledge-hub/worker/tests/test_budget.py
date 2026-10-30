"""Caps per run, per month and for backfill; estimate vs actual; the guarded job run (lease, month spend from KH,
fail-closed, dry mode). No network and no paid API: the LLM is the dry adapter or a fake."""
from __future__ import annotations

import os
import sys
import threading
from datetime import datetime, timezone

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from kh_worker import budget as B  # noqa: E402
from kh_worker.budget import Budget, BudgetExceeded, cost_from_usage, estimate_usd  # noqa: E402
from kh_worker.khclient import KHClient, KHError, LeaseHeld  # noqa: E402
from kh_worker.llm import DryLLM, LLMRequest, LLMResult, Metered  # noqa: E402
from kh_worker.main import Config, Scheduler, parse_slot, run_job  # noqa: E402

SCHEMA = {"type": "object", "properties": {"items": {"type": "array", "items": {"type": "string"}}},
          "required": ["items"], "additionalProperties": False}


@pytest.fixture(autouse=True)
def _no_key(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)


# ------------------------------------------------------------------------------------------- prices
def test_estimate_is_input_plus_full_max_tokens():
    # Opus 5.5: $4 in / $20 out per M
    assert estimate_usd("claude-opus-5-5", 15_000, 3_000) == pytest.approx(0.06 + 0.06)
    assert estimate_usd("claude-opus-5-5", 15_000, 3_000, batch=True) == pytest.approx(0.06)
    assert estimate_usd("claude-sonnet-5", 1_000_000, 0) == pytest.approx(2.0)


def test_unknown_model_is_priced_as_the_dearest():
    assert B.price_of("claude-typo-9") == max(B.PRICES.values())


def test_cost_from_usage_counts_cache_and_batch():
    u = {"input_tokens": 1_000_000, "output_tokens": 100_000, "cache_read_input_tokens": 1_000_000,
         "cache_creation_input_tokens": 1_000_000}
    full = 4.0 + 2.0 + 0.4 + 5.0
    assert cost_from_usage("claude-opus-5-5", u) == pytest.approx(full)
    assert cost_from_usage("claude-opus-5-5", u, batch=True) == pytest.approx(full / 2)


# ------------------------------------------------------------------------------------------- caps
def test_run_cap_refuses_before_spend():
    b = Budget(cap_run_usd=1.0, cap_month_usd=100.0)
    b.reserve(0.6).book(0.6, model="m")
    with pytest.raises(BudgetExceeded) as ei:
        b.check(0.5)
    assert ei.value.cap == "run"
    b.check(0.4)                                  # exactly up to the cap is allowed
    assert b.refused == 1


def test_month_cap_uses_month_spend_from_kh():
    b = Budget(cap_run_usd=3.0, cap_month_usd=60.0, month_spent_usd=59.5)
    with pytest.raises(BudgetExceeded) as ei:
        b.reserve(0.6)
    assert ei.value.cap == "month"
    b.reserve(0.5).book(0.2, model="m")
    assert b.month_spent_usd == pytest.approx(59.7)


def test_backfill_cap_replaces_run_cap_and_stays_out_of_month():
    b = Budget(cap_run_usd=3.0, cap_month_usd=60.0, cap_backfill_usd=80.0, month_spent_usd=59.9, kind="backfill")
    b.reserve(10.0).book(10.0, model="m")         # far over the run cap and the month headroom: fine for backfill
    assert b.month_spent_usd == pytest.approx(59.9)
    assert b.run_spent_usd == pytest.approx(10.0)
    with pytest.raises(BudgetExceeded) as ei:
        b.check(70.01)
    assert ei.value.cap == "backfill"


def test_reservations_count_until_settled_and_cancel_releases():
    b = Budget(cap_run_usd=1.0)
    h1 = b.reserve(0.7)
    with pytest.raises(BudgetExceeded):
        b.reserve(0.4)                            # the in-flight hold counts
    h1.cancel()
    assert b.reserved_usd == 0 and b.run_spent_usd == 0
    b.reserve(0.9).book(0.1, model="m")           # actual below estimate releases the rest
    assert b.remaining_usd() == pytest.approx(0.9)


def test_on_spend_only_for_billed_calls():
    seen = []
    b = Budget(on_spend=seen.append, month_spent_usd=1.0)
    b.reserve(0.1).book(0.05, model="m", billed=False)
    assert seen == [] and b.month_spent_usd == 1.0 and b.run_spent_usd == pytest.approx(0.05)
    b.reserve(0.1).book(0.05, model="m", billed=True)
    assert len(seen) == 1 and seen[0].usd == pytest.approx(0.05) and b.month_spent_usd == pytest.approx(1.05)


def test_budget_rejects_bad_config():
    with pytest.raises(ValueError):
        Budget(kind="weekly")
    with pytest.raises(ValueError):
        Budget(cap_run_usd=-1)


def test_budget_thread_safe_never_overshoots():
    b = Budget(cap_run_usd=1.0, cap_month_usd=100.0)
    ok = []

    def worker():
        for _ in range(50):
            try:
                b.reserve(0.01).book(0.01, model="m")
                ok.append(1)
            except BudgetExceeded:
                pass

    ts = [threading.Thread(target=worker) for _ in range(8)]
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    assert b.run_spent_usd <= 1.0 + 1e-9
    assert len(ok) == pytest.approx(100, abs=1)


# ------------------------------------------------------------------------------------------- metered calls
def test_metered_refuses_before_the_llm_is_called():
    dry = DryLLM("claude-opus-5-5")
    m = Metered(dry, Budget(cap_run_usd=0.0001))
    with pytest.raises(BudgetExceeded):
        m.complete("sys", "user " * 100, SCHEMA, max_tokens=4000)
    assert dry.calls == []


def test_metered_actual_never_above_estimate_for_dry():
    b = Budget(cap_run_usd=3.0)
    m = Metered(DryLLM("claude-opus-5-5"), b)
    res = m.complete("system text", "user text " * 50, SCHEMA, max_tokens=2000)
    assert res.json == {"items": []}
    assert m.log[0]["usd"] <= m.log[0]["estimate"]
    assert b.calls == 1 and b.reserved_usd == 0


def test_metered_many_is_all_or_nothing():
    dry = DryLLM("claude-opus-5-5")
    b = Budget(cap_run_usd=0.05)
    reqs = [LLMRequest("s", "u" * 3000, SCHEMA, max_tokens=1000, custom_id=f"d{i}") for i in range(5)]
    with pytest.raises(BudgetExceeded):
        Metered(dry, b).complete_many(reqs)
    assert dry.calls == []
    out = Metered(dry, Budget(cap_run_usd=3.0)).complete_many(reqs)
    assert [r.custom_id for r in out] == [f"d{i}" for i in range(5)]


class _PricedLLM:
    """A fake billed adapter with a fixed cost per call (stands in for anthropic; no network)."""
    name = "fake"
    billed = True

    def __init__(self, usd=0.5, model="claude-opus-5-5"):
        self.usd, self.model, self.calls = usd, model, 0

    def count_tokens(self, system, user, schema):
        return 1000

    def complete(self, system, user, schema, *, max_tokens=1000):
        self.calls += 1
        return LLMResult(json={"items": []}, usage={"input_tokens": 1000, "output_tokens": 10}, model=self.model,
                         cost_usd=self.usd, billed=True, adapter=self.name)


# ------------------------------------------------------------------------------------------- guarded run
class _FakeLease:
    def __init__(self, held=False):
        self.held = held
        self.lost = threading.Event()
        self.released = False

    def __enter__(self):
        if self.held:
            raise LeaseHeld(409, "lease_held", "", {"holder": "other-worker"})
        return self

    def __exit__(self, *a):
        self.released = True


class _FakeKH:
    def __init__(self, month=0.0, held=False, month_error=False, cost_error=False):
        self.run_id = "run1"
        self.dry = True
        self.month, self.month_error, self.cost_error = month, month_error, cost_error
        self.lease_obj = _FakeLease(held)
        self.costs, self.events, self.submits = [], [], []

    def lease(self, name, ttl_s=900):
        self.lease_name = name
        return self.lease_obj

    def month_spend_usd(self):
        if self.month_error:
            raise KHError(503, "error", "down")
        return self.month

    def record_cost(self, usd, *, job, kind, model, project="", usage=None):
        if self.cost_error:
            raise KHError(500, "error", "metrics down")
        self.costs.append((usd, job, kind, model))

    def append_event(self, kind, body, *, project="", event_id=""):
        self.events.append((kind, dict(body)))

    def distill_submit(self, body):
        b = dict(body)
        if self.dry:
            b["dry_run"] = True
        self.submits.append(b)
        return {"results": []}


def _cfg(**kw):
    base = dict(kh_url="http://kh", static_token="t", enabled=True, mode="dry", llm="dry",
                cap_run_usd=3.0, cap_month_usd=60.0, cap_backfill_usd=80.0)
    base.update(kw)
    return Config(**base)


def _loop_job(n):
    def job(ctx):
        for i in range(n):
            if ctx.should_stop():
                break
            res = ctx.llm.complete("sys", f"batch {i}", SCHEMA, max_tokens=100)
            ctx.kh.distill_submit({"project": ctx.projects[0], "batch_id": f"b{i}", "items": res.json["items"],
                                   "dry_run": False})
        return {"batches": n}
    return job


def test_run_job_stops_at_the_run_cap_and_records_each_billed_call():
    kh, llm = _FakeKH(), _PricedLLM(usd=1.0)
    out = run_job(_cfg(), "distil", ["p1"], kh=kh, llm=llm, job_runner=_loop_job(10))
    assert out["status"] == "budget" and out["cap"] == "run"
    assert llm.calls <= 3 and len(kh.costs) == llm.calls
    assert all(c[2] == "run" for c in kh.costs)
    assert kh.lease_name == "worker:distil" and kh.lease_obj.released
    assert kh.events and kh.events[-1][0] == "worker.run"


def test_run_job_month_cap_from_kh():
    kh, llm = _FakeKH(month=59.999), _PricedLLM(usd=0.5)   # headroom below one estimate
    out = run_job(_cfg(), "distil", ["p1"], kh=kh, llm=llm, job_runner=_loop_job(3))
    assert out["status"] == "budget" and out["cap"] == "month" and llm.calls == 0


def test_run_job_backfill_ignores_month_and_tags_metrics():
    kh, llm = _FakeKH(month=60.0), _PricedLLM(usd=1.0)
    out = run_job(_cfg(), "distil", ["p1"], backfill=True, kh=kh, llm=llm, job_runner=_loop_job(5))
    assert out["status"] == "ok" and llm.calls == 5
    assert {c[2] for c in kh.costs} == {"backfill"}


def test_run_job_fails_closed_when_month_spend_unknown():
    kh, llm = _FakeKH(month_error=True), _PricedLLM()
    out = run_job(_cfg(), "distil", ["p1"], kh=kh, llm=llm, job_runner=_loop_job(2))
    assert out["status"] == "month_unknown" and llm.calls == 0


def test_run_job_dry_adapter_runs_without_month_and_bills_nothing():
    kh = _FakeKH(month_error=True)
    out = run_job(_cfg(), "distil", ["p1"], kh=kh, llm=DryLLM(), job_runner=_loop_job(2))
    assert out["status"] == "ok" and kh.costs == []


def test_run_job_stops_when_cost_cannot_be_recorded():
    kh, llm = _FakeKH(cost_error=True), _PricedLLM(usd=0.1)
    out = run_job(_cfg(), "distil", ["p1"], kh=kh, llm=llm, job_runner=_loop_job(5))
    assert out["status"] == "cost_not_recorded" and llm.calls == 1


def test_run_job_lease_held_runs_nothing():
    kh, llm = _FakeKH(held=True), _PricedLLM()
    out = run_job(_cfg(), "distil", ["p1"], kh=kh, llm=llm, job_runner=_loop_job(2))
    assert out["status"] == "lease_held" and out["holder"] == "other-worker"
    assert llm.calls == 0 and kh.events == []


def test_run_job_dry_mode_forces_dry_run_on_every_submit():
    kh = _FakeKH()
    run_job(_cfg(mode="dry"), "distil", ["p1"], kh=kh, llm=DryLLM(), job_runner=_loop_job(3))
    assert len(kh.submits) == 3 and all(s["dry_run"] is True for s in kh.submits)


def test_run_job_missing_job_module_is_not_built():
    out = run_job(_cfg(), "daily", ["p1"], kh=_FakeKH(), llm=DryLLM())
    assert out["status"] in ("not_built", "ok", "error")   # 'ok' once slice S10 lands


def test_run_job_rejects_backfill_for_daily():
    with pytest.raises(ValueError):
        run_job(_cfg(), "daily", ["p1"], backfill=True, kh=_FakeKH(), llm=DryLLM())


# ------------------------------------------------------------------------------------------- KH client
class _Resp:
    def __init__(self, status, body):
        self.status_code, self._body = status, body
        self.content = b"x"
        self.text = str(body)

    def json(self):
        return self._body


class _Session:
    def __init__(self, routes):
        self.routes, self.calls = routes, []

    def request(self, method, url, json=None, params=None, headers=None, timeout=None):
        path = url.split("http://kh", 1)[1]
        self.calls.append((method, path, json, params, headers))
        status, body = self.routes.get((method, path), (200, {}))
        return _Resp(status, body)


def test_client_forces_dry_run_and_maps_errors():
    s = _Session({("GET", "/distill/next"): (429, {"error": "budget", "detail": "month cap"}),
                  ("POST", "/v1/kh_people/leases/worker:distil:acquire"):
                      (409, {"error": "lease_held", "detail": "", "holder": "x"})})
    kh = KHClient("http://kh", static_token="t", dry=True, session=s)
    kh.distill_submit({"project": "p", "batch_id": "b", "items": [], "dry_run": False})
    assert s.calls[-1][2]["dry_run"] is True
    from kh_worker.khclient import BudgetRefused
    with pytest.raises(BudgetRefused):
        kh.distill_next("p")
    with pytest.raises(LeaseHeld):
        kh.lease("worker:distil").acquire()


def test_client_mints_worker_token_and_reads_month_without_backfill():
    s = _Session({
        ("POST", "/v1/token"): (200, {"access_token": "NS", "expires_in": 3600}),
        ("POST", "/v1/kh_people/principals"): (409, {"error": "duplicate"}),
        ("POST", "/v1/kh_people/principals/worker/token"): (200, {"access_token": "WK", "expires_in": 900}),
        ("GET", "/v1/kh_people/metrics:aggregate"): (200, {"groups": [
            {"key": {"dims.kind": "run"}, "sum": 12.5}, {"key": {"dims.kind": "backfill"}, "sum": 70.0}]}),
    })
    kh = KHClient("http://kh", client_id="c", client_secret="s", session=s, clock=lambda: 1_760_000_000.0)
    kh.distill_cursor("p")
    assert s.calls[-1][4]["Authorization"] == "Bearer WK"
    assert kh.month_spend_usd() == pytest.approx(12.5)
    agg = s.calls[-1]
    assert agg[4]["Authorization"] == "Bearer NS"
    start = datetime.fromtimestamp(agg[3]["from"] / 1000, timezone.utc)
    assert (start.day, start.hour, start.minute) == (1, 0, 0)


def test_client_requires_credentials():
    with pytest.raises(ValueError):
        KHClient("http://kh")


# ------------------------------------------------------------------------------------------- schedule / config
def test_parse_slot():
    assert parse_slot("sat 03:00").weekday == 5
    assert parse_slot("02:30").weekday is None
    with pytest.raises(ValueError):
        parse_slot("someday 03:00")


def test_scheduler_fires_once_per_local_day_in_project_tz():
    cfg = _cfg(projects=["vn", "utc"], tz="Asia/Ho_Chi_Minh", project_tz={"utc": "UTC"})
    s = Scheduler(cfg)
    # 2026-10-10 is a Saturday. 20:30 UTC Friday = 03:30 Saturday in Ho Chi Minh (+7).
    t = datetime(2026, 10, 9, 20, 30, tzinfo=timezone.utc)
    assert s.due("distil", t, cfg.projects) == ["vn"]
    s.mark("distil", t, ["vn"])
    assert s.due("distil", t, cfg.projects) == []
    t2 = datetime(2026, 10, 10, 3, 1, tzinfo=timezone.utc)   # Saturday 03:01 UTC
    assert s.due("distil", t2, cfg.projects) == ["utc"]
    # daily 02:30: 19:29 UTC is 02:29 local -> not yet; 19:31 -> due
    assert s.due("daily", datetime(2026, 10, 10, 19, 29, tzinfo=timezone.utc), ["vn"]) == []
    assert s.due("daily", datetime(2026, 10, 10, 19, 31, tzinfo=timezone.utc), ["vn"]) == ["vn"]


def test_config_defaults_are_safe():
    cfg = Config.from_env({})
    assert cfg.enabled is False and cfg.dry is True and cfg.mode == "dry"
    assert cfg.model == "claude-opus-5-5" and cfg.llm == "anthropic"
    assert (cfg.cap_run_usd, cfg.cap_month_usd, cfg.cap_backfill_usd) == (3.0, 60.0, 80.0)
    with pytest.raises(ValueError):
        Config.from_env({"KH_WORKER_MODE": "live"})
    with pytest.raises(ValueError):
        Config.from_env({"KH_WORKER_CAP_RUN_USD": "-1"})


def test_config_reads_cf_user_provided_secrets_and_masks_them():
    vcap = '{"user-provided":[{"credentials":{"KH_WORKER_CLIENT_SECRET":"s3cret","OTHER":"x"}}]}'
    cfg = Config.from_env({"VCAP_SERVICES": vcap, "KH_WORKER_CLIENT_ID": "cid"})
    assert cfg.client_secret == "s3cret"
    assert cfg.public()["client_secret"] == "***"


def test_event_ids_follow_kh_rule_and_stay_deterministic():
    """KH refuses a whole append whose event id is outside [A-Za-z0-9_-]{1,64} (dev check 2026-10-11: every
    worker.run event of a dry run was refused with 422 because the ids carried ':' and '.')."""
    from kh_worker.khclient import EVENT_ID_RE, safe_event_id
    raw = "worker.run:e5d5faf435614513:db_17c6abfae33a4805b19a03ba4554e7c4"
    got = safe_event_id(raw)
    assert EVENT_ID_RE.match(got) and got == safe_event_id(raw)
    long_raw = "worker.run:" + "r" * 16 + ":" + "x" * 80
    assert EVENT_ID_RE.match(safe_event_id(long_raw)) and len(safe_event_id(long_raw)) == 64
    assert safe_event_id(long_raw) != safe_event_id(long_raw + "y")
    assert safe_event_id("worker_ok-1") == "worker_ok-1"
    s = _Session({("POST", "/v1/kh_people/events"): (200, {"accepted": [{}]})})
    KHClient("http://kh", static_token="t", session=s).append_event("worker.run", {"job": "distil"}, event_id=raw)
    assert EVENT_ID_RE.match(s.calls[-1][2]["id"])
