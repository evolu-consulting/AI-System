"""WRK-FR-06 · WRK-FR-07 · WRK-FR-13 · hạ tầng test P H2a (QW-P): job `workflow.async`, mock Dify +
credential Python (`tests/support/dify_mock.py`, PY-02), Runtime thật `fake-cli,dify`.
Không chứa test.

Nguồn: `plan-runtime` §3.3–3.8, §7 (env test `AGENT_RT_DIFY_BACKOFF_S=0.2,0.8`, `AGENT_RT_HUB_URL` =
mock); `plan-runtime-dify` §3.2–3.7; payload `WorkflowAsyncJobSchema` (`packages/contracts/src/hub/
workflow.ts`). Credential: mock xác thực Bearer như Hub (`plan-db` §2 "Token → job"): sha256(token)
= `hub.jobs.token_hash` ∧ `id` ∧ `status='running'` ∧ `type='workflow.async'`.

Đỏ đúng lý do (test-plan §1 "Cấm"): `DifyEnv.runtime()` import `runtimes.dispatch` +
`runtimes.dify.host` (PY-03) **trong thân test**, sau khi DB/Redis/mock đã dựng → trước PY-03 mỗi ca
đỏ ở `ModuleNotFoundError`, không làm hỏng collect.

Kịch bản thêm ngoài `dify_mock.py` (mock khoá, không sửa — `QcDifyMock` chỉ thêm key `qc-*`):
`qc-cut` (P10: `workflow_started` rồi đứt kết nối) · `qc-node` (P17: `node_started` có tiêu đề bí
mật) · `qc-429` (P09, RQ4) · `LEAK_KEY_ECHO*` (P23: 401, thân chứa key thô/base64/hex).
"""

from __future__ import annotations

import asyncio
import base64
import importlib
import json
import socket
import uuid
from collections.abc import AsyncGenerator, Iterable
from contextlib import asynccontextmanager, suppress
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from tests.acceptance._proc import Runtime
from tests.acceptance._rt import (
    BETA,
    USER,
    Job,
    new_conversation,
    owner_db_url,
    pg_connect,
)
from tests.acceptance.conftest import Ctx
from tests.support.dify_mock import CHUNKS, CredentialSpec, DifyMock, MockCall

DIFY = "dify"
WF_ID = "b2a00000-0000-4000-8000-000000000101"
FEATURE = "b2a00000-0000-4000-8000-000000000102"
DIFY_USER = f"qc-beta:{USER}"
MOCK_TEXT = "".join(CHUNKS)
NODE_SECRET = "NODE_SECRET_TITLE"
LEAK = "LEAK_KEY_7f3a9c2e1b0d4f6a8e7c5b3a"
LEAK_ECHO = "LEAK_KEY_ECHO_4e1d2c3b4a5f6e7d8c9b"
RUN_PATHS = ("/v1/workflows/run", "/v1/chat-messages")
PROGRESS_OK = ("Đang chạy lệnh", "Đang chạy bước ")


# ---------- payload + job ----------


@dataclass
class DifySpec:
    app_type: str = "workflow"
    inputs: dict[str, Any] = field(default_factory=lambda: {"source_text": "xin chào"})
    query: str | None = None
    output_field: str | None = "text"
    side_effect: bool = False
    timeout_s: int = 60
    tenant: str = BETA
    feature_id: str | None = FEATURE


def dify_payload(spec: DifySpec, ids: dict[str, str]) -> dict[str, Any]:
    """`WorkflowAsyncJob` (C2) — không `api_key`/`base_url`/token/URL Hub (P4, Q5)."""
    return {
        "v": 1,
        "type": "workflow.async",
        "provider_key": DIFY,
        **ids,
        "tenant_id": spec.tenant,
        "user_id": USER,
        "workflow_id": WF_ID,
        "feature_id": spec.feature_id,
        "command_id": None,
        "workflow_key": "dich",
        "app_type": spec.app_type,
        "inputs": spec.inputs,
        "query": spec.query,
        "output_field": spec.output_field,
        "dify_user": DIFY_USER,
        "side_effect": spec.side_effect,
        "timeout_s": spec.timeout_s,
    }


async def add_dify_job(conn: Any, spec: DifySpec) -> Job:
    """Như Hub B6 (plan §5.3): `runs` + `jobs` (`workflow.async`, `agent_id` NULL) + NOTIFY."""
    conv, flow = await new_conversation(conn, spec.tenant)
    ids = {
        "job_id": str(uuid.uuid4()),
        "run_id": str(uuid.uuid4()),
        "step_id": str(uuid.uuid4()),
        "conversation_id": conv,
        "flow_id": flow,
    }
    payload = dify_payload(spec, ids)
    async with conn.transaction():
        await conn.execute(
            """insert into hub.runs (id, tenant_id, user_id, conversation_id, flow_id, status,
                 config_version, user_message_id, answer_message_id)
               values ($1, $2, $3, $4, $5, 'running', 1, gen_random_uuid(), gen_random_uuid())""",
            ids["run_id"],
            spec.tenant,
            USER,
            conv,
            flow,
        )
        await conn.execute(
            """insert into hub.jobs (id, tenant_id, user_id, run_id, step_id, conversation_id,
                 agent_id, type, provider_key, payload)
               values ($1, $2, $3, $4, $5, $6, null, 'workflow.async', 'dify', $7::jsonb)""",
            ids["job_id"],
            spec.tenant,
            USER,
            ids["run_id"],
            ids["step_id"],
            conv,
            json.dumps(payload),
        )
        note = {"v": 1, "job_id": ids["job_id"], "provider_key": DIFY}
        await conn.execute("select pg_notify('job_enqueued', $1)", json.dumps(note))
    return Job(ids["job_id"], ids["run_id"], ids["step_id"], spec.tenant, conv, "", payload)


async def ensure_dify_provider(conn: Any) -> None:
    """Provider `dify` (api, 5 — WRK-NFR-05) như seed D3."""
    await conn.execute(
        """insert into hub.providers (key, kind, vendor, max_concurrency, enabled, dev_only)
           values ('dify', 'api', 'dify', 5, true, false)
           on conflict (key) do update set enabled = true, max_concurrency = 5"""
    )


def need_router() -> None:
    """PY-03 (`plan-runtime` §3.1): `JobRouter` + `DifyJobHost`. Chưa có → `ModuleNotFoundError`."""
    importlib.import_module("agent_runtime.runtimes.dispatch")
    importlib.import_module("agent_runtime.runtimes.dify.host")


# ---------- mock: kịch bản thêm ----------


def _sse(e: dict[str, Any]) -> bytes:
    return f"event: {e['event']}\ndata: {json.dumps(e, ensure_ascii=False)}\n\n".encode()


def _chunked(data: bytes) -> bytes:
    return b"%x\r\n%s\r\n" % (len(data), data)


_HEAD = (
    b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\n"
    b"Transfer-Encoding: chunked\r\nConnection: close\r\n\r\n"
)


def _json_head(status: int, raw: bytes) -> bytes:
    return (
        f"HTTP/1.1 {status} X\r\nContent-Type: application/json\r\n"
        f"Content-Length: {len(raw)}\r\nConnection: close\r\n\r\n"
    ).encode() + raw


def echo_body(key: str) -> dict[str, Any]:
    """Thân lỗi chứa key thô/base64/hex (như proxy `_h2a.ts` A26/A80)."""
    b = key.encode()
    msg = f"bad api key {key} b64={base64.b64encode(b).decode()} hex={b.hex()} " + "x" * 400
    return {"code": "unauthorized", "message": msg, "status": 401}


class QcDifyMock(DifyMock):
    """`DifyMock` + kịch bản `qc-*` / `LEAK_KEY_ECHO*`; key khác → nguyên hành vi mock khoá."""

    async def _run_app(
        self, w: asyncio.StreamWriter, body: dict[str, Any], chat: bool, key: str
    ) -> None:
        if key.startswith("LEAK_KEY_ECHO"):
            return await self._raw(w, _json_head(401, json.dumps(echo_body(key)).encode()))
        if key == "qc-429":
            err = {"code": "too_many_requests", "message": "mock", "status": 429}
            return await self._raw(w, _json_head(429, json.dumps(err).encode()))
        if key == "qc-cut":
            return await self._cut(w)
        if key == "qc-node":
            return await self._nodes(w)
        return await super()._run_app(w, body, chat, key)

    @staticmethod
    async def _raw(w: asyncio.StreamWriter, data: bytes) -> None:
        w.write(data)
        await w.drain()

    def _base(self) -> dict[str, Any]:
        n = len([c for c in self.calls() if c.path in RUN_PATHS])
        return {"task_id": f"qc-task-{n}", "workflow_run_id": f"qc-run-{n}"}

    async def _cut(self, w: asyncio.StreamWriter) -> None:
        """P10 · RQ5: sự kiện đầu (≠ ping) rồi đóng TCP giữa luồng (không khối kết thúc)."""
        started = {**self._base(), "event": "workflow_started", "data": {"id": "r"}}
        await self._raw(w, _HEAD + _chunked(b"event: ping\n\n") + _chunked(_sse(started)))
        await asyncio.sleep(0.2)
        w.transport.abort()

    async def _nodes(self, w: asyncio.StreamWriter) -> None:
        """P17 · RT7: 6 `node_started` (tiêu đề bí mật) cách 0.3 s rồi chunk + kết thúc."""
        b = self._base()
        await self._raw(w, _HEAD + _chunked(_sse({**b, "event": "workflow_started", "data": {}})))
        for i in range(6):
            data = {"title": f"{NODE_SECRET}-{i}", "node_type": "llm", "index": i + 1}
            await self._raw(w, _chunked(_sse({**b, "event": "node_started", "data": data})))
            await asyncio.sleep(0.3)
        for t in CHUNKS:
            await self._raw(w, _chunked(_sse({**b, "event": "text_chunk", "data": {"text": t}})))
        fin = {"status": "succeeded", "outputs": {"text": MOCK_TEXT}, "total_tokens": 20}
        done = {**b, "event": "workflow_finished", "data": fin}
        await self._raw(w, _chunked(_sse(done)) + b"0\r\n\r\n")


# ---------- môi trường một ca ----------


@dataclass
class DifyEnv:
    ctx: Ctx
    mock: QcDifyMock

    async def job(self, spec: DifySpec | None = None, cred: CredentialSpec | None = None) -> Job:
        """Job `workflow.async` + câu trả lời credential của mock cho job đó (mặc định `mk-ok`)."""
        j = await add_dify_job(self.ctx.conn, spec or DifySpec())
        self.mock.set_credential(j.id, cred or CredentialSpec())
        self.ctx.jobs.append(j)
        return j

    def env(self, **extra: str) -> dict[str, str]:
        return {
            "AGENT_RT_PROVIDERS": "fake-cli,dify",
            "AGENT_RT_HUB_URL": self.mock.hub_url,
            "AGENT_RT_DIFY_BACKOFF_S": "0.2,0.8",
            **extra,
        }

    def runtime(self, worker: str = "qc-1", **extra: str) -> Runtime:
        need_router()
        return self.ctx.runtime(worker, **self.env(**extra))

    def runs(self) -> list[MockCall]:
        return [c for c in self.mock.calls() if c.path in RUN_PATHS]

    def creds(self, job: Job) -> list[MockCall]:
        return self.mock.calls(f"/internal/jobs/{job.id}/")

    def stops(self) -> list[MockCall]:
        return [c for c in self.mock.calls("/v1/") if c.path.endswith("/stop")]


@asynccontextmanager
async def dify_env(ctx: Ctx) -> AsyncGenerator[DifyEnv]:
    """Provider `dify` + mock (cùng event loop của ca) xác thực Bearer bằng DB như Hub."""
    await ensure_dify_provider(ctx.conn)
    vconn = await pg_connect(owner_db_url())
    lock = asyncio.Lock()

    async def verify(job_id: str, digest: bytes) -> bool:
        async with lock:
            row = await vconn.fetchval(
                """select 1 from hub.jobs where id = $1::uuid and token_hash = $2
                     and status = 'running' and type = 'workflow.async'""",
                job_id,
                digest,
            )
        return row is not None

    mock = QcDifyMock(verify_token=verify)
    await mock.start()
    try:
        yield DifyEnv(ctx, mock)
    finally:
        await mock.close()
        await vconn.close()


# ---------- quan sát ----------


def bearer(call: MockCall) -> str:
    return call.auth.split(" ", 1)[1] if " " in call.auth else ""


def progress(evs: Iterable[dict[str, Any]]) -> list[str]:
    return [str(e["message"]) for e in evs if e.get("type") == "job.progress"]


def leak_forms(secret: str) -> list[str]:
    """Thô, base64 (có/không padding), base64url, hex thường/hoa (= `leakForms` TS)."""
    b = secret.encode()
    b64 = base64.b64encode(b).decode()
    hx = b.hex()
    return [secret, b64, b64.rstrip("="), base64.urlsafe_b64encode(b).decode(), hx, hx.upper()]


def files_text(root: Path) -> str:
    """Nội dung mọi file dưới `root` (log job, log Runtime) — quét rò rỉ."""
    out: list[str] = []
    for p in sorted(root.rglob("*")):
        if p.is_file():
            with suppress(OSError):
                out.append(p.read_text(errors="replace"))
    return "\n".join(out)


def closed_port_url() -> str:
    """URL `base_url` Dify tới cổng không ai nghe (P11: lỗi kết nối)."""
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    return f"http://127.0.0.1:{port}/v1"


def log_events(text: str, name: str) -> list[dict[str, Any]]:
    """Dòng log JSON Runtime có `event == name`."""
    out: list[dict[str, Any]] = []
    for line in text.splitlines():
        with suppress(ValueError):
            obj = json.loads(line)
            if isinstance(obj, dict) and obj.get("event") == name:  # pyright: ignore[reportUnknownMemberType]
                out.append(obj)  # pyright: ignore[reportUnknownArgumentType]
    return out
