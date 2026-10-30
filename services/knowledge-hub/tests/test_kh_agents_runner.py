"""tools/kh_agents/runner.py: effect claims after a global stop (S15 dev check 2026-10-11).

A global stop can cut a step between ``:claim`` and ``:complete``. The redone step then meets 409 effect_claimed with
state ``claimed``: from its own principal (complete it), or from another agent whose claim lives until its TTL
(requeue the step). Before the fix the runner gave up after three short waits and marked the task ``error``
(1 task in 3 stop drills on kh-dev-f). No network: a fake agent answers the routes.

    .venv\\Scripts\\python -m pytest tests\\test_kh_agents_runner.py -q
"""
import json
import os
import sys
import time
from types import SimpleNamespace

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools", "kh_agents"))

import runner  # noqa: E402
from simlib import Resp  # noqa: E402


class FakeAgent:
    def __init__(self, name, answers):
        self.name = name
        self.answers = answers               # {route suffix: [Resp, ...]} served in order
        self.calls = []

    def post(self, path, body=None, headers=None, route=""):
        self.calls.append(path)
        verb = path.rsplit(":", 1)[1]
        return self.answers[verb].pop(0)


def resp(status, body):
    return Resp(status, {}, json.dumps(body).encode(), 1.0)


def make_run():
    run = runner.Run.__new__(runner.Run)
    run.args = SimpleNamespace(approver="auto")
    run.log, run.run_id = {}, "run-test"
    import threading
    run.lock = threading.Lock()
    return run


def test_own_claim_cut_by_a_stop_is_completed(monkeypatch):
    monkeypatch.setattr(time, "sleep", lambda s: None)
    claimed = resp(409, {"error": "effect_claimed", "effect": {"state": "claimed", "holder": "ops-agent-01"}})
    agent = FakeAgent("ops-agent-01", {"claim": [claimed], "complete": [resp(200, {"state": "done"})]})
    run = make_run()
    task = {"id": "t-1", "attempt": 2}
    assert run._effect(agent, task, "branch/push/x-t-1", {"artifacts": []}) == "done"
    assert agent.calls == ["/effects/branch/push/x-t-1:claim", "/effects/branch/push/x-t-1:complete"]
    assert run.log["effects_done"] == 1


def test_claim_held_by_another_agent_requeues_instead_of_failing(monkeypatch):
    monkeypatch.setattr(time, "sleep", lambda s: None)
    held = {"error": "effect_claimed", "effect": {"state": "claimed", "holder": "ops-agent-05"}}
    agent = FakeAgent("ops-agent-02", {"claim": [resp(409, held) for _ in range(3)]})
    run = make_run()
    got = run._effect(agent, {"id": "t-2", "attempt": 2}, "branch/push/deps-t-2", {})
    assert got == "busy" and run.log["effect_busy"] == 1


def test_done_effect_is_never_delivered_twice(monkeypatch):
    monkeypatch.setattr(time, "sleep", lambda s: None)
    done = resp(409, {"error": "effect_claimed", "effect": {"state": "done", "holder": "ops-agent-05"}})
    agent = FakeAgent("ops-agent-02", {"claim": [done]})
    assert make_run()._effect(agent, {"id": "t-3", "attempt": 2}, "pr/open/fix-t-3", {}) == "done"
    assert agent.calls == ["/effects/pr/open/fix-t-3:claim"]


def test_claim_ttl_is_short():
    assert runner.EFFECT_CLAIM_TTL_S <= 60


if __name__ == "__main__":
    import pytest
    sys.exit(pytest.main([__file__, "-q"]))
