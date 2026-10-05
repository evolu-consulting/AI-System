"""WRK-FR-22 · H3a-R18 · Probe giả `fake-cli` (plan-runtime H3a §4.2, §5).

`parse_fake_probe` (thân chuyển từ `quota_rules` — PY-03a: lớp `providers` không import `runtimes`;
`quota_rules` re-export cùng tên cho P10) đọc dòng đầu file `AGENT_RT_FAKE_PROBE_FILE` (cha truyền
qua `ProbeRequest.fake`). `fake_probe` chạy trong con probe, phát sự kiện như `claude-sub`.
"""

from __future__ import annotations

import asyncio
import re
from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal

from agent_runtime.providers.base import (
    Emit,
    Fatal,
    Final,
    ProbeRequest,
    RateLimit,
    UsageEv,
    clean_type,
    clean_util,
)

FAKE_MS_MAX = 60_000
_DIGITS = re.compile(r"^[0-9]{1,12}$")
FakeProbeKind = Literal["ok", "rejected", "logged_out", "revoked", "warning", "hang", "error"]


@dataclass(frozen=True)
class FakeProbe:
    kind: FakeProbeKind
    resets_at: int | None = None
    rate_limit_type: str | None = None
    utilization: float | None = None
    ms: int | None = None


def _digits(value: str, low: int, high: int) -> int | None:
    if not _DIGITS.fullmatch(value):
        return None
    n = int(value)
    return n if low <= n <= high else None


def _fake_ok(args: list[str]) -> FakeProbe | None:
    if not args:
        return FakeProbe("ok")
    ms = _digits(args[0], 1, FAKE_MS_MAX) if len(args) == 1 else None
    return None if ms is None else FakeProbe("ok", ms=ms)


def _fake_rejected(args: list[str]) -> FakeProbe | None:
    if not args:
        return FakeProbe("rejected")
    ts = _digits(args[0], 0, 10**12)
    typ = clean_type(args[1]) if len(args) == 2 else None
    if ts is None or len(args) > 2 or (len(args) == 2 and typ is None):
        return None
    return FakeProbe("rejected", resets_at=ts, rate_limit_type=typ)


def _fake_warning(args: list[str]) -> FakeProbe | None:
    if not 1 <= len(args) <= 2:
        return None
    try:
        util = clean_util(float(args[0]))
    except ValueError:
        return None
    ts = _digits(args[1], 0, 10**12) if len(args) == 2 else None
    if util is None or (len(args) == 2 and ts is None):
        return None
    return FakeProbe("warning", resets_at=ts, utilization=util)


def _fake_bare(kind: FakeProbeKind) -> Callable[[list[str]], FakeProbe | None]:
    return lambda args: None if args else FakeProbe(kind)


_FAKE_PARSERS: dict[str, Callable[[list[str]], FakeProbe | None]] = {
    "ok": _fake_ok,
    "rejected": _fake_rejected,
    "warning": _fake_warning,
    "logged_out": _fake_bare("logged_out"),
    "revoked": _fake_bare("revoked"),
    "hang": _fake_bare("hang"),
    "error": _fake_bare("error"),
}


def parse_fake_probe(text: str | None) -> FakeProbe:
    """R18 (plan-runtime H3a §5): dòng đầu; vắng/rỗng ⇒ ok; sai cú pháp ⇒ error."""
    line = (text or "").partition("\n")[0].strip()
    if not line:
        return FakeProbe("ok")
    kind, *args = line.split(":")
    parser = _FAKE_PARSERS.get(kind)
    got = parser(args) if parser is not None else None
    return got or FakeProbe("error")


_FINAL_OK = Final(kind="text", text=None)  # probe không phát nội dung trả lời (rt §4.2)


async def _ok(fake: FakeProbe, emit: Emit) -> None:
    if fake.ms is not None:  # `ok:<ms>` (AC-10): lượt chậm rồi `ok`
        await asyncio.sleep(fake.ms / 1000)
    await emit(RateLimit(status="allowed", rate_limit_type="five_hour"))
    await emit(UsageEv.model_validate({"in": 10, "out": 1, "model": "fake"}))
    await emit(_FINAL_OK)


async def fake_probe(req: ProbeRequest, emit: Emit) -> None:
    """`rt §4.2` bảng `FakeProvider.probe`; `logged_out` ở (b) (cha không gọi) = `revoked`."""
    fake = parse_fake_probe(req.fake)
    if fake.kind == "ok":
        await _ok(fake, emit)
    elif fake.kind == "rejected":
        rl = RateLimit(
            status="rejected", resets_at=fake.resets_at, rate_limit_type=fake.rate_limit_type
        )
        await emit(rl)
        await emit(Final(kind="text", is_error=True, api_error_status=429))
    elif fake.kind in ("revoked", "logged_out"):
        await emit(Final(kind="text", is_error=True, api_error_status=401))
        await emit(RateLimit(status="logged_out"))
    elif fake.kind == "warning":
        status = "allowed_warning"
        await emit(RateLimit(status=status, resets_at=fake.resets_at, utilization=fake.utilization))
        await emit(_FINAL_OK)
    elif fake.kind == "hang":
        await asyncio.Event().wait()
    else:
        await emit(Fatal(code="UPSTREAM_ERROR", msg="fake probe error"))
