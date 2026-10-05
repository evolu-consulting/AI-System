"""WRK-FR-22 · WRK-FR-15 · WRK-FR-20 · H3a-R11–R17 · PL2–PL5 · PL8 · PL11 — vòng probe provider
subscription của process cha (plan-runtime H3a §4.3).

Mỗi nhịp: `PROBE_TARGETS` → `probe_due` → (tuần tự) khoá phiên `hub.provider.probe` theo provider
trên một kết nối pool (Runtime khác giữ ⇒ bỏ lượt) → snapshot + `probe_due` lại → (a) `auth_status`
→ (b) `probe_turn` chỉ khi (a) báo đã đăng nhập → `probe_result` (+ `ms`) → `apply_probe` → nhả khoá
(`finally`, dưới `shield`) → log + XADD `job.failed` cho job `queued` bị fail (sau commit, R2).
Lượt đầu `startup=True` thay reset mù H1 (PL2). Lỗi trong lượt ⇒ `probe.failed`, vòng chạy tiếp.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable
from contextlib import suppress
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from typing import Protocol

from agent_runtime.db import probe_sql
from agent_runtime.db.pool import DB_ERRORS, Conn, Pool
from agent_runtime.db.probe_sql import Applied
from agent_runtime.events.job_events import Failure, Tokens
from agent_runtime.log import get_logger
from agent_runtime.runtimes.cli.outcome import queued_failure
from agent_runtime.runtimes.cli.probe import ProbeHostCfg, read_fake
from agent_runtime.runtimes.cli.probe.auth import auth_status
from agent_runtime.runtimes.cli.probe.turn import ProbeSeen, probe_turn
from agent_runtime.runtimes.cli.quota_rules import ProbeCfg, ProbeResult, probe_due, probe_result

TICK_MAX_S = 5
Sleep = Callable[[float], Awaitable[None]]


class FailedEvents(Protocol):
    async def failed(self, job_id: str, run_id: str, f: Failure, usage: Tokens) -> None: ...


@dataclass(frozen=True)
class ProbeLoopCfg:
    host: ProbeHostCfg
    rules: ProbeCfg
    providers: tuple[str, ...]  # provider claim được của Runtime, trừ HTTP
    cooldown_default_s: int

    @property
    def tick_s(self) -> float:
        return float(min(TICK_MAX_S, self.rules.logged_out_s, self.rules.probe_s))


async def run_probe(cfg: ProbeLoopCfg, key: str) -> ProbeResult:
    """(a) rồi (b) khi (a) báo `loggedIn:true` (PL11: cả khi đang `logged_out`); `ms` = cả lượt."""
    started = time.monotonic()
    auth, _ = await auth_status(cfg.host, key)
    seen: ProbeSeen | None = None
    timed_out = False
    if auth is True:
        seen, timed_out = await probe_turn(cfg.host, key, read_fake(cfg.host))
    now = datetime.now(UTC)
    got = probe_result(auth, seen, timed_out=timed_out, now=now, default_s=cfg.cooldown_default_s)
    return replace(got, ms=int((time.monotonic() - started) * 1000))


Prober = Callable[[ProbeLoopCfg, str], Awaitable[ProbeResult]]


class ProbeLoop:
    def __init__(
        self,
        pool: Pool,
        events: FailedEvents,
        cfg: ProbeLoopCfg,
        sleep: Sleep = asyncio.sleep,
    ) -> None:
        self.pool, self.events, self.cfg, self._sleep = pool, events, cfg, sleep
        self.prober: Prober = run_probe

    async def run(self) -> None:
        startup = True
        while True:
            await self.round(startup=startup)
            startup = False
            await self._sleep(self.cfg.tick_s)

    async def round(self, *, startup: bool) -> None:
        log = get_logger()
        try:
            async with self.pool.acquire() as conn:
                rows = await probe_sql.targets(conn, list(self.cfg.providers))
        except DB_ERRORS as err:
            log.warning("probe.failed", provider=None, error=type(err).__name__)
            return
        for key, snap in rows:
            if probe_due(snap, self.cfg.rules, startup=startup):
                await self.one(key, startup=startup)
            elif startup:
                log.debug("probe.skipped", provider=key, reason="recent")

    async def one(self, key: str, *, startup: bool) -> None:
        """Một lượt một provider; mọi lỗi (DB/Redis/IO) ⇒ `probe.failed`, không làm chết vòng."""
        try:
            async with self.pool.acquire() as conn:
                done = await self._locked(conn, key, startup=startup)
            if done is not None:
                await self._after(key, *done)
        except Exception as err:  # noqa: BLE001 — dịch vụ nền: lượt sau thử lại
            get_logger().warning("probe.failed", provider=key, error=type(err).__name__)

    async def _locked(
        self, conn: Conn, key: str, *, startup: bool
    ) -> tuple[ProbeResult, Applied | None] | None:
        log = get_logger()
        if not await probe_sql.try_lock(conn, key):
            log.debug("probe.skipped", provider=key, reason="locked")
            return None
        try:
            snap = await probe_sql.snapshot(conn, key)
            if snap is None or not probe_due(snap, self.cfg.rules, startup=startup):
                log.debug("probe.skipped", provider=key, reason="recent")
                return None
            result = await self.prober(self.cfg, key)
            return result, await probe_sql.apply_probe(conn, key, snap, result)
        finally:
            await _unlock(conn, key)

    async def _after(self, key: str, result: ProbeResult, applied: Applied | None) -> None:
        _log_result(key, result)
        if applied is None:
            get_logger().info("probe.stale", provider=key)
            return
        _log_applied(key, result, applied)
        b = applied.broken
        if b is not None:
            for q in applied.queued_failed:
                await self.events.failed(q.id, q.run_id, queued_failure(b), Tokens())


async def _unlock(conn: Conn, key: str) -> None:
    """Nhả khoá phiên cả khi bị huỷ (shutdown); lỗi ⇒ pool `reset()` (`pg_advisory_unlock_all`)
    khi trả kết nối, hoặc bỏ kết nối hỏng — không còn khoá treo."""
    with suppress(*DB_ERRORS):
        await asyncio.shield(probe_sql.unlock(conn, key))


def _log_result(key: str, r: ProbeResult) -> None:
    get_logger().info(
        "probe.result",
        provider=key,
        ok=r.kind == "ok",
        outcome=r.kind,
        step=r.step,
        ms=r.ms,
        input_tokens=r.tokens[0],
        output_tokens=r.tokens[1],
    )


def _log_applied(key: str, r: ProbeResult, a: Applied) -> None:
    """`rt §7`: chuyển trạng thái (nguồn probe) + cảnh báo quota mỗi cửa sổ."""
    log, b = get_logger(), a.broken
    if b is not None and b.status == "cooldown":
        until = b.until.isoformat() if b.until else None
        log.warning(
            "provider.cooldown", provider=key, until=until, type=b.rate_limit_type, source="probe"
        )
    elif b is not None and b.status == "logged_out":
        log.warning("provider.logged_out", provider=key, source="probe")
    if b is not None:
        log.warning("provider.broken", provider=key, status=b.status, queued=len(a.queued_failed))
    if a.to_status == "ok" and a.from_status not in (None, "ok", "busy"):
        log.info("provider.recovered", provider=key, **{"from": a.from_status})
    w = r.warning
    if a.warned and w is not None:
        log.warning(
            "provider.quota_warning",
            provider=key,
            utilization=w.utilization,
            type=w.rate_limit_type,
            resets_at=w.window.isoformat(),
        )
