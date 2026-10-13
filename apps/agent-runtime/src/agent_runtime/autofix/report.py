"""HUB-FR-128 · HUB-FR-130 · WRK-FR-29 · P-c1 · Báo cáo tự-sửa → Hub (plan §3.3, §1 bước 7).

`build_report` dựng thân `AutofixReport` (contract `hub-internal/autofix.ts`) — bất biến
`diff ≠ null ⇔ diff_stats ≠ null ⇔ status=ok`; `failures` ≤ 50, `commands` ≤ 300 (`arg` che bí mật +
cắt 500); `test.log_tail` che `[REDACTED]` rồi giữ đuôi ≤ 65 536 ký tự (PC-R12). Test trượt
(exit ≠ 0
hoặc hết giờ) ⇒ thêm `Failure(check="tests")`.
`post_result` gửi `POST /internal/jobs/:id/autofix-result` (Bearer token job), retry 3 lần
(1/2/4 s) khi lỗi mạng/5xx/429; 201 hoặc 409 `AUTOFIX_RESULT_EXISTS` = thành công; 4xx khác = thất
bại ngay (host kết thúc job `failed` reason `upstream`).
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from typing import Any, Literal

import httpx2

from agent_runtime.autofix.check import AUTOFIX_FAILURES_MAX, CheckResult
from agent_runtime.autofix.rules import Failure, clip_detail, redact, truncate_cmd
from agent_runtime.autofix.workspace import NULL_SHA
from agent_runtime.log import get_logger
from agent_runtime.runtimes.cli.files.fetch import job_url
from agent_runtime.runtimes.hub_http import make_hub_client

COMMANDS_MAX = 300
LOG_TAIL_MAX = 65_536
RETRY_DELAYS_S = (1.0, 2.0, 4.0)
RESULT_EXISTS = "AUTOFIX_RESULT_EXISTS"
_HTTP_CREATED = 201
_HTTP_CONFLICT = 409
_HTTP_TOO_MANY = 429
_HTTP_SERVER = 500

Tool = Literal["exec", "read", "write", "edit"]
Sleep = Callable[[float], Awaitable[None]]


@dataclass(frozen=True)
class Command:
    tool: Tool
    arg: str
    ms: int
    exit_code: int | None = None


@dataclass(frozen=True)
class TestRun:
    exit_code: int | None  # None = hết giờ / bị kill
    duration_ms: int
    log: str


@dataclass(frozen=True)
class ReportMeta:
    branch: str
    base_sha: str = NULL_SHA
    failures: tuple[Failure, ...] = ()  # trượt trước kiểm diff: install / apply_patch / size (G12)


@dataclass(frozen=True)
class HubTarget:
    hub_url: str
    job_id: str
    token: str


def failure_dict(f: Failure) -> dict[str, Any]:
    out: dict[str, Any] = {"check": f.check, "detail": clip_detail(f.detail)}
    if f.path is not None:
        out["path"] = f.path[:1024]
    if f.line is not None:
        out["line"] = f.line
    if f.rule is not None:
        out["rule"] = f.rule[:64]
    return out


def command_dict(c: Command) -> dict[str, Any]:
    out: dict[str, Any] = {"tool": c.tool, "arg": truncate_cmd(redact(c.arg)), "ms": max(0, c.ms)}
    if c.exit_code is not None:
        out["exit_code"] = c.exit_code
    return out


def _test_failure(test: TestRun | None) -> list[Failure]:
    if test is None or test.exit_code == 0:
        return []
    if test.exit_code is None:
        return [Failure("tests", rule="timeout", detail="test_cmd hết giờ")]
    return [Failure("tests", rule="exit_code", detail=f"test_cmd exit {test.exit_code}")]


def _test_dict(test: TestRun | None) -> dict[str, Any] | None:
    if test is None:
        return None
    tail = redact(test.log)[-LOG_TAIL_MAX:]
    return {"exit_code": test.exit_code, "duration_ms": max(0, test.duration_ms), "log_tail": tail}


def build_report(
    meta: ReportMeta,
    check: CheckResult | None,
    test: TestRun | None = None,
    commands: Sequence[Command] = (),
) -> dict[str, Any]:
    """Thân `AutofixReport`. `check=None` ⇔ trượt trước kiểm diff (`meta.failures`)."""
    failures = [*meta.failures, *(check.failures if check else ()), *_test_failure(test)]
    head = check.head_sha if check else meta.base_sha
    ok_diff = check.diff if check and not failures and check.diff else None
    status = "check_failed" if failures else ("ok" if ok_diff else "no_changes")
    stats = check.stats if ok_diff is not None and check else None
    return {
        "status": status,
        "branch": meta.branch,
        "base_sha": meta.base_sha,
        "head_sha": head,
        "diff": ok_diff,
        "diff_stats": None if stats is None else vars(stats).copy(),
        "test": _test_dict(test),
        "failures": [failure_dict(f) for f in failures[:AUTOFIX_FAILURES_MAX]],
        "commands": [command_dict(c) for c in list(commands)[:COMMANDS_MAX]],
    }


def _done(resp: httpx2.Response) -> bool | None:
    """True = xong · False = thất bại không thử lại · None = thử lại."""
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
    """Gửi báo cáo TRƯỚC khi kết thúc job; True = Hub đã có kết quả (201 hoặc đã tồn tại)."""
    url = job_url(target.hub_url, target.job_id, "autofix-result")
    headers = {"Authorization": f"Bearer {target.token}"}
    log = get_logger()
    async with make_hub_client(transport) as client:
        for attempt in range(len(RETRY_DELAYS_S) + 1):
            if attempt:
                await sleep(RETRY_DELAYS_S[attempt - 1])
            try:
                resp = await client.post(url, json=body, headers=headers)
            except httpx2.HTTPError as err:
                log.warning("autofix.report_error", attempt=attempt, error=type(err).__name__)
                continue
            done = _done(resp)
            if done is not None:
                if not done:
                    log.warning("autofix.report_rejected", status=resp.status_code)
                return done
            log.warning("autofix.report_retry", attempt=attempt, status=resp.status_code)
    return False
