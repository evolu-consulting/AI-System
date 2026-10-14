"""HUB-FR-129 · HUB-FR-130 · WRK-FR-29 · HUB-BR-30 · PC2-R04 · R05 · R06 · R08 · P-c2 · Báo cáo
job `source.apply` → Hub (`POST /internal/jobs/:id/apply-result`, plan §3.5, plan-runtime §5.2
bước 7).

`ApplyReport.body()` dựng thân `ApplyReport` (contract `hub-internal/apply.ts`); bất biến (khớp
`superRefine`): `head_sha ≠ null ⇔ status=pushed`; `code ≠ null ⇔ status=failed`; `conflict_files`
chỉ khi `conflict`; `failures` chỉ khi `check_failed`; `target_sha` null chỉ khi `failed`.
`detail` ≤ 300 ký tự **đã che** (`redact` bí mật + `redact_auth` khoá git) — không thân thô, không
stderr lẫn khoá.
`post_result` gửi (Bearer token job), retry 3 lần (1/2/4 s) khi mạng/5xx/429; 201 hoặc 409
`APPLY_RESULT_EXISTS` = Hub đã có kết quả (C37); 4xx khác = thất bại (host kết thúc job `failed`).
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass, field
from typing import Any, Literal

import httpx2

from agent_runtime.apply.rules import redact_auth
from agent_runtime.autofix.report import TestRun, failure_dict
from agent_runtime.autofix.rules import Failure, redact
from agent_runtime.log import get_logger
from agent_runtime.runtimes.cli.files.fetch import job_url
from agent_runtime.runtimes.hub_http import make_hub_client

ApplyStatus = Literal["pushed", "conflict", "check_failed", "failed"]
ApplyCode = Literal["auth", "no_credential", "push_rejected", "network"]

CONFLICT_FILES_MAX = 50
FAILURES_MAX = 50
DETAIL_MAX = 300
LOG_TAIL_MAX = 65_536
RETRY_DELAYS_S = (1.0, 2.0, 4.0)
RESULT_EXISTS = "APPLY_RESULT_EXISTS"
_HTTP_CREATED = 201
_HTTP_CONFLICT = 409
_HTTP_TOO_MANY = 429
_HTTP_SERVER = 500

Sleep = Callable[[float], Awaitable[None]]


def clip_detail(text: str | None) -> str | None:
    """Che bí mật (mẫu PC-R08) + khoá git (`Authorization`/token) rồi cắt ≤ 300 (PC2-R11)."""
    if not text:
        return None
    return redact_auth(redact(text))[:DETAIL_MAX]


def _test_dict(test: TestRun | None) -> dict[str, Any] | None:
    if test is None:
        return None
    tail = redact(test.log)[-LOG_TAIL_MAX:]
    return {"exit_code": test.exit_code, "duration_ms": max(0, test.duration_ms), "log_tail": tail}


@dataclass(frozen=True)
class HubTarget:
    hub_url: str
    job_id: str
    token: str


@dataclass(frozen=True)
class ApplyReport:
    """Kết cục một job `source.apply` (plan-runtime §5.2). Host dựng rồi gọi `body()` + POST."""

    status: ApplyStatus
    target_sha: str | None
    head_sha: str | None = None
    rebased: bool = False
    code: ApplyCode | None = None
    conflict_files: Sequence[str] = ()
    failures: Sequence[Failure] = field(default_factory=tuple)
    test: TestRun | None = None
    detail: str | None = None

    def body(self) -> dict[str, Any]:
        conflicts = (
            list(self.conflict_files)[:CONFLICT_FILES_MAX] if self.status == "conflict" else []
        )
        fails = list(self.failures)[:FAILURES_MAX] if self.status == "check_failed" else []
        return {
            "status": self.status,
            "target_sha": self.target_sha,
            "head_sha": self.head_sha if self.status == "pushed" else None,
            "rebased": self.rebased,
            "code": self.code if self.status == "failed" else None,
            "conflict_files": conflicts,
            "failures": [failure_dict(f) for f in fails],
            "test": _test_dict(self.test),
            "detail": clip_detail(self.detail),
        }


def _done(resp: httpx2.Response) -> bool | None:
    """True = Hub đã có kết quả · False = từ chối dứt điểm · None = thử lại."""
    if resp.status_code == _HTTP_CREATED:
        return True
    if resp.status_code == _HTTP_CONFLICT:
        try:
            code = resp.json().get("error", {}).get("code")
        except ValueError:
            code = None
        return code == RESULT_EXISTS
    if resp.status_code == _HTTP_TOO_MANY or resp.status_code >= _HTTP_SERVER:
        return None
    return False


async def post_result(
    target: HubTarget,
    body: dict[str, Any],
    transport: httpx2.AsyncBaseTransport | None = None,
    sleep: Sleep = asyncio.sleep,
) -> bool:
    """Gửi báo cáo TRƯỚC khi kết thúc job; True = Hub đã nhận (201 hoặc `APPLY_RESULT_EXISTS`)."""
    url = job_url(target.hub_url, target.job_id, "apply-result")
    headers = {"Authorization": f"Bearer {target.token}"}
    log = get_logger()
    async with make_hub_client(transport) as client:
        for attempt in range(len(RETRY_DELAYS_S) + 1):
            if attempt:
                await sleep(RETRY_DELAYS_S[attempt - 1])
            try:
                resp = await client.post(url, json=body, headers=headers)
            except httpx2.HTTPError as err:
                log.warning("apply.report_error", attempt=attempt, error=type(err).__name__)
                continue
            done = _done(resp)
            if done is not None:
                if not done:
                    log.warning("apply.report_rejected", status=resp.status_code)
                return done
            log.warning("apply.report_retry", attempt=attempt, status=resp.status_code)
    return False
