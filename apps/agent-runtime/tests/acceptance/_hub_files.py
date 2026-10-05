"""WRK-FR-11 · WRK-FR-18 · WRK-BR-07 · hạ tầng test P H2c (QW-P, test-plan-py §2, test-plan §2
"Mock Hub file", Lệch L6): mock Hub nội bộ file + dựng job `agent.cli` có `payload.attachments`.
Không chứa test.

Mock (asyncio stdlib, cùng kiểu `tests/support/dify_mock.py`; file này nằm dưới
`tests/acceptance` nên tự được khoá — L6), giá trị `AGENT_RT_HUB_URL` = `HubFilesMock.url`:

- `GET /internal/jobs/:job/attachments/:id` — nội dung đăng ký theo id (`add`), chỉ thị theo `mode`
  của id: `ok` · `sha-wrong` (cùng cỡ, byte cuối đổi) · `short` (thiếu 1 byte, `Content-Length`
  khớp thân) · `long` (thừa 64 KiB) · `5xx-once` (503 lần đầu) · `5xx-always` · `401` · `404` ·
  `slow=<ms>` (chờ trước khi trả). 200 kèm `Content-Length`, `X-Content-SHA256`.
- `POST /internal/jobs/:job/outputs` — đọc thân theo `Content-Length` (hoặc chunked), ghi header
  (`X-Filename`, `Authorization`, `Content-Length`, `Content-Type`) + thân; 201 `{id: uuid4}`.
  Chỉ thị theo tên **đã giải mã** `X-Filename`: `*.exe` → 415 · `quota-*` → 409 · `deny-*` → 401 ·
  `flaky-*` → 503 lần đầu · `hold-<ms>-*` → giữ `<ms>` rồi 201.
- Bearer: `verify(job_id, sha256(token))` (qc: `hub.jobs.token_hash` ∧ `running` ∧ `agent.cli`,
  như Hub plan §5.4) sai → 401 `UNAUTHORIZED` (cả GET lẫn POST, trước chỉ thị).

Job: bọc `add_job` của `_rt.py` (khoá) như `_stream.py` — chèn không NOTIFY, vá
`payload.attachments` (+ khoá khác), rồi NOTIFY trong cùng transaction.
"""

from __future__ import annotations

import asyncio
import dataclasses
import hashlib
import json
import re
import stat
import time
import unicodedata
import uuid
from collections.abc import AsyncGenerator, Awaitable, Callable
from contextlib import asynccontextmanager, suppress
from dataclasses import dataclass, field
from http import HTTPStatus
from pathlib import Path
from typing import Any
from urllib.parse import unquote

from tests.acceptance._proc import Runtime
from tests.acceptance._rt import BETA, Job, JobSpec, add_job, owner_db_url, pg_connect
from tests.acceptance._stream import runtime_logs
from tests.acceptance.conftest import Ctx

Verifier = Callable[[str, bytes], Awaitable[bool]]
CHUNK = 65_536
PDF = "application/pdf"
MD = "text/markdown"
_GET = re.compile(r"^/internal/jobs/([^/]+)/attachments/([^/]+)$")
_POST = re.compile(r"^/internal/jobs/([^/]+)/outputs$")
_HOLD = re.compile(r"^hold-(\d+)-")
_SLOW = re.compile(r"^slow=(\d+)$")
UNAUTHORIZED = {"error": {"code": "UNAUTHORIZED", "message": "Unauthorized"}}


def nfc(name: str) -> str:
    return unicodedata.normalize("NFC", name)


def sha_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def pdf_bytes(n: int, seed: str = "") -> bytes:
    """`n` byte bắt đầu bằng chữ ký PDF; `seed` đổi nội dung (sha khác nhau giữa file)."""
    head = f"%PDF-1.4\n%{seed}\n".encode()
    return (head + b"A" * max(0, n - len(head)))[:n]


@dataclass(frozen=True)
class Served:
    """Một file Hub phục vụ: `item()` = phần tử `payload.attachments` (`JobAttachment`, C2)."""

    id: str
    name: str
    data: bytes
    mode: str = "ok"
    mime: str = PDF

    @property
    def sha(self) -> str:
        return sha_hex(self.data)

    def item(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "mime": self.mime,
            "size": len(self.data),
            "sha256": self.sha,
        }


@dataclass
class HubCall:
    method: str
    path: str
    headers: dict[str, str]
    body: bytes
    t: float
    status: int = 0
    out_id: str | None = None
    done: float = 0.0

    @property
    def bearer(self) -> str:
        auth = self.headers.get("authorization", "")
        return auth.split(" ", 1)[1] if auth.lower().startswith("bearer ") else ""

    @property
    def filename(self) -> str:
        return unquote(self.headers.get("x-filename", ""))


def _head(status: int, headers: dict[str, str]) -> bytes:
    lines = [f"HTTP/1.1 {status} {HTTPStatus(status).phrase}"]
    lines += [f"{k}: {v}" for k, v in {**headers, "Connection": "close"}.items()]
    return ("\r\n".join(lines) + "\r\n\r\n").encode("latin-1")


def _json(status: int, body: dict[str, Any]) -> bytes:
    raw = json.dumps(body).encode()
    hdr = {"Content-Type": "application/json", "Content-Length": str(len(raw))}
    return _head(status, hdr) + raw


def _err(status: int, code: str) -> bytes:
    return _json(status, {"error": {"code": code, "message": f"mock {code}"}})


async def _read_body(reader: asyncio.StreamReader, headers: dict[str, str]) -> bytes:
    if headers.get("transfer-encoding", "").lower() == "chunked":
        out = bytearray()
        while True:
            size = int((await reader.readline()).strip().split(b";")[0] or b"0", 16)
            if size == 0:
                await reader.readline()
                return bytes(out)
            out += await reader.readexactly(size)
            await reader.readline()
    size = int(headers.get("content-length", "0") or 0)
    return await reader.readexactly(size) if size else b""


class HubFilesMock:
    """Server mock; dùng qua `files_env(ctx)` (cùng event loop của ca)."""

    def __init__(self, verify: Verifier | None = None) -> None:
        self.verify = verify
        self.url = ""
        self.files: dict[str, Served] = {}
        self._log: list[HubCall] = []
        self._once: set[str] = set()
        self._server: asyncio.Server | None = None

    async def start(self) -> None:
        self._server = await asyncio.start_server(self._handle, "127.0.0.1", 0)
        self.url = f"http://127.0.0.1:{self._server.sockets[0].getsockname()[1]}"

    async def close(self) -> None:
        if self._server is not None:
            self._server.close()
            with suppress(Exception):
                await asyncio.wait_for(self._server.wait_closed(), 2)
            self._server = None

    def add(self, name: str, data: bytes, mode: str = "ok", mime: str = PDF) -> Served:
        f = Served(str(uuid.uuid4()), nfc(name), data, mode, mime)
        self.files[f.id] = f
        return f

    def calls(self, prefix: str = "") -> list[HubCall]:
        return [c for c in self._log if c.path.startswith(prefix)]

    def gets(self, job: Job | None = None) -> list[HubCall]:
        pre = f"/internal/jobs/{job.id}/attachments/" if job else "/internal/jobs/"
        return [c for c in self.calls(pre) if c.method == "GET"]

    def gets_of(self, f: Served) -> list[HubCall]:
        return [c for c in self.gets() if c.path.endswith(f"/attachments/{f.id}")]

    def posts(self, job: Job | None = None) -> list[HubCall]:
        return [
            c
            for c in self._log
            if c.method == "POST" and _POST.match(c.path) and (job is None or job.id in c.path)
        ]

    async def _handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            line = await reader.readline()
            parts = line.decode("latin-1").split()
            if len(parts) >= 2:
                headers: dict[str, str] = {}
                while (h := await reader.readline()) not in (b"\r\n", b"\n", b""):
                    k, _, v = h.decode("latin-1").partition(":")
                    headers[k.strip().lower()] = v.strip()
                body = await _read_body(reader, headers)
                call = HubCall(
                    parts[0].upper(), parts[1].split("?", 1)[0], headers, body, time.time()
                )
                self._log.append(call)
                await self._route(call, writer)
                call.done = time.time()
        except (ConnectionError, asyncio.IncompleteReadError, ValueError):
            pass
        finally:
            writer.close()
            with suppress(Exception):
                await writer.wait_closed()

    async def _authorized(self, job_id: str, call: HubCall) -> bool:
        if not call.bearer:
            return False
        if self.verify is None:
            return True
        return await self.verify(job_id, hashlib.sha256(call.bearer.encode()).digest())

    async def _send(self, w: asyncio.StreamWriter, call: HubCall, status: int, raw: bytes) -> None:
        call.status = status
        w.write(raw)
        await w.drain()

    async def _route(self, call: HubCall, w: asyncio.StreamWriter) -> None:
        if call.method == "GET" and (m := _GET.match(call.path)):
            if not await self._authorized(m.group(1), call):
                return await self._send(w, call, 401, _json(401, UNAUTHORIZED))
            return await self._serve(w, call, self.files.get(m.group(2)))
        if call.method == "POST" and (m := _POST.match(call.path)):
            if not await self._authorized(m.group(1), call):
                return await self._send(w, call, 401, _json(401, UNAUTHORIZED))
            return await self._output(w, call)
        await self._send(w, call, 404, _err(404, "NOT_FOUND"))

    async def _serve(self, w: asyncio.StreamWriter, call: HubCall, f: Served | None) -> None:
        if f is None or f.mode == "404":
            return await self._send(w, call, 404, _err(404, "NOT_FOUND"))
        if f.mode == "401":
            return await self._send(w, call, 401, _json(401, UNAUTHORIZED))
        if f.mode == "5xx-always" or (f.mode == "5xx-once" and f.id not in self._once):
            self._once.add(f.id)
            return await self._send(w, call, 503, _err(503, "UNAVAILABLE"))
        if m := _SLOW.match(f.mode):
            await asyncio.sleep(int(m.group(1)) / 1000)
        data = f.data
        if f.mode == "sha-wrong":
            data = data[:-1] + bytes([data[-1] ^ 0xFF])
        elif f.mode == "short":
            data = data[:-1]
        elif f.mode == "long":
            data = data + b"Z" * CHUNK
        hdr = {
            "Content-Type": f.mime,
            "Content-Length": str(len(data)),
            "X-Content-SHA256": f.sha,
            "Cache-Control": "no-store",
        }
        call.status = 200
        w.write(_head(200, hdr))
        for i in range(0, len(data), CHUNK):
            w.write(data[i : i + CHUNK])
            await w.drain()

    async def _output(self, w: asyncio.StreamWriter, call: HubCall) -> None:
        name = call.filename
        if name.endswith(".exe"):
            return await self._send(w, call, 415, _err(415, "UNSUPPORTED_MEDIA_TYPE"))
        if name.startswith("quota-"):
            return await self._send(w, call, 409, _err(409, "CONFLICT"))
        if name.startswith("deny-"):
            return await self._send(w, call, 401, _json(401, UNAUTHORIZED))
        if name.startswith("flaky-") and name not in self._once:
            self._once.add(name)
            return await self._send(w, call, 503, _err(503, "UNAVAILABLE"))
        if m := _HOLD.match(name):
            await asyncio.sleep(int(m.group(1)) / 1000)
        call.out_id = str(uuid.uuid4())
        await self._send(w, call, 201, _json(201, {"id": call.out_id}))


# ---------- job có file ----------


async def add_file_job(
    conn: Any, spec: JobSpec, attachments: list[dict[str, Any]] | None, **patch: Any
) -> Job:
    """`add_job` (không NOTIFY) → vá `payload.attachments` (None = không khoá) + `patch` →
    NOTIFY."""
    async with conn.transaction():
        job = await add_job(conn, dataclasses.replace(spec, notify=False))
        payload = dict(job.payload)
        if attachments is not None:
            payload["attachments"] = attachments
        payload.update(patch)
        await conn.execute(
            "update hub.jobs set payload = $2::jsonb where id = $1", job.id, json.dumps(payload)
        )
        if spec.notify:
            note = {"v": 1, "job_id": job.id, "provider_key": spec.provider}
            await conn.execute("select pg_notify('job_enqueued', $1)", json.dumps(note))
    return dataclasses.replace(job, payload=payload)


@dataclass
class FilesEnv:
    ctx: Ctx
    mock: HubFilesMock
    extra: dict[str, str] = field(default_factory=dict[str, str])

    async def job(
        self,
        prompt: str,
        files: list[Served] | list[dict[str, Any]] | None = None,
        **kw: Any,
    ) -> Job:
        """Job agent (tenant beta) có `attachments` (Served → `item()`; dict giữ nguyên)."""
        items = None if files is None else [f.item() if isinstance(f, Served) else f for f in files]
        patch = kw.pop("patch", {})
        spec = JobSpec(prompt=prompt, tenant=kw.pop("tenant", BETA), **kw)
        j = await add_file_job(self.ctx.conn, spec, items, **patch)
        self.ctx.jobs.append(j)
        return j

    def runtime(self, worker: str = "qc-1", hub: bool = True, **env: str) -> Runtime:
        """Runtime thật `fake-cli`; `hub=False` ⇒ không `AGENT_RT_HUB_URL` (P30, P49)."""
        base = {"AGENT_RT_HUB_URL": self.mock.url} if hub else {}
        return self.ctx.runtime(worker, **base, **self.extra, **env)

    def work(self, job: Job) -> Path:
        return self.ctx.box.work / job.id

    def logs(self) -> str:
        return runtime_logs(self.ctx)


@asynccontextmanager
async def files_env(ctx: Ctx) -> AsyncGenerator[FilesEnv]:
    """Mock Hub file xác thực Bearer bằng DB (`token_hash`, `running`, `agent.cli`)."""
    vconn = await pg_connect(owner_db_url())
    lock = asyncio.Lock()

    async def verify(job_id: str, digest: bytes) -> bool:
        async with lock:
            row = await vconn.fetchval(
                """select 1 from hub.jobs where id = $1::uuid and token_hash = $2
                     and status = 'running' and type = 'agent.cli'""",
                job_id,
                digest,
            )
        return row is not None

    mock = HubFilesMock(verify)
    await mock.start()
    try:
        yield FilesEnv(ctx, mock)
    finally:
        await mock.close()
        await vconn.close()


# ---------- quan sát ----------


def listing(d: Path) -> list[str]:
    """Tên mục trực tiếp trong `d` (sắp xếp); `d` không tồn tại → []."""
    try:
        return sorted(p.name for p in d.iterdir())
    except OSError:
        return []


def mode_of(p: Path) -> int:
    return stat.S_IMODE(p.lstat().st_mode)


def is_real_dir(p: Path) -> bool:
    try:
        return stat.S_ISDIR(p.lstat().st_mode)
    except OSError:
        return False


def files_lines(files: list[Served]) -> str:
    """Kết quả `#fake:files` mong đợi: `<name>:<sha>` sắp theo tên (code point), nối `\\n`."""
    return "\n".join(f"{f.name}:{f.sha}" for f in sorted(files, key=lambda f: f.name))


async def token_hash(ctx: Ctx, job: Job) -> bytes:
    raw = await ctx.conn.fetchval("select token_hash from hub.jobs where id = $1", job.id)
    return bytes(raw or b"")


def digest(token: str) -> bytes:
    return hashlib.sha256(token.encode()).digest()
