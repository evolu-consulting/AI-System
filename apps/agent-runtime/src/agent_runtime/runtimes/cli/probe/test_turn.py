"""WRK-FR-22 · H3a-R14(b) · R18 · `probe_turn` spawn con probe thật với `fake-cli` (APP_ENV=test):
`ok` (+ `ok:<ms>`), `rejected`, `revoked`, `warning`, `error`, `hang` (hạn rút ngắn ⇒ giết group),
file đếm `.calls`. Không gọi `claude-sub` thật.
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

import pytest

from agent_runtime.providers.base import Fatal, RateLimit
from agent_runtime.runtimes.cli.probe import ProbeHostCfg
from agent_runtime.runtimes.cli.probe.turn import ProbeSeen, probe_turn
from agent_runtime.sandbox import process as pg

KEY = "fake-cli"


def cfg_of(tmp_path: Path, timeout_s: float = 60) -> ProbeHostCfg:
    home = tmp_path / "home"
    home.mkdir(exist_ok=True)
    return ProbeHostCfg(
        python=sys.executable,
        home=home,
        work_dir=tmp_path / "work",
        app_env="test",
        cli_path=None,
        kill_grace_s=0.5,
        timeout_s=timeout_s,
        fake_file=tmp_path / "probe.txt",
    )


async def test_wrk_fr_22_turn_ok_events(tmp_path: Path) -> None:
    cfg = cfg_of(tmp_path)
    seen, timed_out = await probe_turn(cfg, KEY, None)
    assert not timed_out and seen.fatal is None
    assert seen.rate_limit is not None and seen.rate_limit.status == "allowed"
    assert seen.usage is not None and (seen.usage.input, seen.usage.output) == (10, 1)
    assert seen.final is not None and not seen.final.is_error and seen.final.text is None
    assert calls_of(cfg) == "turn\n"


async def test_wrk_fr_22_turn_ok_ms_sleeps(tmp_path: Path) -> None:
    started = time.monotonic()
    seen, timed_out = await probe_turn(cfg_of(tmp_path), KEY, "ok:1500")
    assert not timed_out and seen.final is not None
    assert time.monotonic() - started >= 1.5


@pytest.mark.parametrize(
    ("fake", "status", "final_error"),
    [
        ("rejected:1900000000:five_hour", "rejected", True),
        ("revoked", "logged_out", True),
        ("warning:0.9:1900000000", "allowed_warning", False),
    ],
)
async def test_wrk_fr_22_turn_signals(
    tmp_path: Path, fake: str, status: str, final_error: bool
) -> None:
    seen, timed_out = await probe_turn(cfg_of(tmp_path), KEY, fake)
    assert not timed_out and seen.rate_limit is not None
    assert seen.rate_limit.status == status
    assert seen.final is not None and seen.final.is_error is final_error


async def test_wrk_fr_22_turn_error_is_fatal(tmp_path: Path) -> None:
    seen, timed_out = await probe_turn(cfg_of(tmp_path), KEY, "error")
    assert not timed_out
    assert seen.fatal is not None and seen.fatal.code == "UPSTREAM_ERROR"


async def test_wrk_fr_22_turn_hang_times_out_kills_group(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    pids: list[int] = []
    track = pg.track_host

    def tracking(pid: int) -> None:
        pids.append(pid)
        track(pid)

    monkeypatch.setattr(pg, "track_host", tracking)
    started = time.monotonic()
    seen, timed_out = await probe_turn(cfg_of(tmp_path, timeout_s=8), KEY, "hang")
    assert timed_out and seen.final is None
    assert time.monotonic() - started < 15
    assert pids and pg.group_pids(pids[0]) == []


def test_wrk_fr_22_seen_keeps_worst_rate_limit() -> None:
    seen = ProbeSeen()
    for status in ("allowed", "rejected", "allowed_warning"):
        seen.add(RateLimit(status=status))
    assert seen.rate_limit is not None and seen.rate_limit.status == "rejected"
    assert seen.add(Fatal(code="X", msg="m")) is True


def calls_of(cfg: ProbeHostCfg) -> str:
    return Path(f"{cfg.fake_file}.calls").read_text()
