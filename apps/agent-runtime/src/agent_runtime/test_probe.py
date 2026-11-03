"""CR-116 probe · unit: tắt ⇒ không ghi + gần như không tốn; bật ⇒ một dòng kv, thống kê, đếm câu."""

import re
import time

import pytest

from agent_runtime import probe as pr

LINE = re.compile(r"^t=\d+ e=probe\.x ms=[\d.]+ cpu=[\d.]+ rss=-?\d+ sql=\d+ rt=\d+$")


@pytest.fixture(autouse=True)
def _reset() -> None:  # pyright: ignore[reportUnusedFunction]
    pr.set_probe(False)
    pr.reset_probe()


def test_off_writes_nothing(capsys: pytest.CaptureFixture[str]) -> None:
    with pr.probe("x"):
        pass
    pr.probe_emit("meta", a=1)
    assert capsys.readouterr().out == ""
    assert pr.probe_samples() == []


def test_off_overhead_is_negligible() -> None:
    n = 20_000
    t0 = time.perf_counter()
    for _ in range(n):
        with pr.probe("x"):
            pass
    per_call_us = (time.perf_counter() - t0) / n * 1e6
    assert per_call_us < 20, per_call_us  # context manager rỗng, ~1 µs thật


def test_on_emits_one_kv_line(capsys: pytest.CaptureFixture[str]) -> None:
    pr.set_probe(True)
    pr.count_query("select 1")
    pr.count_query("BEGIN")
    with pr.probe("x"):
        pr.count_query("select 2")
        pr.count_query("commit")
        pr.count_query("update t set a = 1")
    lines = capsys.readouterr().out.strip().splitlines()
    assert len(lines) == 1 and LINE.match(lines[0]), lines
    s = pr.probe_samples()[0]
    assert (s.sql, s.rt) == (2, 3)


def test_stats_and_quote() -> None:
    xs = [pr.ProbeSample("a", float(i), 0, 0, 0, 0) for i in range(1, 101)]
    st = pr.probe_stats(xs)["a"]
    assert (st["n"], st["p50"], st["p95"], st["mean"]) == (100, 50, 95, 50.5)
    assert pr.probe_line("m", {"v": "a b", "n": 1}, 5) == 't=5 e=probe.m v="a b" n=1'
