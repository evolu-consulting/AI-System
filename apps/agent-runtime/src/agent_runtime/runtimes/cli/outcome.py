"""WRK-FR-15 · WRK-FR-17 · WRK-BR-04 · H1-R24 · H1-R25 — từ sự kiện con đã thấy → kết quả job +
ảnh hưởng lên provider + dòng usage (plan-runtime §3.3, §8; plan-db §5.4 "Kết thúc").

Luật provider (§3.3): rate limit `rejected` → `cooldown` (giờ reset, không có → now + 30 phút,
WRK-FR-15) · `logged_out` → `logged_out` · `fatal` / thoát không `final` (≡ ProcessError) → đếm lỗi
(3 liên tiếp → `error`) · thành công → về 0 · còn lại (huỷ, timeout, `is_error`, JSON sai hình)
không đụng provider.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

from agent_runtime.contracts.hub import JobPayload1
from agent_runtime.db.jobs_sql import Finish
from agent_runtime.db.provider_state_sql import Broken, ProviderEffect
from agent_runtime.db.usage_sql import UsageKeys, UsageRow
from agent_runtime.events.job_events import Failure, Tokens
from agent_runtime.providers.base import Fatal, Final, RateLimit, UsageEv
from agent_runtime.runtimes.cli.result import build_output

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
DEFAULT_COOLDOWN = timedelta(minutes=30)  # WRK-FR-15: không có giờ reset
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
    carried: UsageSum = field(default_factory=UsageSum)  # usage của lần chạy trước (thử lại)

    def total(self) -> UsageSum:
        return self.carried if self.usage is None else self.carried.plus(self.usage)

    def tokens(self) -> Tokens:
        return self.total().tokens()

    def next_attempt(self) -> None:
        """Lần thử lại: giữ usage đã tiêu + session, bỏ final/fatal cũ."""
        self.carried, self.final, self.fatal, self.usage = self.total(), None, None, None


@dataclass(frozen=True)
class Verdict:
    """`failure` None = `succeeded` với `output`."""

    failure: Failure | None
    output: dict[str, Any] | None = None
    provider: ProviderEffect = "none"

    def finish(self) -> Finish:
        f = self.failure
        if f is None:
            return Finish("succeeded", self.output)
        return Finish(f.status, None, f.code, f.reason, f.message[:500])


def fatal_failure(f: Fatal) -> Failure:
    code = f.code if f.code in JOB_ERROR_CODES else "INTERNAL_ERROR"
    return Failure("failed", code, f.reason or "crash", f.msg or "job host fatal")


def broken_of(rl: RateLimit, now: datetime | None = None) -> Broken:
    if rl.status == "logged_out":
        return Broken("logged_out", None, LOGGED_OUT.message)
    if rl.resets_at is not None:
        until = datetime.fromtimestamp(rl.resets_at, UTC)
    else:
        until = (now or datetime.now(UTC)) + DEFAULT_COOLDOWN
    return Broken("cooldown", until, RATE_LIMITED.message)


def decide_exit(payload: JobPayload1, seen: Seen) -> Verdict:
    """Job host đã thoát (không huỷ/timeout): kết quả + ảnh hưởng provider."""
    rl = seen.rate_limit
    if rl is not None:
        failure = LOGGED_OUT if rl.status == "logged_out" else RATE_LIMITED
        return Verdict(failure, provider=broken_of(rl))
    if seen.fatal is not None:
        return Verdict(fatal_failure(seen.fatal), provider="error")
    if seen.final is None:
        return Verdict(CRASHED, provider="error")
    if seen.final.is_error:
        return Verdict(PROVIDER_ERROR)
    output = build_output(payload, seen.final)
    if output is None:
        return Verdict(INVALID_OUTPUT)
    return Verdict(None, output, "ok")


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
