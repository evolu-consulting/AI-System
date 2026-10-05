"""WRK-FR-22 · WRK-FR-15 · Luật thuần quota/probe H3a (plan-runtime H3a §3). Không I/O, không SDK.

PY-01: `seen.rate_limit` đọc theo thuộc tính (`rate_limit_type`/`utilization` có ở `RateLimit` từ
PY-02) — không `isinstance`. `ProbeResult.message` là câu cố định (không chép chữ provider); `ms`
= 0 ở đây, nơi gọi (`probe/`, PY-03) điền thời gian đo được.
"""

import json
import math
import re
from collections.abc import Callable
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta
from typing import Literal, Protocol, cast

from agent_runtime.providers.base import RAW_SHAPE_MAX_KEY as RAW_SHAPE_MAX_KEY
from agent_runtime.providers.base import RAW_SHAPE_MAX_KEYS as RAW_SHAPE_MAX_KEYS
from agent_runtime.providers.base import Fatal, Final, RateLimit, UsageEv
from agent_runtime.providers.base import raw_shape as raw_shape  # R04 (dùng chung với mapping)
from agent_runtime.providers.patterns import LOGGED_OUT, REJECTED, classify_text

COOLDOWN_MAX = timedelta(days=8)
RATE_TYPE_PATTERN = r"^[a-z0-9_]{1,40}$"
RATE_TYPE_RE = re.compile(RATE_TYPE_PATTERN)
FAKE_MS_MAX = 60_000
_DIGITS = re.compile(r"^[0-9]{1,12}$")

Transition = Literal["healthy", "recover", "seen", "broken", "error"]
ProbeKind = Literal["ok", "cooldown", "logged_out", "error"]
ProbeStep = Literal["auth", "turn"]
FakeProbeKind = Literal["ok", "rejected", "logged_out", "revoked", "warning", "hang", "error"]


@dataclass(frozen=True)
class Warning:
    utilization: float | None
    rate_limit_type: str | None
    window: datetime


@dataclass(frozen=True)
class ProviderSnap:
    status: str | None  # None = chưa có hàng provider_state
    cooldown_until: datetime | None
    last_probe_at: datetime | None
    last_ok_at: datetime | None
    consecutive_errors: int
    updated_at: datetime | None
    db_now: datetime


@dataclass(frozen=True)
class ProbeCfg:
    probe_s: int
    logged_out_s: int


@dataclass(frozen=True)
class ProbeResult:
    kind: ProbeKind
    until: datetime | None
    rate_limit_type: str | None
    utilization: float | None
    warning: Warning | None
    message: str  # ≤ 500, không PII
    tokens: tuple[int, int]
    ms: int
    step: ProbeStep


@dataclass(frozen=True)
class FakeProbe:
    kind: FakeProbeKind
    resets_at: int | None = None
    rate_limit_type: str | None = None
    utilization: float | None = None
    ms: int | None = None


class ProbeSeenLike(Protocol):
    """Tín hiệu gom từ process con probe (`ProbeSeen`, PY-03; trường theo plan-runtime §2)."""

    @property
    def rate_limit(self) -> RateLimit | None: ...
    @property
    def final(self) -> Final | None: ...
    @property
    def fatal(self) -> Fatal | None: ...
    @property
    def usage(self) -> UsageEv | None: ...


def _reset_time(resets_at: object, now: datetime) -> datetime | None:
    """`resets_at` (giây Unix) hợp lệ khi `now < t ≤ now + COOLDOWN_MAX`; ngược lại None."""
    if not isinstance(resets_at, int) or isinstance(resets_at, bool):
        return None
    try:
        t = datetime.fromtimestamp(resets_at, UTC)
    except (OverflowError, OSError, ValueError):
        return None
    return t if now < t <= now + COOLDOWN_MAX else None


def cooldown_until(resets_at: int | None, now: datetime, default_s: int) -> datetime:
    """R02."""
    return _reset_time(resets_at, now) or now + timedelta(seconds=default_s)


def clean_type(value: object) -> str | None:
    """Regex `RATE_TYPE_PATTERN`; sai ⇒ None."""
    if isinstance(value, str) and RATE_TYPE_RE.fullmatch(value):
        return value
    return None


def clean_util(value: object) -> float | None:
    """Số hữu hạn ∈ [0,1]; sai ⇒ None (bool ⇒ None)."""
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    x = float(value)
    return x if math.isfinite(x) and 0.0 <= x <= 1.0 else None


def warn_window(resets_at: int | None, now: datetime) -> datetime:
    """R03."""
    return _reset_time(resets_at, now) or now.replace(minute=0, second=0, microsecond=0)


def _elapsed(since: datetime | None, now: datetime, seconds: int) -> bool:
    return since is None or now - since >= timedelta(seconds=seconds)


def _cooldown_due(snap: ProviderSnap) -> bool:
    until, last = snap.cooldown_until, snap.last_probe_at
    return until is None or (until <= snap.db_now and (last is None or last < until))


def probe_due(snap: ProviderSnap, cfg: ProbeCfg, *, startup: bool) -> bool:
    """R12, R13."""
    if cfg.probe_s <= 0:
        return False
    s, now = snap.status, snap.db_now
    if s is None:
        return True
    if s == "cooldown":
        return _cooldown_due(snap)  # PL3: cả khi khởi động
    if s == "logged_out":
        return startup or _elapsed(snap.last_probe_at, now, cfg.logged_out_s)
    last_ok = snap.last_ok_at
    if s in ("ok", "busy") and last_ok is not None and not _elapsed(last_ok, now, cfg.probe_s):
        return False  # R12: job thật vừa thành công, cả khi khởi động
    return startup or _elapsed(snap.last_probe_at, now, cfg.probe_s)


def auth_logged_in(exit_code: int, stdout: bytes) -> bool | None:
    """R14(a)."""
    if exit_code != 0:
        return False
    try:
        doc: object = json.loads(stdout)
    except ValueError:  # gồm JSONDecodeError, UnicodeDecodeError
        return None
    if not isinstance(doc, dict):
        return None
    value = cast(dict[str, object], doc).get("loggedIn")
    return value if isinstance(value, bool) else None


def _base(kind: ProbeKind, step: ProbeStep, message: str) -> ProbeResult:
    return ProbeResult(kind, None, None, None, None, message, (0, 0), 0, step)


def _tokens(usage: UsageEv | None) -> tuple[int, int]:
    if usage is None:
        return (0, 0)
    return (usage.input + usage.cache_read + usage.cache_write, usage.output)


def _rl_type(rl: RateLimit | None) -> str | None:
    return clean_type(getattr(rl, "rate_limit_type", None))


def _rl_util(rl: RateLimit | None) -> float | None:
    return clean_util(getattr(rl, "utilization", None))


def _rate_limited(resets_at: int | None, now: datetime, default_s: int) -> ProbeResult:
    until = cooldown_until(resets_at, now, default_s)
    return replace(_base("cooldown", "turn", "provider rate limited"), until=until)


def _is_error(final: Final, now: datetime, default_s: int) -> ProbeResult:
    """Chữ result chỉ để phân loại (patterns H2b), không vào `message`."""
    kind = classify_text(final.text or final.raw_json or " ".join(final.errors))
    if kind == REJECTED:
        return _rate_limited(None, now, default_s)
    if kind == LOGGED_OUT:
        return _base("logged_out", "turn", "provider logged out")
    return _base("error", "turn", "provider returned an error")


def _turn(seen: ProbeSeenLike, now: datetime, default_s: int) -> ProbeResult:
    """R01 theo thứ tự: rate_limit rejected → logged_out → fatal → không final → is_error."""
    rl = seen.rate_limit
    if rl is not None and rl.status == REJECTED:
        return _rate_limited(rl.resets_at, now, default_s)
    if rl is not None and rl.status == LOGGED_OUT:
        return _base("logged_out", "turn", "provider logged out")
    if seen.fatal is not None:
        return _base("error", "turn", "probe child failed")
    final = seen.final
    if final is None:
        return _base("error", "turn", "probe produced no result")
    if final.is_error:
        return _is_error(final, now, default_s)
    ok = _base("ok", "turn", "ok")
    if rl is None or rl.status != "allowed_warning":
        return ok
    window = warn_window(rl.resets_at, now)
    return replace(ok, warning=Warning(_rl_util(rl), _rl_type(rl), window))


def probe_result(  # noqa: PLR0913 — chữ ký theo plan-runtime H3a §3
    auth: bool | None,
    seen: ProbeSeenLike | None,
    *,
    timed_out: bool,
    now: datetime,
    default_s: int,
) -> ProbeResult:
    """R14(b), R01."""
    if auth is None:
        return _base("error", "auth", "auth status unreadable")
    if auth is False:
        return _base("logged_out", "auth", "not logged in")  # (a) dừng, không đọc `seen`
    if seen is None:
        return _base("ok", "auth", "ok")  # (b) không chạy (R12) — dành cho test
    if timed_out:
        return _base("error", "turn", "probe timed out")
    rl = seen.rate_limit
    got = _turn(seen, now, default_s)
    return replace(
        got, rate_limit_type=_rl_type(rl), utilization=_rl_util(rl), tokens=_tokens(seen.usage)
    )


def probe_transition(snap: ProviderSnap, result: ProbeResult) -> Transition:
    """R15."""
    s, kind = snap.status or "ok", result.kind
    if kind == "ok":
        return "healthy" if s in ("ok", "busy") else "recover"
    if kind == "error":
        return "error"
    same = s == kind and (kind == "logged_out" or result.until == snap.cooldown_until)
    return "seen" if same else "broken"


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
