"""P01–P12 · luật thuần quota/probe Runtime H3a — unit, QW-PU (khoá Q-PU trước PY-01).

Chữ ký: `plan-runtime.md` H3a §3 (`runtimes/cli/quota_rules.py`), §5 (`fake-cli` probe), §8;
bảng ca `test-plan-py.md` §1. Đỏ đúng lý do trước PY-01 = `NotImplementedError` của stub PY-00
(dataclass thật nên import được). P11 (hằng) và P12 (`mapping.result_signal`, H1) xanh trước code.

`seen` của `probe_result` là đối tượng vịt (`_Seen`/`_Rl`) thoả `ProbeSeenLike`: `RateLimit` chỉ
có `rate_limit_type`/`utilization` từ PY-02 (`plan-runtime` §2), mà PY-01 phải xanh trước đó.
`RATE_TYPE_RE` (plan §3) hiện thực ở stub là chuỗi `RATE_TYPE_PATTERN` — P11 dùng tên stub.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta
from typing import Any, cast

import pytest
from claude_agent_sdk import ResultMessage

from agent_runtime.providers.base import Fatal, Final, RateLimit, UsageEv
from agent_runtime.providers.claude.mapping import result_signal
from agent_runtime.runtimes.cli import quota_rules as qr
from agent_runtime.runtimes.cli.quota_rules import (
    FakeProbe,
    ProbeCfg,
    ProbeResult,
    ProviderSnap,
    Warning,
)

NOW = datetime(2026, 10, 6, tzinfo=UTC)
DEFAULT_S = 1800
CFG = ProbeCfg(probe_s=1200, logged_out_s=60)
S = timedelta(seconds=1)


def ts(delta: timedelta) -> int:
    return int((NOW + delta).timestamp())


def snap(  # noqa: PLR0913 — dựng ProviderSnap theo test-plan-py §1
    status: str | None,
    *,
    until: datetime | None = None,
    last_probe: datetime | None = None,
    last_ok: datetime | None = None,
    errors: int = 0,
    db_now: datetime = NOW,
) -> ProviderSnap:
    return ProviderSnap(
        status=status,
        cooldown_until=until,
        last_probe_at=last_probe,
        last_ok_at=last_ok,
        consecutive_errors=errors,
        updated_at=None,
        db_now=db_now,
    )


@dataclass(frozen=True)
class _Rl:
    status: str
    resets_at: int | None = None
    rate_limit_type: str | None = None
    utilization: float | None = None
    raw_shape: dict[str, str] | None = None


@dataclass(frozen=True)
class _Seen:
    rate_limit: Any = None
    final: Final | None = None
    fatal: Fatal | None = None
    usage: UsageEv | None = None


class _Untouchable:
    """`seen` không được đọc khi `auth is False` (R14 bước (a) dừng)."""

    @property
    def rate_limit(self) -> RateLimit | None:
        raise AssertionError("đọc seen.rate_limit")

    @property
    def final(self) -> Final | None:
        raise AssertionError("đọc seen.final")

    @property
    def fatal(self) -> Fatal | None:
        raise AssertionError("đọc seen.fatal")


def _ok_final() -> Final:
    return Final(kind="text", text="ok")


def _err_final(text: str) -> Final:
    return Final(kind="text", text=text, is_error=True)


def _usage() -> UsageEv:
    return UsageEv.model_validate({"in": 10, "out": 1})


def _run(seen: Any, *, auth: bool | None = True, timed_out: bool = False) -> ProbeResult:
    return qr.probe_result(auth, seen, timed_out=timed_out, now=NOW, default_s=DEFAULT_S)


# ---------------------------------------------------------------- P01 cooldown_until (AC-01, R02)


@pytest.mark.parametrize(
    ("resets_at", "expected"),
    [
        (None, NOW + timedelta(seconds=DEFAULT_S)),
        (ts(-S), NOW + timedelta(seconds=DEFAULT_S)),
        (ts(timedelta(0)), NOW + timedelta(seconds=DEFAULT_S)),
        (ts(S), NOW + S),
        (ts(timedelta(days=8)), NOW + timedelta(days=8)),
        (ts(timedelta(days=8) + S), NOW + timedelta(seconds=DEFAULT_S)),
    ],
    ids=["none", "past", "now", "plus_1s", "plus_8d_edge", "plus_8d_1s"],
)
def test_wrk_fr_22_p01_cooldown_until(resets_at: int | None, expected: datetime) -> None:
    """WRK-FR-22 · P01 · cooldown_until: resets_at hợp lệ (now < t ≤ now+8 ngày) ⇒ t, ngược lại
    ⇒ now+default_s; kết quả UTC [H3a-R02 · HUB-H3a-AC-01]"""
    got = qr.cooldown_until(resets_at, NOW, DEFAULT_S)
    assert got == expected
    assert got.utcoffset() == timedelta(0)


def test_wrk_fr_22_p01_cooldown_until_default_s() -> None:
    """WRK-FR-22 · P01 · cooldown_until: default_s=60 ⇒ now+60 s [H3a-R02 · HUB-H3a-AC-01]"""
    assert qr.cooldown_until(None, NOW, 60) == NOW + timedelta(seconds=60)


# ---------------------------------------------------------------- P02 clean_type (R02)


@pytest.mark.parametrize("value", ["five_hour", "seven_day_opus", "overage", "a" * 40])
def test_wrk_fr_22_p02_clean_type_keeps(value: str) -> None:
    """WRK-FR-22 · P02 · clean_type: khớp ^[a-z0-9_]{1,40}$ ⇒ giữ [H3a-R02]"""
    assert qr.clean_type(value) == value


@pytest.mark.parametrize(
    "value",
    ["Five-Hour", "", "a" * 41, 5, None, "x y"],
    ids=["upper_dash", "empty", "len41", "int", "none", "space"],
)
def test_wrk_fr_22_p02_clean_type_rejects(value: object) -> None:
    """WRK-FR-22 · P02 · clean_type: sai regex / không phải str ⇒ None [H3a-R02]"""
    assert qr.clean_type(value) is None


# ---------------------------------------------------------------- P03 clean_util (R02, R03)


@pytest.mark.parametrize(("value", "expected"), [(0, 0.0), (1, 1.0), (0.85, 0.85)])
def test_wrk_fr_22_p03_clean_util_keeps(value: object, expected: float) -> None:
    """WRK-FR-22 · P03 · clean_util: số hữu hạn ∈ [0,1] ⇒ float [H3a-R02 · H3a-R03]"""
    got = qr.clean_util(value)
    assert isinstance(got, float)
    assert got == expected


@pytest.mark.parametrize(
    "value",
    [-0.01, 1.01, math.nan, math.inf, True, False, "0.5", None],
    ids=["neg", "over1", "nan", "inf", "true", "false", "str", "none"],
)
def test_wrk_fr_22_p03_clean_util_rejects(value: object) -> None:
    """WRK-FR-22 · P03 · clean_util: ngoài [0,1], không hữu hạn, bool, chuỗi ⇒ None
    [H3a-R02 · H3a-R03]"""
    assert qr.clean_util(value) is None


# ---------------------------------------------------------------- P04 warn_window (R03, PL14)

ODD_NOW = datetime(2026, 10, 6, 10, 37, 12, tzinfo=UTC)
ODD_HOUR = datetime(2026, 10, 6, 10, 0, 0, tzinfo=UTC)


def test_wrk_fr_22_p04_warn_window_valid() -> None:
    """WRK-FR-22 · P04 · warn_window: resets_at hợp lệ ⇒ đúng thời điểm đó [H3a-R03 · PL14]"""
    target = ODD_NOW + timedelta(hours=2)
    assert qr.warn_window(int(target.timestamp()), ODD_NOW) == target


_FLOOR = {"none": None, "past": -S, "now": timedelta(0), "over_8d": timedelta(days=8) + S}


@pytest.mark.parametrize("delta", _FLOOR.values(), ids=_FLOOR)
def test_wrk_fr_22_p04_warn_window_hour_floor(delta: timedelta | None) -> None:
    """WRK-FR-22 · P04 · warn_window: resets_at sai ⇒ now cắt đầu giờ UTC (10:37:12 → 10:00:00)
    [H3a-R03 · PL14]"""
    resets_at = None if delta is None else int((ODD_NOW + delta).timestamp())
    got = qr.warn_window(resets_at, ODD_NOW)
    assert got == ODD_HOUR
    assert got.utcoffset() == timedelta(0)


# ---------------------------------------------------------------- P05 raw_shape (R04, AC-11)


@pytest.mark.parametrize("raw", [None, [1], "x"], ids=["none", "list", "str"])
def test_wrk_fr_22_p05_raw_shape_not_mapping(raw: object) -> None:
    """WRK-FR-22 · P05 · raw_shape: None / không phải Mapping ⇒ None [H3a-R04 · HUB-H3a-AC-11]"""
    assert qr.raw_shape(cast(Any, raw)) is None


def test_wrk_fr_22_p05_raw_shape_type_names() -> None:
    """WRK-FR-22 · P05 · raw_shape: giá trị ⇒ tên kiểu Python [H3a-R04 · HUB-H3a-AC-11]"""
    names = ["status", "resetsAt", "util", "ok", "x", "d", "l"]
    values: list[object] = ["rejected", 1, 0.5, True, None, {}, []]
    kinds = ["str", "int", "float", "bool", "NoneType", "dict", "list"]
    raw = dict(zip(names, values, strict=True))
    assert qr.raw_shape(raw) == dict(zip(names, kinds, strict=True))


def test_wrk_fr_22_p05_raw_shape_caps_keys() -> None:
    """WRK-FR-22 · P05 · raw_shape: 31 khoá ⇒ 30 khoá đầu theo thứ tự [H3a-R04 · HUB-H3a-AC-11]"""
    raw: dict[str, object] = {f"k{i:02d}": i for i in range(31)}
    got = qr.raw_shape(raw)
    assert got is not None
    assert list(got) == [f"k{i:02d}" for i in range(30)]


def test_wrk_fr_22_p05_raw_shape_cuts_long_key() -> None:
    """WRK-FR-22 · P05 · raw_shape: khoá 61 ký tự ⇒ cắt 60 [H3a-R04 · HUB-H3a-AC-11]"""
    long_key = "k" * 61
    assert qr.raw_shape({long_key: 1}) == {"k" * 60: "int"}


def test_wrk_fr_22_p05_raw_shape_no_values() -> None:
    """WRK-FR-22 · P05 · raw_shape: không chép giá trị (không PII) [H3a-R04 · HUB-H3a-AC-11]"""
    got = qr.raw_shape({"email": "user@x.com", "org": "Acme-Secret-Org"})
    assert got == {"email": "str", "org": "str"}
    assert "user@x.com" not in repr(got)
    assert "Acme-Secret-Org" not in repr(got)


# ---------------------------------------------------------------- P06 probe_due (R12, R13, AC-09)


def ago(seconds: int) -> datetime:
    return NOW - seconds * S


# id → (snap, startup, expected); cfg = CFG (probe_s=1200, logged_out_s=60), now = db_now
_DUE: dict[str, tuple[ProviderSnap, bool, bool]] = {
    "none_row": (snap(None), False, True),
    "cooldown_until_none": (snap("cooldown"), False, True),
    "cooldown_future": (snap("cooldown", until=NOW + S), False, False),
    "cooldown_future_startup": (snap("cooldown", until=NOW + S), True, False),
    "cooldown_past_never_probed": (snap("cooldown", until=ago(1)), False, True),
    "cooldown_past_probed_at_until": (
        snap("cooldown", until=ago(1), last_probe=ago(1)),
        False,
        False,
    ),
    "cooldown_past_probed_after": (snap("cooldown", until=ago(10), last_probe=ago(1)), True, False),
    "cooldown_past_probed_before": (snap("cooldown", until=ago(1), last_probe=ago(2)), False, True),
    "logged_out_startup": (snap("logged_out", last_probe=ago(1)), True, True),
    "logged_out_never_probed": (snap("logged_out"), False, True),
    "logged_out_59s": (snap("logged_out", last_probe=ago(59)), False, False),
    "logged_out_60s": (snap("logged_out", last_probe=ago(60)), False, True),
    "error_startup": (snap("error", last_probe=ago(1)), True, True),
    "error_never_probed": (snap("error"), False, True),
    "error_1199s": (snap("error", last_probe=ago(1199)), False, False),
    "error_1200s": (snap("error", last_probe=ago(1200)), False, True),
    "ok_last_ok_1199s": (snap("ok", last_ok=ago(1199)), False, False),
    "ok_last_ok_1199s_startup": (snap("ok", last_ok=ago(1199)), True, False),
    "busy_last_ok_1199s": (snap("busy", last_ok=ago(1199)), False, False),
    "busy_last_ok_1199s_startup": (snap("busy", last_ok=ago(1199)), True, False),
    "ok_last_ok_1200s_startup": (snap("ok", last_ok=ago(1200), last_probe=ago(10)), True, True),
    "ok_no_last_ok_recent_probe": (snap("ok", last_probe=ago(10)), False, False),
    "ok_no_last_ok_probe_1200s": (snap("ok", last_probe=ago(1200)), False, True),
    "busy_never": (snap("busy"), False, True),
}


@pytest.mark.parametrize(("snapshot", "startup", "expected"), _DUE.values(), ids=_DUE)
def test_wrk_fr_22_p06_probe_due(snapshot: ProviderSnap, startup: bool, expected: bool) -> None:
    """WRK-FR-22 · P06 · probe_due theo bảng 5 trạng thái × startup, mốc now = db_now
    [H3a-R12 · H3a-R13 · HUB-H3a-AC-09 · PL3]"""
    assert qr.probe_due(snapshot, CFG, startup=startup) is expected


@pytest.mark.parametrize("status", [None, "ok", "busy", "cooldown", "logged_out", "error"])
def test_wrk_fr_22_p06_probe_due_off(status: str | None) -> None:
    """WRK-FR-22 · P06 · probe_due: probe_s = 0 ⇒ False mọi trạng thái (cả startup)
    [H3a-R13 · HUB-H3a-AC-09]"""
    off = ProbeCfg(probe_s=0, logged_out_s=60)
    assert qr.probe_due(snap(status, until=ago(1)), off, startup=True) is False


def test_wrk_fr_22_p06_probe_due_uses_db_now() -> None:
    """WRK-FR-22 · P06 · probe_due đo theo snap.db_now, không theo đồng hồ máy
    [H3a-R12 · HUB-H3a-AC-09]"""
    old = datetime(2020, 1, 1, tzinfo=UTC)
    stale = snap("error", last_probe=old - 10 * S, db_now=old)
    assert qr.probe_due(stale, CFG, startup=False) is False


# ---------------------------------------------------------------- P07 auth_logged_in (R14(a), PL7)

_AUTH: dict[str, tuple[int, bytes, bool | None]] = {
    "exit1_json": (1, b'{"loggedIn":false}', False),
    "exit1_empty": (1, b"", False),
    "killed": (-9, b"", False),
    "ok_true": (0, b'{"loggedIn":true,"email":"a@b"}', True),
    "ok_false": (0, b'{"loggedIn":false}', False),
    "bad_json": (0, b"not json", None),
    "missing_key": (0, b"{}", None),
    "str_bool": (0, b'{"loggedIn":"true"}', None),
    "array": (0, b"[true]", None),
}


@pytest.mark.parametrize(("exit_code", "stdout", "expected"), _AUTH.values(), ids=_AUTH)
def test_wrk_fr_22_p07_auth_logged_in(exit_code: int, stdout: bytes, expected: bool | None) -> None:
    """WRK-FR-22 · P07 · auth_logged_in: exit≠0 ⇒ False; exit 0 + loggedIn bool ⇒ giá trị;
    parse sai/thiếu/sai kiểu ⇒ None [H3a-R14 · PL7]"""
    assert qr.auth_logged_in(exit_code, stdout) is expected


# ---------------------------------------------------------------- P08 probe_result (R14(b), R01)


def test_wrk_fr_22_p08_auth_none_is_error() -> None:
    """WRK-FR-22 · P08 · probe_result: auth None ⇒ error [H3a-R14 · HUB-H3a-AC-02]"""
    assert _run(_Seen(final=_ok_final()), auth=None).kind == "error"


def test_wrk_fr_22_p08_auth_false_logged_out_skips_seen() -> None:
    """WRK-FR-22 · P08 · probe_result: auth False ⇒ logged_out, step auth, không đọc seen
    [H3a-R14 · HUB-H3a-AC-02]"""
    got = _run(_Untouchable(), auth=False)
    assert got.kind == "logged_out"
    assert got.step == "auth"


def test_wrk_fr_22_p08_seen_none_ok() -> None:
    """WRK-FR-22 · P08 · probe_result: auth True + seen None ⇒ ok [H3a-R14]"""
    assert _run(None).kind == "ok"


def test_wrk_fr_22_p08_timed_out_error() -> None:
    """WRK-FR-22 · P08 · probe_result: timed_out ⇒ error [H3a-R14]"""
    assert _run(_Seen(final=_ok_final()), timed_out=True).kind == "error"


def test_wrk_fr_22_p08_rejected_cooldown_keeps_type() -> None:
    """WRK-FR-22 · P08 · probe_result: rate_limit rejected + resets_at +1 h + five_hour ⇒
    cooldown(until=resets_at), type giữ [H3a-R01 · H3a-R02 · HUB-H3a-AC-02]"""
    rl = _Rl(status="rejected", resets_at=ts(timedelta(hours=1)), rate_limit_type="five_hour")
    got = _run(_Seen(rate_limit=rl, final=_err_final("x")))
    assert got.kind == "cooldown"
    assert got.until == NOW + timedelta(hours=1)
    assert got.rate_limit_type == "five_hour"
    assert got.step == "turn"


def test_wrk_fr_22_p08_rejected_beats_auth_text() -> None:
    """WRK-FR-22 · P08 · probe_result thứ tự R01: rejected + final.is_error 'Not logged in' ⇒
    cooldown [H3a-R01 · HUB-H3a-AC-02]"""
    seen = _Seen(rate_limit=_Rl(status="rejected"), final=_err_final("Not logged in"))
    got = _run(seen)
    assert got.kind == "cooldown"
    assert got.until == NOW + timedelta(seconds=DEFAULT_S)


def test_wrk_fr_22_p08_rate_limit_logged_out() -> None:
    """WRK-FR-22 · P08 · probe_result: rate_limit.status logged_out ⇒ logged_out
    [H3a-R01 · HUB-H3a-AC-02]"""
    got = _run(_Seen(rate_limit=_Rl(status="logged_out"), final=_ok_final()))
    assert got.kind == "logged_out"


def test_wrk_fr_22_p08_fatal_error() -> None:
    """WRK-FR-22 · P08 · probe_result: fatal ⇒ error [H3a-R01 · H3a-R14]"""
    seen = _Seen(final=_ok_final(), fatal=Fatal(code="spawn", msg="boom"))
    assert _run(seen).kind == "error"


def test_wrk_fr_22_p08_final_none_error() -> None:
    """WRK-FR-22 · P08 · probe_result: không có final ⇒ error [H3a-R14]"""
    assert _run(_Seen()).kind == "error"


@pytest.mark.parametrize(
    ("text", "kind"),
    [
        ("You've hit your usage limit", "cooldown"),
        ("Not logged in · Please run /login", "logged_out"),
        ("boom secret-pii-mail@x.com", "error"),
    ],
    ids=["usage_limit", "not_logged_in", "other"],
)
def test_wrk_fr_22_p08_final_is_error_text(text: str, kind: str) -> None:
    """WRK-FR-22 · P08 · probe_result: final.is_error ⇒ classify_text: rate ⇒ cooldown
    (now+default_s), auth ⇒ logged_out, khác ⇒ error; message ≤ 500 không chép chữ final
    [H3a-R01 · HUB-H3a-AC-02]"""
    got = _run(_Seen(final=_err_final(text)))
    assert got.kind == kind
    if kind == "cooldown":
        assert got.until == NOW + timedelta(seconds=DEFAULT_S)
    assert len(got.message) <= 500
    assert text not in got.message
    assert "secret-pii-mail@x.com" not in got.message


def test_wrk_fr_22_p08_ok_with_warning() -> None:
    """WRK-FR-22 · P08 · probe_result: allowed_warning util 0.85 ⇒ ok + Warning(0.85, type,
    window) [H3a-R01 · H3a-R03 · HUB-H3a-AC-02]"""
    reset = NOW + timedelta(hours=2)
    rl = _Rl(
        status="allowed_warning",
        resets_at=int(reset.timestamp()),
        rate_limit_type="five_hour",
        utilization=0.85,
    )
    got = _run(_Seen(rate_limit=rl, final=_ok_final(), usage=_usage()))
    assert got.kind == "ok"
    assert got.warning == Warning(utilization=0.85, rate_limit_type="five_hour", window=reset)
    assert got.tokens == (10, 1)


def test_wrk_fr_22_p08_warning_cleans_fields() -> None:
    """WRK-FR-22 · P08 · probe_result: util 1.5 / type 'Bad' ⇒ None qua clean_*
    [H3a-R02 · H3a-R03 · HUB-H3a-AC-02]"""
    rl = _Rl(status="allowed_warning", rate_limit_type="Bad", utilization=1.5)
    got = _run(_Seen(rate_limit=rl, final=_ok_final()))
    assert got.kind == "ok"
    assert got.warning is not None
    assert got.warning.utilization is None
    assert got.warning.rate_limit_type is None
    assert got.rate_limit_type is None
    assert got.utilization is None


def test_wrk_fr_22_p08_ok_plain() -> None:
    """WRK-FR-22 · P08 · probe_result: final ok, không rate_limit ⇒ ok, không warning,
    tokens = usage [H3a-R14]"""
    got = _run(_Seen(final=_ok_final(), usage=_usage()))
    assert got.kind == "ok"
    assert got.warning is None
    assert got.tokens == (10, 1)
    assert got.step == "turn"


# ---------------------------------------------------------------- P09 probe_transition (R15)

UNTIL = NOW + timedelta(hours=1)


_RES = ProbeResult("ok", None, None, None, None, "", (0, 0), 1, "turn")


def _res(kind: str, until: datetime | None = None) -> ProbeResult:
    return replace(_RES, kind=cast(Any, kind), until=until)


_TRANSITION_ROWS: list[tuple[str, ProviderSnap, ProbeResult, str]] = [
    *[(f"ok_from_{s}", snap(s), _res("ok"), "healthy") for s in ("ok", "busy", None)],
    *[
        (f"ok_from_{s}", snap(s, until=UNTIL), _res("ok"), "recover")
        for s in ("cooldown", "logged_out", "error")
    ],
    ("cooldown_same_until", snap("cooldown", until=UNTIL), _res("cooldown", UNTIL), "seen"),
    ("cooldown_other", snap("cooldown", until=UNTIL + S), _res("cooldown", UNTIL), "broken"),
    ("cooldown_from_ok", snap("ok"), _res("cooldown", UNTIL), "broken"),
    ("cooldown_from_none", snap(None), _res("cooldown", UNTIL), "broken"),
    ("logged_out_from_logged_out", snap("logged_out"), _res("logged_out"), "seen"),
    *[
        (f"logged_out_from_{s}", snap(s, until=UNTIL), _res("logged_out"), "broken")
        for s in ("cooldown", "ok", "error")
    ],
    *[
        (f"error_from_{s}", snap(s, until=UNTIL), _res("error"), "error")
        for s in (None, "ok", "busy", "cooldown", "logged_out", "error")
    ],
]


@pytest.mark.parametrize(
    ("sn", "res", "expected"),
    [row[1:] for row in _TRANSITION_ROWS],
    ids=[row[0] for row in _TRANSITION_ROWS],
)
def test_wrk_fr_22_p09_probe_transition(sn: ProviderSnap, res: ProbeResult, expected: str) -> None:
    """WRK-FR-22 · P09 · probe_transition (s = status or 'ok'): ok ⇒ healthy/recover; cooldown/
    logged_out cùng trạng thái ⇒ seen, khác ⇒ broken; error ⇒ error [H3a-R15 · PL4 · PL5]"""
    assert qr.probe_transition(sn, res) == expected


# ---------------------------------------------------------------- P10 parse_fake_probe (R18)

_TS = 1790000000
_FAKE: dict[str, tuple[str | None, FakeProbe]] = {
    "none": (None, FakeProbe(kind="ok")),
    "empty": ("", FakeProbe(kind="ok")),
    "newline": ("\n", FakeProbe(kind="ok")),
    "ok": ("ok", FakeProbe(kind="ok")),
    "rejected": ("rejected", FakeProbe(kind="rejected")),
    "rejected_ts": (f"rejected:{_TS}", FakeProbe(kind="rejected", resets_at=_TS)),
    "rejected_ts_type": (
        f"rejected:{_TS}:seven_day",
        FakeProbe(kind="rejected", resets_at=_TS, rate_limit_type="seven_day"),
    ),
    "logged_out": ("logged_out", FakeProbe(kind="logged_out")),
    "revoked": ("revoked", FakeProbe(kind="revoked")),
    "warning": ("warning:0.85", FakeProbe(kind="warning", utilization=0.85)),
    "warning_ts": (
        f"warning:0.85:{_TS}",
        FakeProbe(kind="warning", utilization=0.85, resets_at=_TS),
    ),
    "hang": ("hang", FakeProbe(kind="hang")),
    "error": ("error", FakeProbe(kind="error")),
    "line2_ignored": (f"logged_out\nrejected:{_TS}", FakeProbe(kind="logged_out")),
    "warning_bad": ("warning:abc", FakeProbe(kind="error")),
    "rejected_bad": ("rejected:x", FakeProbe(kind="error")),
    "unknown": ("zzz", FakeProbe(kind="error")),
    "ok_ms_1": ("ok:1", FakeProbe(kind="ok", ms=1)),
    "ok_ms_3000": ("ok:3000", FakeProbe(kind="ok", ms=3000)),
    "ok_ms_60000": ("ok:60000", FakeProbe(kind="ok", ms=60000)),
    "ok_ms_0": ("ok:0", FakeProbe(kind="error")),
    "ok_ms_60001": ("ok:60001", FakeProbe(kind="error")),
    "ok_ms_abc": ("ok:abc", FakeProbe(kind="error")),
    "ok_ms_empty": ("ok:", FakeProbe(kind="error")),
}


@pytest.mark.parametrize(("text", "expected"), _FAKE.values(), ids=_FAKE)
def test_wrk_fr_22_p10_parse_fake_probe(text: str | None, expected: FakeProbe) -> None:
    """WRK-FR-22 · P10 · parse_fake_probe: dòng đầu file AGENT_RT_FAKE_PROBE_FILE; sai cú pháp
    ⇒ error; ok:<ms> 1–60000 [H3a-R18]"""
    assert qr.parse_fake_probe(text) == expected


# ---------------------------------------------------------------- P11 hằng


def test_wrk_fr_22_p11_constants() -> None:
    """WRK-FR-22 · P11 · COOLDOWN_MAX = 8 ngày; regex type khớp five_hour, không khớp Five
    [H3a-R02]"""
    assert timedelta(days=8) == qr.COOLDOWN_MAX
    assert re.fullmatch(qr.RATE_TYPE_PATTERN, "five_hour")
    assert not re.fullmatch(qr.RATE_TYPE_PATTERN, "Five")


# ---------------------------------------------------------------- P12 mapping.result_signal (H1)


def _result(**over: Any) -> ResultMessage:
    base: dict[str, Any] = {
        "subtype": "error_during_execution",
        "duration_ms": 1,
        "duration_api_ms": 1,
        "is_error": True,
        "num_turns": 1,
        "session_id": "sess-p12",
        "result": None,
    }
    base.update(over)
    return ResultMessage(**base)


def test_wrk_fr_15_p12_429_beats_auth_text() -> None:
    """WRK-FR-15 · P12 · result_signal: 429 + 'Not logged in' ⇒ RateLimit(rejected) (429 thắng
    chữ auth) [H3a-R01 · HUB-H3a-AC-02 vế job · G1]"""
    got = result_signal(_result(api_error_status=429, result="Not logged in · Please run /login"))
    assert got is not None
    assert got.status == "rejected"


def test_wrk_fr_15_p12_401_logged_out() -> None:
    """WRK-FR-15 · P12 · result_signal: 401 ⇒ logged_out [H3a-R01 · HUB-H3a-AC-02 vế job · G1]"""
    got = result_signal(_result(api_error_status=401, result="Unauthorized"))
    assert got is not None
    assert got.status == "logged_out"


def test_wrk_fr_15_p12_usage_limit_text_rejected() -> None:
    """WRK-FR-15 · P12 · result_signal: không status + chữ usage limit ⇒ rejected
    [H3a-R01 · HUB-H3a-AC-02 vế job · G1]"""
    got = result_signal(_result(api_error_status=None, result="You've hit your usage limit"))
    assert got is not None
    assert got.status == "rejected"


def test_wrk_fr_15_p12_not_error_none() -> None:
    """WRK-FR-15 · P12 · result_signal: is_error False ⇒ None [H3a-R01 · G1]"""
    assert result_signal(_result(is_error=False, subtype="success", result="ok")) is None
