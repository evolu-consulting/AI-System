"""The nightly sweep of KH session project bindings (KH app/session_project.py), 2026-10-24.

It fires once per local day at KH_WORKER_SESSIONS_AT (default 02:00, KH_WORKER_TZ), calls POST /session/sweep,
needs no model, writes nothing in dry mode, and 'off' turns it off.
"""
from __future__ import annotations

import os
import sys
from datetime import datetime, timezone

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from kh_worker.khclient import KHError  # noqa: E402
from kh_worker.main import Config, SessionSweepSlot, sweep_sessions  # noqa: E402


class FakeKH:
    def __init__(self, fail=False):
        self.calls, self.fail = 0, fail

    def session_sweep(self):
        self.calls += 1
        if self.fail:
            raise KHError(503, "unavailable", "KH is down")
        return {"deleted": 3, "idle_before": "2026-10-21T19:00:00Z"}


def utc(y, mo, d, h, mi):
    return datetime(y, mo, d, h, mi, tzinfo=timezone.utc)


def test_default_is_two_in_the_morning_local():
    cfg = Config.from_env({"KH_WORKER_TZ": "Asia/Ho_Chi_Minh"})
    assert cfg.sessions_at == "02:00"
    slot = SessionSweepSlot(cfg)
    assert not slot.due(utc(2026, 10, 24, 18, 59))      # 01:59 in Ho Chi Minh City
    assert slot.due(utc(2026, 10, 24, 19, 0))           # 02:00
    slot.mark(utc(2026, 10, 24, 19, 0))
    assert not slot.due(utc(2026, 10, 24, 23, 0))       # once per local day
    assert slot.due(utc(2026, 10, 25, 19, 5))           # the next night


def test_off_never_fires_and_a_bad_time_fails_at_start():
    assert not SessionSweepSlot(Config.from_env({"KH_WORKER_SESSIONS_AT": "off"})).due(utc(2026, 10, 24, 20, 0))
    with pytest.raises(ValueError):
        Config.from_env({"KH_WORKER_SESSIONS_AT": "25:00"})


def test_sweep_calls_kh_only_when_not_dry():
    kh = FakeKH()
    assert sweep_sessions(Config.from_env({"KH_WORKER_MODE": "dry"}), kh)["status"] == "dry" and kh.calls == 0
    out = sweep_sessions(Config.from_env({"KH_WORKER_MODE": "on"}), kh)
    assert out["status"] == "ok" and out["deleted"] == 3 and kh.calls == 1


def test_a_kh_error_is_reported_not_raised():
    out = sweep_sessions(Config.from_env({"KH_WORKER_MODE": "on"}), FakeKH(fail=True))
    assert out["status"] == "error" and "down" in out["error"]
