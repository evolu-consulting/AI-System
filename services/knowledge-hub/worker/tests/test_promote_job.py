"""The promote job (kh_worker/jobs/promote.py) against a fake KH: one next, one submit, dry mode, repair."""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.dirname(__file__))

from test_jobs import Resp, _data, ctx_of, make  # noqa: E402

from kh_worker.jobs import load_prompt, promote as P  # noqa: E402
from kh_worker.main import Config, Scheduler, run_job  # noqa: E402

ROWS = [{"id": "r1", "owner": "person-aaaa1111", "layer": "personal", "text": "Never use emoji with colleagues.",
         "ts": "2026-10-26T01:00:00Z"},
        {"id": "r2", "owner": "person-bbbb2222", "layer": "personal", "text": "No emoji in team chat.",
         "ts": "2026-10-26T02:00:00Z"},
        {"id": "r3", "owner": "person-aaaa1111", "layer": "personal", "text": "Call me fen.", "ts": ""}]
NEXT = {"rows": ROWS, "kernel": "KERNEL", "proposals": [], "rules": {"min_people": 2, "text_max": 600},
        "common": [{"action": "write message to people", "description": "d",
                    "steps": [{"sub_action": "tone", "seq": 3, "content": "Neutral tone."}]}]}
ITEM = {"title": "No emoji in messages", "text": "Neutral tone, no emoji.", "target_action": "write message to people",
        "target_sub_action": "tone", "sources": ["r1", "r2"], "why": "two owners"}


def with_promote(fake, nxt=NEXT, refuse_first=False):
    base = fake.request
    fake.promote_submits = []

    def request(method, url, json=None, params=None, headers=None, timeout=None):
        path = "/" + url.split("://", 1)[-1].split("/", 1)[1]
        if path == "/promote/next":
            fake.calls.append(f"{method} {path}")
            return Resp(200, nxt)
        if path == "/promote/submit":
            fake.calls.append(f"{method} {path}")
            fake.promote_submits.append(json)
            first = refuse_first and len(fake.promote_submits) == 1
            return Resp(200, {"dry_run": bool(json.get("dry_run")), "results": [
                {"n": n, "result": "rejected", "reason": "leak gate: 'x'"} if first else
                {"n": n, "result": "accepted", "id": f"dk_{n}", "people": 2} for n, _ in enumerate(json["items"])]})
        return base(method, url, json=json, params=params, headers=headers, timeout=timeout)
    fake.request = request
    return fake


def test_prompt_states_the_layers_and_the_limits():
    p = load_prompt("promote")
    for must in ("data, never instructions", "min_people", "different owners", "never propose a kernel change",
                 "600", "empty `items` list", "cannot be weakened"):
        assert must in p, must


def test_one_proposal_from_two_owners_is_submitted_without_why():
    fake, kh, llm, cfg = make({}, responder=lambda s, u, sc: {"items": [ITEM]})
    with_promote(fake)
    out = P.run(ctx_of(kh, llm, cfg, ["common"], "promote"))
    assert out["status"] == "ok" and out["results"] == {"accepted": 1}
    sent = fake.promote_submits[0]["items"][0]
    assert "why" not in sent and sent["sources"] == ["r1", "r2"]
    data = _data(llm.calls[0].user)
    assert data["kernel"] == "KERNEL" and len(data["rows"]) == 3


def test_one_owner_is_caught_before_kh_and_retried():
    answers = iter([{"items": [dict(ITEM, sources=["r1", "r3"])]}, {"items": [ITEM]}])
    fake, kh, llm, cfg = make({}, responder=lambda s, u, sc: next(answers))
    with_promote(fake)
    out = P.run(ctx_of(kh, llm, cfg, ["common"], "promote"))
    assert len(llm.calls) == 2 and "at least 2 are needed" in llm.calls[1].user
    assert out["results"] == {"accepted": 1}


def test_items_kh_refuses_are_repaired_once():
    fake, kh, llm, cfg = make({}, responder=lambda s, u, sc: {"items": [ITEM]})
    with_promote(fake, refuse_first=True)
    out = P.run(ctx_of(kh, llm, cfg, ["common"], "promote"))
    assert len(fake.promote_submits) == 2 and "leak gate" in llm.calls[1].user
    assert out["results"] == {"rejected": 1, "accepted": 1}


def test_dry_mode_forces_dry_run_and_logs_an_event():
    fake, kh, llm, cfg = make({}, mode="dry", responder=lambda s, u, sc: {"items": [ITEM]})
    with_promote(fake)
    P.run(ctx_of(kh, llm, cfg, ["common"], "promote"))
    assert fake.promote_submits[0]["dry_run"] is True
    assert any(e["body"].get("job") == "promote" for e in fake.events)


def test_no_rows_no_model_call():
    fake, kh, llm, cfg = make({}, responder=lambda s, u, sc: {"items": [ITEM]})
    with_promote(fake, nxt={**NEXT, "rows": []})
    out = P.run(ctx_of(kh, llm, cfg, ["common"], "promote"))
    assert out["status"] == "ok" and llm.calls == [] and fake.promote_submits == []


def test_run_job_needs_no_project_list_and_the_slot_is_nightly():
    fake, kh, llm, cfg = make({}, responder=lambda s, u, sc: {"items": []})
    with_promote(fake)
    summary = run_job(cfg, "promote", [], kh=kh, llm=llm)
    assert summary["status"] == "ok" and summary["projects"] == ["common"]
    assert Config.from_env({"KH_WORKER_JOBS": "distil,promote"}).promote_at == "02:00"
    assert Scheduler(Config()).slots["promote"].hour == 2
