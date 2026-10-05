"""WRK-FR-06 · WRK-FR-07 · H2a-R11 · R13 · R17 · Q5 · Q6 — một lần claim job `workflow.async`
trong process cha: credential (`plan-runtime` §3.3) → vòng thử Dify (`plan-runtime-dify` §3.4) →
`Outcome` (kết quả/lỗi + usage). Huỷ/timeout/mất job do `host.py` cắt task này (§3.6).

Không log thân/URL/header/key/token: log `dify.attempt{n, http_status, err_kind}` mỗi lần thử;
thân lỗi Dify (đã `mask`, ≤ 300 ký tự) chỉ ở `debug`.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from typing import TYPE_CHECKING, cast

import httpx2

from agent_runtime.contracts.hub import JobPayloadWorkflowAsync
from agent_runtime.db import workflow_sql
from agent_runtime.db.jobs_sql import ClaimedJob
from agent_runtime.events.job_events import Failure
from agent_runtime.log import get_logger
from agent_runtime.runtimes.dify.client import (
    DifyClient,
    DifyHTTPError,
    DifyRequest,
    DifyStreamError,
    classify,
)
from agent_runtime.runtimes.dify.credential import (
    CredentialError,
    DifyCredential,
    fetch_credential,
    make_hub_client,
)
from agent_runtime.runtimes.dify.policy import (
    MAX_RETRIES,
    ErrKind,
    RetryFlags,
    UsageRow,
    map_failure,
    retry_delay,
    usage_row,
)
from agent_runtime.runtimes.dify.progress import RUNNING, Throttle, retry_message, step_message
from agent_runtime.runtimes.dify.stream import (
    OUTPUT_MAX,
    Failed,
    Finished,
    Progress,
    StreamState,
    final_text,
    reduce,
)

if TYPE_CHECKING:
    from agent_runtime.runtimes.dify.host import DifyJobHost

_TRANSPORT_ERRORS = (httpx2.HTTPError, httpx2.SSEError, DifyHTTPError, DifyStreamError)
_NO_STOP: frozenset[ErrKind] = frozenset({"finished_failed", "empty"})

CRED_REJECTED = Failure("failed", "NOT_CONFIGURED", "credential", "workflow is not configured")
_MESSAGES = {
    ("NOT_CONFIGURED", "upstream"): "workflow service rejected the request",
    ("UPSTREAM_ERROR", "upstream"): "workflow service returned an error",
    ("UPSTREAM_ERROR", "invalid_output"): "workflow returned no output",
}


def dify_failure(err_kind: ErrKind, http_status: int | None) -> Failure:
    """`plan-errors` §2 (RT3) — `message` là câu tĩnh theo mã, không chép thân Dify."""
    code, reason = map_failure(err_kind, http_status)
    return Failure("failed", code, reason, _MESSAGES[(code, reason)])


@dataclass(frozen=True)
class Outcome:
    """`failure` None = thành công (`text`). `usage` None = chưa có lời gọi Dify trả về."""

    failure: Failure | None
    text: str | None = None
    usage: UsageRow | None = None


@dataclass(frozen=True)
class _Err:
    kind: ErrKind
    status: int | None = None


class LostJob(Exception):
    """`mark_dispatched` 0 dòng: job không còn `running` của mình → không gọi Dify, không ghi."""


class DifyRun:
    def __init__(
        self, host: DifyJobHost, job: ClaimedJob, payload: JobPayloadWorkflowAsync
    ) -> None:
        self.host, self.job, self.p = host, job, payload
        self.cred: DifyCredential | None = None
        self.state = StreamState(payload.app_type)
        self.sent_at: float | None = None  # lúc gửi lần thử cuối (latency WRK-FR-07)
        self.answered = False  # đã có lời gọi Dify trả về (→ ghi usage)
        self.dispatched = False
        self.progress = Throttle(lambda m: host.events.progress(job, m))

    # ---------- credential (§3.3) ----------

    async def credential(self) -> DifyCredential | Failure:
        cfg, log = self.host.cfg, get_logger()
        async with make_hub_client(cfg.hub_transport) as hub:
            for attempt in range(1, MAX_RETRIES + 2):
                got = await fetch_credential(hub, cfg.hub_url, self.job.id, self.job.token)
                if isinstance(got, DifyCredential):
                    return self._check_app_type(got)
                log.warning("job.credential_rejected", status=got.http_status, attempt=attempt)
                delay = self._cred_delay(got, attempt)
                if delay is None:
                    return CRED_REJECTED
                await asyncio.sleep(delay)
        return CRED_REJECTED

    def _cred_delay(self, err: CredentialError, attempt: int) -> float | None:
        if not err.retryable:
            return None
        # 5xx / lỗi mạng: như hàng "kết nối" (chưa gửi Dify — an toàn với `side_effect`).
        flags = RetryFlags(first_seen=False, side_effect=self.p.side_effect)
        return retry_delay("connect", attempt, flags, self.host.cfg.backoff)

    def _check_app_type(self, cred: DifyCredential) -> DifyCredential | Failure:
        if cred.app_type != self.p.app_type:  # RQ9: workflow vừa đổi cấu hình
            get_logger().warning("job.credential_app_type_mismatch")
            return CRED_REJECTED
        return cred

    # ---------- vòng thử (§3.4) ----------

    async def execute(self) -> Outcome:
        cred = await self.credential()
        if isinstance(cred, Failure):
            return Outcome(cred)
        self.cred = cred
        self.progress.push(RUNNING)
        cfg = self.host.cfg
        async with DifyClient(cfg.read_timeout_s, cfg.stop_timeout_s, cfg.dify_transport) as client:
            return await self._attempts(client, cred)

    async def _attempts(self, client: DifyClient, cred: DifyCredential) -> Outcome:
        req = DifyRequest(inputs=self._inputs(), user=self.p.dify_user, query=self._query())
        attempt = 0
        while True:
            attempt += 1
            await self._dispatch_once()
            got = await self._one(client, cred, req)
            if isinstance(got, Outcome):
                kind = "empty" if got.failure is not None else None
                get_logger().info("dify.attempt", n=attempt, http_status=None, err_kind=kind)
                return got
            get_logger().info("dify.attempt", n=attempt, http_status=got.status, err_kind=got.kind)
            flags = RetryFlags(self.state.first_seen, self.p.side_effect)
            delay = retry_delay(got.kind, attempt, flags, self.host.cfg.backoff)
            if delay is None:
                await self._stop_after(client, got.kind)
                return Outcome(dify_failure(got.kind, got.status), usage=self.usage())
            self.progress.push(retry_message(attempt, MAX_RETRIES))
            await asyncio.sleep(delay)

    async def _dispatch_once(self) -> None:
        """Q6 · R8: đánh dấu đã gửi **trước** request Dify đầu (chỉ khi `side_effect`)."""
        if self.dispatched or not self.p.side_effect:
            return
        async with self.host.pool.acquire() as conn:
            ok = await workflow_sql.mark_dispatched(conn, self.job, self.host.cfg.worker_id)
        if not ok:
            raise LostJob
        self.dispatched = True

    async def _one(
        self, client: DifyClient, cred: DifyCredential, req: DifyRequest
    ) -> Outcome | _Err:
        """Một lời gọi: `Outcome` khi Dify kết thúc (kể cả rỗng → `empty`); `_Err` khi lỗi."""
        self.state = StreamState(self.p.app_type)
        self.sent_at = time.monotonic()
        try:
            async for ev in client.run_stream(cred, req):
                self.answered = True
                self.state, step = reduce(self.state, ev.event, ev.data)
                if isinstance(step, Progress):
                    self.progress.push(step_message(step.n))
                elif isinstance(step, Finished):
                    return self._finished()
                elif isinstance(step, Failed):
                    return _Err(step.kind)
        except _TRANSPORT_ERRORS as exc:
            kind, status = classify(exc)
            if isinstance(exc, DifyHTTPError):
                self.answered = True
                get_logger().debug("dify.http_error", status=exc.status, detail=exc.detail)
            return _Err(kind, status)
        return _Err("read")  # stream đóng trước sự kiện kết thúc

    def _finished(self) -> Outcome:
        text = final_text(self.state.text, self.state.outputs, self._field())
        if text is None:
            return Outcome(dify_failure("empty", None), usage=self.usage())
        dropped = self.state.dropped if self.state.text else 0  # text nối đã bị cắt khi stream
        if len(text) + dropped > OUTPUT_MAX:
            get_logger().warning("job.output_truncated", length=len(text) + dropped)
            text = text[:OUTPUT_MAX]
        return Outcome(None, text=text, usage=self.usage())

    async def _stop_after(self, client: DifyClient, kind: ErrKind) -> None:
        """RQ5: lỗi giữa stream (đã có `task_id`) → stop best-effort."""
        if kind not in _NO_STOP:
            await self.stop(client)

    async def stop(self, client: DifyClient | None = None) -> None:
        """Best-effort `stop(task_id)` (≤ `AGENT_RT_DIFY_STOP_TIMEOUT_S`), lỗi bỏ qua."""
        task_id, cred = self.state.task_id, self.cred
        if task_id is None or cred is None:
            return
        if client is not None:
            await client.stop(cred, task_id, self.p.dify_user)
            return
        cfg = self.host.cfg
        async with DifyClient(cfg.read_timeout_s, cfg.stop_timeout_s, cfg.dify_transport) as c:
            await c.stop(cred, task_id, self.p.dify_user)

    # ---------- dữ liệu ----------

    def usage(self) -> UsageRow | None:
        if not self.answered:
            return None
        latency = 0 if self.sent_at is None else int((time.monotonic() - self.sent_at) * 1000)
        feature = str(self.p.feature_id) if self.p.feature_id else None
        return usage_row(self.p.app_type, self.state.usage, max(latency, 0), feature)

    def _inputs(self) -> dict[str, object]:
        """Nguyên văn payload (đã validate ở `JobPayloadWorkflowAsync`) — Hub đã map (R05, R06)."""
        raw = self.job.payload.get("inputs")
        return dict(cast("dict[str, object]", raw)) if isinstance(raw, dict) else {}

    def _query(self) -> str | None:
        return self.p.query.root if self.p.query is not None else None

    def _field(self) -> str | None:
        return self.p.output_field.root if self.p.output_field is not None else None
