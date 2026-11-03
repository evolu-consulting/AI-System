"""CR-116 probe · công cụ đo (không đổi hành vi): `with probe("tên"):` đo wall ms, CPU ms
(`time.process_time`), RSS delta (KiB) và — với DB — số câu SQL + round trip qua `ProbeConnection`
(lớp Connection của asyncpg đếm câu; `create_pool` dùng khi bật). Tắt (mặc định) ⇒ `probe` là
context manager rỗng, không ghi gì, pool nguyên bản. Bật bằng env `PERF_PROBE=1` (đọc MỘT lần lúc
nạp module). Một dòng kv/lần đo, cùng khuôn `log_kv.py`/hub-api:
`t=<epoch s> e=probe.<tên> ms= cpu= rss= sql= rt=`. Số cpu/rss/sql/rt là TOÀN TIẾN TRÌNH trong
khoảng probe — chạy kịch bản tuần tự. `sql` = câu nghiệp vụ (không tính begin/commit/savepoint);
`rt` = số lời gọi asyncpg gửi tới server (mỗi `execute`/`fetch*` = 1 round trip, kể cả begin/commit).
"""

from __future__ import annotations

import math
import os
import re
import resource
import sys
import time
from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any

_ENABLED = os.environ.get("PERF_PROBE") == "1"
_CTL = re.compile(r"^\s*(begin|commit|rollback|savepoint|release)\b", re.IGNORECASE)
_NEEDS_QUOTE = re.compile(r'[\s="\\]')
_SQL = [0, 0]  # [câu nghiệp vụ, round trip]


@dataclass(frozen=True)
class ProbeSample:
    name: str
    ms: float
    cpu: float
    rss: int
    sql: int
    rt: int


_SAMPLES: list[ProbeSample] = []
_MAX_SAMPLES = 200_000


def set_probe(on: bool) -> None:
    """Bật/tắt tay (test). Không đụng env."""
    global _ENABLED  # noqa: PLW0603
    _ENABLED = on


def probe_on() -> bool:
    return _ENABLED


def probe_samples() -> list[ProbeSample]:
    return list(_SAMPLES)


def reset_probe() -> None:
    _SAMPLES.clear()
    _SQL[0] = _SQL[1] = 0


def _rss_kib() -> int:
    """RSS hiện tại (KiB): /proc/self/statm (Linux); không có thì đỉnh `ru_maxrss`."""
    try:
        with open("/proc/self/statm", encoding="ascii") as f:
            return int(f.read().split()[1]) * (os.sysconf("SC_PAGE_SIZE") // 1024)
    except (OSError, ValueError, IndexError):
        return int(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)


def probe_line(name: str, fields: Mapping[str, object], now: float | None = None) -> str:
    parts = [f"t={int(now if now is not None else time.time())}", f"e=probe.{name}"]
    for k, v in fields.items():
        if v is None:
            continue
        s = str(v)
        parts.append(f'{k}="{s}"' if _NEEDS_QUOTE.search(s) else f"{k}={s}")
    return " ".join(parts)


def probe_emit(name: str, **fields: object) -> None:
    """Ghi một dòng probe ra stdout (chỉ khi bật)."""
    if _ENABLED:
        sys.stdout.write(probe_line(name, fields) + "\n")
        sys.stdout.flush()


@contextmanager
def probe(name: str) -> Iterator[None]:
    """Đo khối `with` (dùng được quanh `await`). Tắt ⇒ không làm gì."""
    if not _ENABLED:
        yield
        return
    t0, c0, r0, s0, q0 = time.perf_counter(), time.process_time(), _rss_kib(), *_SQL
    try:
        yield
    finally:
        s = ProbeSample(
            name=name,
            ms=round((time.perf_counter() - t0) * 1000, 1),
            cpu=round((time.process_time() - c0) * 1000, 1),
            rss=_rss_kib() - r0,
            sql=_SQL[0] - s0,
            rt=_SQL[1] - q0,
        )
        if len(_SAMPLES) < _MAX_SAMPLES:
            _SAMPLES.append(s)
        probe_emit(name, ms=s.ms, cpu=s.cpu, rss=s.rss, sql=s.sql, rt=s.rt)


def pctile(xs: list[float], p: float) -> float:
    if not xs:
        return 0.0
    s = sorted(xs)
    return s[min(len(s) - 1, max(0, math.ceil(p / 100 * len(s)) - 1))]


def probe_stats(samples: list[ProbeSample] | None = None) -> dict[str, dict[str, float]]:
    """Gom theo tên: n, p50, p95, mean (ms)."""
    by: dict[str, list[float]] = {}
    for s in samples if samples is not None else _SAMPLES:
        by.setdefault(s.name, []).append(s.ms)
    return {
        k: {"n": len(v), "p50": pctile(v, 50), "p95": pctile(v, 95), "mean": round(sum(v) / len(v), 1)}
        for k, v in by.items()
    }


def count_query(query: object) -> None:
    """Đếm một lời gọi asyncpg (tap của `ProbeConnection`)."""
    _SQL[1] += 1
    if not _CTL.match(str(query)):
        _SQL[0] += 1


def probe_connection_class(base: type[Any]) -> type[Any]:
    """Lớp con của `asyncpg.Connection` đếm câu/round trip. Gọi chỉ khi bật."""

    class ProbeConnection(base):  # type: ignore[misc, valid-type]
        async def execute(self, query: str, *args: Any, **kw: Any) -> Any:
            count_query(query)
            return await super().execute(query, *args, **kw)

        async def fetch(self, query: str, *args: Any, **kw: Any) -> Any:
            count_query(query)
            return await super().fetch(query, *args, **kw)

        async def fetchrow(self, query: str, *args: Any, **kw: Any) -> Any:
            count_query(query)
            return await super().fetchrow(query, *args, **kw)

        async def fetchval(self, query: str, *args: Any, **kw: Any) -> Any:
            count_query(query)
            return await super().fetchval(query, *args, **kw)

        async def executemany(self, command: str, args: Any, **kw: Any) -> Any:
            count_query(command)
            return await super().executemany(command, args, **kw)

    return ProbeConnection
