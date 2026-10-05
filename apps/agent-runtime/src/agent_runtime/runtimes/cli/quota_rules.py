"""WRK-FR-22 · WRK-FR-15 · Luật thuần quota/probe H3a (plan-runtime H3a §3). Không I/O, không SDK.

PY-00: khung — dataclass + chữ ký; thân hàm `raise NotImplementedError` tới PY-01.
"""

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal, Protocol

from agent_runtime.providers.base import Fatal, Final, RateLimit

COOLDOWN_MAX = timedelta(days=8)
RATE_TYPE_PATTERN = r"^[a-z0-9_]{1,40}$"

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
    """Tín hiệu gom từ process con probe (`ProbeSeen`, PY-03)."""

    @property
    def rate_limit(self) -> RateLimit | None: ...
    @property
    def final(self) -> Final | None: ...
    @property
    def fatal(self) -> Fatal | None: ...


def cooldown_until(resets_at: int | None, now: datetime, default_s: int) -> datetime:
    """R02."""
    raise NotImplementedError


def clean_type(value: object) -> str | None:
    """Regex `RATE_TYPE_PATTERN`; sai ⇒ None."""
    raise NotImplementedError


def clean_util(value: object) -> float | None:
    """Số hữu hạn ∈ [0,1]; sai ⇒ None (bool ⇒ None)."""
    raise NotImplementedError


def warn_window(resets_at: int | None, now: datetime) -> datetime:
    """R03."""
    raise NotImplementedError


def raw_shape(raw: Mapping[str, object] | None) -> dict[str, str] | None:
    """R04."""
    raise NotImplementedError


def probe_due(snap: ProviderSnap, cfg: ProbeCfg, *, startup: bool) -> bool:
    """R12, R13."""
    raise NotImplementedError


def auth_logged_in(exit_code: int, stdout: bytes) -> bool | None:
    """R14(a)."""
    raise NotImplementedError


def probe_result(  # noqa: PLR0913 — chữ ký theo plan-runtime H3a §3
    auth: bool | None,
    seen: ProbeSeenLike | None,
    *,
    timed_out: bool,
    now: datetime,
    default_s: int,
) -> ProbeResult:
    """R14(b), R01."""
    raise NotImplementedError


def probe_transition(snap: ProviderSnap, result: ProbeResult) -> Transition:
    """R15."""
    raise NotImplementedError


def parse_fake_probe(text: str | None) -> FakeProbe:
    """R18."""
    raise NotImplementedError
