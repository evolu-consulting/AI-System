"""WRK-FR-15 · WRK-FR-17 · WRK-BR-04 · H1-R24 · H1-R25 — từ sự kiện con đã thấy → kết quả job +
ảnh hưởng lên provider + dòng usage (plan-runtime §3.3, §8; plan-db §5.4 "Kết thúc").

Luật provider (§3.3): rate limit `rejected` → `cooldown` (giờ reset, không có → now + 30 phút,
WRK-FR-15) · `logged_out` → `logged_out` · `fatal` / thoát không `final` (≡ ProcessError) → đếm lỗi
(3 liên tiếp → `error`) · thành công → về 0 · còn lại (huỷ, timeout, `is_error`, JSON sai hình)
không đụng provider. Review H1 #2c/#5/#10: lỗi phía cha (dòng sự kiện hỏng/quá dài, reader lỗi)
và job host chết vì tín hiệu không do cha gửi (vd systemd dừng cả cgroup) → **không** đếm lỗi
provider.
H2b F4 (plan-runtime §4, R27): `is_error` chưa có `RateLimit` → phân loại chữ result
(`classify_is_error`): mẫu rate/auth như H1 (`cooldown`/`logged_out`), `Final.stop_reason ==
"refusal"` ∧ 0 output token → `UPSTREAM_ERROR refused` (TC-8), còn lại `PROVIDER_ERROR` H1.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from datetime import UTC, datetime
from typing import Any

from agent_runtime.contracts.hub import JobPayload1
from agent_runtime.db.jobs_sql import Finish
from agent_runtime.db.provider_state_sql import Broken, ProviderEffect
from agent_runtime.db.usage_sql import UsageKeys, UsageRow
from agent_runtime.events.job_events import Failure, Tokens
from agent_runtime.providers.base import Confirm, Fatal, Final, RateLimit, UsageEv
from agent_runtime.runtimes.cli.quota_rules import (
    Warning as QuotaWarning,
)
from agent_runtime.runtimes.cli.quota_rules import (
    clean_type,
    clean_util,
    cooldown_until,
    warn_window,
)
from agent_runtime.runtimes.cli.refusal import IsErrorKind, classify_is_error
from agent_runtime.runtimes.cli.result import build_output, forced_need_input

JOB_ERROR_CODES = frozenset(
    {"ALL_PROVIDERS_EXHAUSTED", "TIMEOUT", "CANCELLED", "UPSTREAM_ERROR", "INTERNAL_ERROR"}
)
CANCELLED = Failure("cancelled", "CANCELLED", "cancelled", "job cancelled")
TIMED_OUT = Failure("timed_out", "TIMEOUT", "timeout", "job timed out")
CRASHED = Failure("failed", "INTERNAL_ERROR", "crash", "job host exited without result")
INVALID_PAYLOAD = Failure("failed", "INTERNAL_ERROR", "invalid_payload", "invalid job payload")
INVALID_OUTPUT = Failure("failed", "UPSTREAM_ERROR", "invalid_output", "invalid provider output")
PROVIDER_ERROR = Failure("failed", "UPSTREAM_ERROR", None, "provider returned an error")
RATE_LIMITED = Failure("failed", "ALL_PROVIDERS_EXHAUSTED", "quota", "provider rate limited")
LOGGED_OUT = Failure(
    "failed", "ALL_PROVIDERS_EXHAUSTED", "provider_unavailable", "provider logged out"
)
REFUSED = Failure("failed", "UPSTREAM_ERROR", "refused", "provider refused the request")
DEFAULT_COOLDOWN_S = 1800  # WRK-FR-15 · H3a-R02: mặc định `AGENT_RT_COOLDOWN_DEFAULT_S`
BROKEN_SIGNALS = frozenset({"rejected", "logged_out"})


@dataclass(frozen=True)
class UsageSum:
    """Usage cộng dồn qua các lần chạy của job. `input_tokens` = tổng (gồm cache)."""

    input_tokens: int = 0
    output_tokens: int = 0
    cache_read: int = 0
    cache_write: int = 0
    model: str | None = None
    reported: bool = False

    def plus(self, u: UsageEv) -> UsageSum:
        return UsageSum(
            self.input_tokens + u.input + u.cache_read + u.cache_write,
            self.output_tokens + u.output,
            self.cache_read + u.cache_read,
            self.cache_write + u.cache_write,
            u.model or self.model,
            True,
        )

    def tokens(self) -> Tokens:
        return Tokens(self.input_tokens, self.output_tokens)


@dataclass
class Seen:
    final: Final | None = None
    fatal: Fatal | None = None
    usage: UsageEv | None = None
    session_id: str | None = None
    rate_limit: RateLimit | None = None
    warning: RateLimit | None = None  # H3a R03: `allowed_warning` cuối (giữ qua `next_attempt`)
    tool_used: bool = False  # đã có `tool_use` (resume lỗi sau đó không dựng lại — §6, BR-04)
    carried: UsageSum = field(default_factory=UsageSum)  # usage của lần chạy trước (thử lại)
    parent_fault: bool = False  # `fatal` do phía cha dựng (giao thức/reader), không phải provider
    signaled: bool = False  # job host thoát vì tín hiệu mà cha không gửi (returncode < 0)
    # HUB-FR-95 §5 #3: Hub từ chối tool `side_effect` (giữ cái đầu; không reset khi thử lại)
    confirm: Confirm | None = None
    streamed: bool = False  # H2b R21: đã phát `job.delta` → không thử lại (giữ qua `next_attempt`)

    def total(self) -> UsageSum:
        return self.carried if self.usage is None else self.carried.plus(self.usage)

    def tokens(self) -> Tokens:
        return self.total().tokens()

    def next_attempt(self) -> None:
        """Lần thử lại: giữ usage đã tiêu + session, bỏ final/fatal cũ."""
        self.carried, self.final, self.fatal, self.usage = self.total(), None, None, None
        self.parent_fault = self.signaled = False


@dataclass(frozen=True)
class Verdict:
    """`failure` None = `succeeded` với `output`."""

    failure: Failure | None
    output: dict[str, Any] | None = None
    provider: ProviderEffect = "none"
    session_resumed: bool = False  # `job.result.session_resumed` (WRK-FR-14)
    outputs: tuple[str, ...] = ()  # H2c R25: id file `out/` Hub đã nhận (≤ 5, lần claim hiện hành)
    warning: QuotaWarning | None = None  # H3a R03: `NOTE_WARNING` trong "Kết thúc"

    def finish(self) -> Finish:
        f = self.failure
        if f is None:
            return Finish("succeeded", self.output)
        return Finish(f.status, None, f.code, f.reason, f.message[:500])


def fatal_failure(f: Fatal) -> Failure:
    code = f.code if f.code in JOB_ERROR_CODES else "INTERNAL_ERROR"
    return Failure("failed", code, f.reason or "crash", f.msg or "job host fatal")


def broken_of(
    rl: RateLimit, now: datetime | None = None, default_s: int = DEFAULT_COOLDOWN_S
) -> Broken:
    """H3a-R02: `resets_at` ngoài `(now, now + 8 ngày]` / vắng ⇒ `now + default_s`."""
    rate_type, util = clean_type(rl.rate_limit_type), clean_util(rl.utilization)
    if rl.status == "logged_out":
        return Broken("logged_out", None, LOGGED_OUT.message, rate_type, util)
    until = cooldown_until(rl.resets_at, now or datetime.now(UTC), default_s)
    return Broken("cooldown", until, RATE_LIMITED.message, rate_type, util)


def warning_of(rl: RateLimit | None, now: datetime | None = None) -> QuotaWarning | None:
    """H3a R03: `allowed_warning` → `Warning` (làm sạch type/util; cửa sổ `warn_window`)."""
    if rl is None or rl.status != "allowed_warning":
        return None
    window = warn_window(rl.resets_at, now or datetime.now(UTC))
    return QuotaWarning(clean_util(rl.utilization), clean_type(rl.rate_limit_type), window)


def with_warning(v: Verdict, seen: Seen) -> Verdict:
    """Gắn cảnh báo quota đã thấy vào kết cục — trừ khi provider hỏng (`MARK_BROKEN` thay)."""
    if isinstance(v.provider, Broken):
        return v
    w = warning_of(seen.warning)
    return v if w is None else replace(v, warning=w)


def decide_exit(payload: JobPayload1, seen: Seen, default_s: int = DEFAULT_COOLDOWN_S) -> Verdict:
    """Job host đã thoát (không huỷ/timeout): kết quả + ảnh hưởng provider."""
    rl = seen.rate_limit
    if rl is not None:
        failure = LOGGED_OUT if rl.status == "logged_out" else RATE_LIMITED
        return Verdict(failure, provider=broken_of(rl, default_s=default_s))
    if seen.confirm is not None and payload.output == "agent_result":
        if seen.fatal is not None or seen.final is None:
            # Review 1 C10: CLI chết / lỗi sau CONFIRMATION_REQUIRED — câu hỏi xác nhận của Hub vẫn
            # là kết quả đúng (người dùng trả lời rồi chạy lại); không đếm lỗi provider.
            return Verdict(None, forced_need_input(seen.confirm), "none")
    if seen.fatal is not None:
        return Verdict(fatal_failure(seen.fatal), provider="none" if seen.parent_fault else "error")
    if seen.final is None:
        return Verdict(CRASHED, provider="none" if seen.signaled else "error")
    if seen.final.is_error and seen.confirm is None:
        return is_error_verdict(is_error_kind(seen), default_s)
    output = build_output(payload, seen.final, seen.confirm)
    if output is None:
        return Verdict(INVALID_OUTPUT)
    return Verdict(None, output, "ok")


def is_error_text(f: Final) -> str:
    """Chữ result để phân loại F4 (chỉ vào log job, không vào sự kiện/DB)."""
    return f.text or f.raw_json or " ".join(f.errors)


def is_error_kind(seen: Seen) -> IsErrorKind | None:
    """H2b F4 (plan-runtime §4): `Final.is_error` → `rate`/`auth`/`refused`/None."""
    assert seen.final is not None
    f = seen.final
    return classify_is_error(is_error_text(f), seen.total().output_tokens, f.stop_reason)


def is_error_verdict(kind: IsErrorKind | None, default_s: int = DEFAULT_COOLDOWN_S) -> Verdict:
    """Chỉ tới khi chưa có `RateLimit` (claude-sub đã phân loại bằng `result_signal` H1)."""
    if kind == "rate":
        rejected = RateLimit(status="rejected")
        return Verdict(RATE_LIMITED, provider=broken_of(rejected, default_s=default_s))
    if kind == "auth":
        return Verdict(LOGGED_OUT, provider=broken_of(RateLimit(status="logged_out")))
    return Verdict(REFUSED if kind == "refused" else PROVIDER_ERROR)


def queued_failure(b: Broken) -> Failure:
    """`job.failed` của job `queued` bị fail vì provider hỏng."""
    return Failure("failed", "ALL_PROVIDERS_EXHAUSTED", b.reason, b.message)


def usage_row(payload: JobPayload1, total: UsageSum, latency_ms: int) -> UsageRow | None:
    """None khi job chưa báo usage (plan-runtime §8: chỉ ghi khi có)."""
    if not total.reported:
        return None
    keys = UsageKeys(
        payload.tenant_id,
        payload.run_id,
        payload.step_id,
        payload.user_id,
        payload.agent.id,
        payload.provider_key,
    )
    model = total.model or (payload.model.root if payload.model else None)
    t = total
    return UsageRow(
        keys,
        model,
        t.input_tokens,
        t.output_tokens,
        t.cache_read,
        t.cache_write,
        max(0, latency_ms),
    )
