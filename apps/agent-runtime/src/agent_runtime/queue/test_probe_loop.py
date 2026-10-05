"""WRK-FR-22 · H3a-R11–R16 · PL4 · PL5 · PL8 — vòng probe (unit, pool/conn giả, đồng hồ tiêm):
khoá phiên luôn nhả, thứ tự câu `apply_probe` theo nhánh, lỗi lượt không làm chết vòng."""

from __future__ import annotations

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest

from agent_runtime.db import probe_sql as q
from agent_runtime.db.jobs_sql import K_CLAIM
from agent_runtime.db.provider_state_sql import FAIL_QUEUED
from agent_runtime.events.job_events import Failure, Tokens
from agent_runtime.queue.probe_loop import ProbeLoop, ProbeLoopCfg, Sleep
from agent_runtime.runtimes.cli.probe import ProbeHostCfg
from agent_runtime.runtimes.cli.quota_rules import ProbeCfg, ProbeKind, ProbeResult

KEY = "fake-cli"
NOW = datetime(2026, 10, 6, 12, 0, tzinfo=UTC)
UPD = NOW - timedelta(hours=1)
REAL_UPD = NOW - timedelta(seconds=1)  # `updated_at` đọc dưới K_CLAIM (job vừa đếm lỗi)


class _Stop(Exception):
    pass


def _row(status: str | None, errors: int = 0, **cols: object) -> dict[str, object]:
    base: dict[str, object] = {
        "key": KEY,
        "status": status,
        "cooldown_until": None,
        "last_probe_at": None,
        "last_ok_at": None,
        "consecutive_errors": errors if status is not None else None,
        "updated_at": UPD if status is not None else None,
        "db_now": NOW,
    }
    return {**base, **cols}


class _Conn:
    """Trả lời theo câu SQL; `fenced` ⇒ câu có rào trả 0 hàng."""

    def __init__(self, row: dict[str, object], *, locked: bool = False, fenced: bool = False):
        self.row, self.locked, self.fenced = row, locked, fenced
        self.sql: list[str] = []
        n = row["consecutive_errors"]
        # Trạng thái "thật" dưới K_CLAIM (`PROBE_STATE`): mặc định = snapshot; ca RV1-R1 đổi.
        self.errors = n if isinstance(n, int) else 0
        self.status = row["status"]
        self.args: dict[str, tuple[object, ...]] = {}

    async def execute(self, query: str, *args: object) -> str:
        self.sql.append(query)
        return "OK"

    async def fetch(self, query: str, *args: object) -> list[dict[str, object]]:
        self.sql.append(query)
        if query == FAIL_QUEUED:
            return [{"id": "j1", "run_id": "r1"}]
        return [self.row] if query == q.PROBE_TARGETS else []

    async def fetchrow(self, query: str, *args: object) -> dict[str, object] | None:
        self.sql.append(query)
        self.args[query] = args
        real = {"status": self.status, "consecutive_errors": self.errors, "updated_at": REAL_UPD}
        answers: dict[str, dict[str, object] | None] = {
            q.PROBE_TRY_LOCK: {"ok": not self.locked},
            q.PROBE_SNAPSHOT: self.row,
            q.PROBE_STATE: real if self.status is not None else None,
        }
        if query in answers:
            return answers[query]
        return None if self.fenced else {"?column?": 1}

    @asynccontextmanager
    async def transaction(self) -> AsyncGenerator[None]:
        self.sql.append("BEGIN")
        try:
            yield
        except BaseException:
            self.sql.append("ROLLBACK")
            raise
        self.sql.append("COMMIT")


class _Pool:
    def __init__(self, conn: _Conn) -> None:
        self.conn = conn

    @asynccontextmanager
    async def acquire(self) -> AsyncGenerator[Any]:
        yield self.conn

    async def close(self) -> None: ...


class _Events:
    def __init__(self) -> None:
        self.failed_jobs: list[tuple[str, str]] = []
        self.reasons: list[str | None] = []

    async def failed(self, job_id: str, run_id: str, f: Failure, usage: Tokens) -> None:
        assert f.code == "ALL_PROVIDERS_EXHAUSTED"
        self.failed_jobs.append((job_id, run_id))
        self.reasons.append(f.reason)


def _result(kind: ProbeKind = "ok", until: datetime | None = None) -> ProbeResult:
    return ProbeResult(kind, until, None, None, None, kind, (10, 1), 0, "turn")


async def _no_sleep(_: float) -> None:
    raise _Stop


def _loop(
    conn: _Conn, result: ProbeResult | Exception, sleep: Sleep = _no_sleep
) -> tuple[ProbeLoop, _Events, list[str]]:
    host = ProbeHostCfg("python", Path("/h"), Path("/w"), "test", None, 0.1, 1.0)
    cfg = ProbeLoopCfg(host, ProbeCfg(60, 1), (KEY,), 1800)
    events, probed = _Events(), list[str]()

    async def prober(_: ProbeLoopCfg, key: str) -> ProbeResult:
        probed.append(key)
        if isinstance(result, Exception):
            raise result
        return result

    loop = ProbeLoop(_Pool(conn), events, cfg, sleep)
    loop.prober = prober
    return loop, events, probed


async def test_wrk_fr_22_healthy_probe_no_claim_lock_and_unlocks() -> None:
    conn = _Conn(_row("ok"))
    loop, _, probed = _loop(conn, _result())
    await loop.round(startup=True)
    assert probed == [KEY]
    assert q.PROBE_HEALTHY in conn.sql and K_CLAIM not in conn.sql  # PL4: 0 lần K_CLAIM
    assert conn.sql[-1] == q.PROBE_UNLOCK


async def test_wrk_fr_22_locked_by_other_runtime_skips() -> None:
    conn = _Conn(_row(None), locked=True)
    loop, _, probed = _loop(conn, _result())
    await loop.round(startup=True)
    assert probed == [] and q.PROBE_UNLOCK not in conn.sql


async def test_wrk_fr_22_r12_recent_ok_not_probed() -> None:
    conn = _Conn(_row("ok", last_ok_at=NOW - timedelta(seconds=5)))
    loop, _, probed = _loop(conn, _result())
    await loop.round(startup=True)
    assert probed == [] and conn.sql == [q.PROBE_TARGETS]


async def test_wrk_fr_22_pl8_broken_claim_lock_order_and_xadd() -> None:
    conn = _Conn(_row("ok"))
    loop, events, _ = _loop(conn, _result("cooldown", NOW + timedelta(hours=1)))
    await loop.round(startup=True)
    i = conn.sql.index(K_CLAIM)
    assert conn.sql[i - 1] == "BEGIN"
    assert conn.sql[i + 1 : i + 4] == [FAIL_QUEUED, q.PROBE_MARK_BROKEN, "COMMIT"]
    assert events.failed_jobs == [("j1", "r1")] and events.reasons == ["quota"]
    assert conn.sql[-1] == q.PROBE_UNLOCK


async def test_wrk_fr_22_r15_fenced_broken_rolls_back_no_xadd() -> None:
    conn = _Conn(_row("ok"), fenced=True)
    loop, events, _ = _loop(conn, _result("logged_out"))
    await loop.round(startup=True)
    assert "ROLLBACK" in conn.sql and events.failed_jobs == []


async def test_wrk_fr_22_pl5_error_below_threshold_counts_under_claim_lock() -> None:
    """RV1-R1: snapshot khoẻ ⇒ mọi lần đếm lỗi đều giữ K_CLAIM (bất biến H1)."""
    conn = _Conn(_row("ok", errors=1))
    loop, events, _ = _loop(conn, _result("error"))
    await loop.round(startup=True)
    i = conn.sql.index(K_CLAIM)
    assert conn.sql[i - 1] == "BEGIN"
    assert conn.sql[i + 1 : i + 4] == [q.PROBE_STATE, q.PROBE_ERROR, "COMMIT"]
    assert FAIL_QUEUED not in conn.sql and events.failed_jobs == []


async def test_wrk_fr_22_pl5_error_reaches_threshold_under_claim_lock() -> None:
    conn = _Conn(_row("ok", errors=2))
    loop, events, _ = _loop(conn, _result("error"))
    await loop.round(startup=True)
    i = conn.sql.index(K_CLAIM)
    assert conn.sql[i + 1 : i + 5] == [
        q.PROBE_STATE,
        FAIL_QUEUED,
        q.PROBE_MARK_BROKEN,
        q.PROBE_ERROR,
    ]
    assert events.reasons == ["provider_unavailable"]


async def test_rv1_r1_wrk_fr_15_count_changed_between_snapshot_and_write() -> None:
    """Snapshot 1 lỗi; job lỗi chen giữa lượt probe ⇒ thật 2; probe timeout ⇒ 3 ⇒ `error` + job
    `queued` bị fail; rào `PROBE_MARK_BROKEN` theo `updated_at` đọc dưới khoá."""
    conn = _Conn(_row("ok", errors=1))
    conn.errors = 2
    loop, events, _ = _loop(conn, _result("error"))
    await loop.round(startup=True)
    i = conn.sql.index(K_CLAIM)
    assert conn.sql[i + 1 : i + 6] == [
        q.PROBE_STATE,
        FAIL_QUEUED,
        q.PROBE_MARK_BROKEN,
        q.PROBE_ERROR,
        "COMMIT",
    ]
    assert conn.args[q.PROBE_MARK_BROKEN][1] == "error"
    assert conn.args[q.PROBE_MARK_BROKEN][-1] == REAL_UPD
    assert events.failed_jobs == [("j1", "r1")] and events.reasons == ["provider_unavailable"]


async def test_rv1_r1_provider_broke_under_lock_only_counts() -> None:
    """Snapshot `ok` nhưng job đã đưa sang `cooldown` trước khi ghi ⇒ chỉ đếm (PL5)."""
    conn = _Conn(_row("ok", errors=2))
    conn.status = "cooldown"
    loop, events, _ = _loop(conn, _result("error"))
    await loop.round(startup=True)
    assert q.PROBE_ERROR in conn.sql and q.PROBE_MARK_BROKEN not in conn.sql
    assert events.failed_jobs == []


async def test_wrk_fr_22_pl5_broken_provider_error_keeps_status() -> None:
    conn = _Conn(_row("logged_out", errors=5))
    loop, _, _ = _loop(conn, _result("error"))
    await loop.round(startup=True)
    assert q.PROBE_ERROR in conn.sql and q.PROBE_MARK_BROKEN not in conn.sql
    assert K_CLAIM not in conn.sql  # đã hỏng: đếm không khoá


async def test_wrk_fr_22_probe_failure_logged_lock_released() -> None:
    conn = _Conn(_row(None))
    loop, _, probed = _loop(conn, OSError("boom"))
    await loop.round(startup=True)  # không ném
    assert probed == [KEY] and conn.sql[-1] == q.PROBE_UNLOCK


async def test_wrk_fr_22_r13_run_startup_round_then_ticks() -> None:
    """`logged_out` vừa probe: chỉ lượt `startup` probe; nhịp = min(5, logged_out_s, probe_s)."""
    conn = _Conn(_row("logged_out", last_probe_at=NOW))
    sleeps: list[float] = []

    async def sleep(s: float) -> None:
        sleeps.append(s)
        if len(sleeps) == 3:
            raise _Stop

    loop, _, probed = _loop(conn, _result("logged_out"), sleep)
    with pytest.raises(_Stop):
        await loop.run()
    assert sleeps == [1.0, 1.0, 1.0] and probed == [KEY]
    assert conn.sql.count(q.PROBE_TARGETS) == 3 and conn.sql.count(q.PROBE_TRY_LOCK) == 1
    assert q.PROBE_SEEN in conn.sql  # logged_out → logged_out: chỉ ghi mốc


class _DownOnce(_Conn):
    """`PROBE_TARGETS` lỗi DB lần đầu (DB chưa sẵn lúc khởi động), sau đó bình thường."""

    async def fetch(self, query: str, *args: object) -> list[dict[str, object]]:
        if query == q.PROBE_TARGETS and q.PROBE_TARGETS not in self.sql:
            self.sql.append(query)
            raise OSError("db down")
        return await super().fetch(query, *args)


async def test_rv1_r3_wrk_fr_22_startup_kept_until_targets_read() -> None:
    """`logged_out` vừa probe chỉ được probe ở lượt `startup` ⇒ lượt startup lỗi DB không mất cờ."""
    conn = _DownOnce(_row("logged_out", last_probe_at=NOW))
    sleeps: list[float] = []

    async def sleep(s: float) -> None:
        sleeps.append(s)
        if len(sleeps) == 3:
            raise _Stop

    loop, _, probed = _loop(conn, _result("logged_out"), sleep)
    with pytest.raises(_Stop):
        await loop.run()
    assert probed == [KEY] and conn.sql.count(q.PROBE_TARGETS) == 3
    assert conn.sql.count(q.PROBE_TRY_LOCK) == 1
