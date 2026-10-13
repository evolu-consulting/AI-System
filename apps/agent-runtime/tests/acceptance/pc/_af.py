"""WRK-FR-28 · WRK-FR-29 · HUB-BR-32/33 · WRK-BR-08 · P-c1 · hạ tầng Runtime đầu-cuối tự-sửa (task
R2b, test-plan P-c §6 G11/G12, §9). Không chứa test.

Runtime thật (`python -m agent_runtime`, `_proc.Runtime`) + DB/Redis test (fixture `ctx`) +
`RUNTIME_SANDBOX=fake` (`APP_ENV=test`) + nguồn `local_path` (`HUB_SOURCE_LOCAL_ROOTS`, snapshot
dựng lười theo pin — PB-R16) + mock Hub nội bộ:

- `POST /internal/jobs/:job/autofix-result` — Bearer xác thực bằng DB (`token_hash` ∧ `running` ∧
  `agent.cli`, như `files_env`) ⇒ 201 chứng minh báo cáo gửi TRƯỚC khi job rời `running`
  (plan §1 bước 7). `mode="down"` ⇒ 503 mọi lần (Runtime thử lại rồi job `failed/upstream`).
- `GET /internal/jobs/:job/attachments/:id` — kế thừa `HubFilesMock` (tải `base_patch`).

Chữ ký R3 giả định (test-plan §9 "R2b"): `agent_runtime.autofix.host.AutofixHost`,
`agent_runtime.autofix.ws_tools`; directive `#fake:ws_write=<path>|<base64>`,
`#fake:ws_edit=<path>|<old>|<new>`, `#fake:ws_exec=<cmd>`, `#fake:ws_secret=<path>` (plan §5.6).
"""

from __future__ import annotations

import base64
import importlib
import json
import re
import uuid
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from http import HTTPStatus
from pathlib import Path
from typing import Any

from tests.acceptance._hub_files import HubCall, HubFilesMock, Served, add_file_job
from tests.acceptance._proc import Runtime
from tests.acceptance._rt import ACME, Job, JobSpec, owner_db_url, pg_connect
from tests.acceptance._stream import runtime_logs
from tests.acceptance.conftest import Ctx

_AF = re.compile(r"^/internal/jobs/([^/]+)/autofix-result$")
REPORT_KEYS = {
    "status",
    "branch",
    "base_sha",
    "head_sha",
    "diff",
    "diff_stats",
    "test",
    "failures",
    "commands",
}
SHA_RE = re.compile(r"^[0-9a-f]{40}$")
AWS_RE = re.compile(r"AKIA[0-9A-Z]{16}")
SECRET = "AKIAQCQCQCQCQCQCQCQC"  # test-plan §1 "Chuỗi quét"
SOURCE_KEY = "app-repo"
STAGE = "fix"
SNAPSHOT_ID = "c0c00000-0000-4000-8000-00000000a5a5"
SUM_BUG = "export function sum(a, b) {\n  return a-b;\n}\n"
TEST_SH = (
    "#!/bin/sh\n"
    "if grep -q 'return a+b;' src/sum.js; then echo '1 pass'; exit 0; fi\n"
    "echo '1 fail: sum'; exit 1\n"
)
FIX = "#fake:ws_edit=src/sum.js|a-b;|a+b;"
GOOD_PATCH = (
    "diff --git a/src/extra.js b/src/extra.js\n"
    "new file mode 100644\n"
    "--- /dev/null\n"
    "+++ b/src/extra.js\n"
    "@@ -0,0 +1 @@\n"
    "+export const extra = 1;\n"
)
BAD_PATCH = (
    "diff --git a/src/sum.js b/src/sum.js\n"
    "--- a/src/sum.js\n"
    "+++ b/src/sum.js\n"
    "@@ -1 +1 @@\n"
    "-dong nay khong co trong file\n"
    "+x\n"
)


def need_r3() -> None:
    """Đỏ đúng lý do tới R3: thiếu `AutofixHost` / `ws_tools` (plan §5.1, §5.5, §5.8)."""
    host = importlib.import_module("agent_runtime.autofix.host")
    assert hasattr(host, "AutofixHost"), "qc: agent_runtime.autofix.host.AutofixHost chưa có (R3)"
    importlib.import_module("agent_runtime.autofix.ws_tools")


def ws_write(path: str, text: str) -> str:
    return f"#fake:ws_write={path}|{base64.b64encode(text.encode()).decode()}"


def _resp(status: int, body: dict[str, Any]) -> bytes:
    raw = json.dumps(body).encode()
    head = [
        f"HTTP/1.1 {status} {HTTPStatus(status).phrase}",
        "Content-Type: application/json",
        f"Content-Length: {len(raw)}",
        "Cache-Control: no-store",
        "Connection: close",
    ]
    return ("\r\n".join(head) + "\r\n\r\n").encode("latin-1") + raw


def _error(status: int, code: str) -> bytes:
    return _resp(status, {"error": {"code": code, "message": f"mock {code}"}})


class AfHub(HubFilesMock):
    """Mock Hub file (kế thừa) + `autofix-result`."""

    mode: str = "ok"

    def reports(self, job: Job | None = None) -> list[HubCall]:
        return [
            c
            for c in self.calls("/internal/jobs/")
            if c.method == "POST" and _AF.match(c.path) and (job is None or job.id in c.path)
        ]

    def report(self, job: Job) -> dict[str, Any]:
        """Đúng MỘT báo cáo được nhận (201) cho job; thân JSON đúng bộ khoá contract §3.3."""
        got = [c for c in self.reports(job) if c.status == HTTPStatus.CREATED]
        assert len(got) == 1, [(c.path, c.status) for c in self.reports(job)]
        assert got[0].headers.get("content-type", "").startswith("application/json")
        body: dict[str, Any] = json.loads(got[0].body)
        assert set(body) == REPORT_KEYS, sorted(body)
        return body

    async def _route(self, call: HubCall, w: Any) -> None:
        m = _AF.match(call.path)
        if call.method != "POST" or m is None:
            return await super()._route(call, w)
        if not await self._authorized(m.group(1), call):
            return await self._send(w, call, 401, _error(401, "UNAUTHORIZED"))
        if self.mode == "down":
            return await self._send(w, call, 503, _error(503, "UNAVAILABLE"))
        call.out_id = str(uuid.uuid4())
        await self._send(w, call, 201, _resp(201, {"id": call.out_id}))


def make_repo(root: Path, big_bytes: int = 0) -> Path:
    """Repo nguồn `local_path` (dưới gốc cho phép): `src/sum.js` có lỗi `a-b`, `test.sh`."""
    repo = root / SOURCE_KEY
    (repo / "src").mkdir(parents=True)
    (repo / "src" / "sum.js").write_text(SUM_BUG, encoding="utf-8")
    (repo / "test.sh").write_text(TEST_SH, encoding="utf-8")
    (repo / "README.md").write_text("# app\n", encoding="utf-8")
    (repo / "package.json").write_text('{"name":"app"}\n', encoding="utf-8")
    if big_bytes:
        (repo / "src" / "blob.txt").write_text("b" * big_bytes, encoding="utf-8")
    return repo


@dataclass
class AfEnv:
    ctx: Ctx
    mock: AfHub
    repo: Path
    cache: Path

    def autofix(self, run_id: str, **over: Any) -> dict[str, Any]:
        """`payload.autofix` hợp `JobAutofixSchema` (plan §3.2)."""
        af: dict[str, Any] = {
            "source": {
                "key": SOURCE_KEY,
                "kind": "local_path",
                "pin": {"kind": "local_path", "path": str(self.repo), "snapshot_id": SNAPSHOT_ID},
                "allowlist": [],
            },
            "install_cmd": None,
            "test_cmd": "sh test.sh",
            "write_allowlist": ["src/**"],
            "branch": f"ai/{run_id}/{STAGE}",
            "round": 1,
            "base_patch": None,
        }
        af.update(over)
        return af

    async def job(self, prompt: str, **over: Any) -> Job:
        """Job `agent.cli` tự-sửa (tenant acme, `allowed_tools=[]` — PC-R07) rồi vá `autofix`."""
        conn = self.ctx.conn
        async with conn.transaction():
            spec = JobSpec(prompt=prompt, tenant=ACME, allowed_tools=[], notify=False)
            j = await add_file_job(conn, spec, None)
            payload = dict(j.payload)
            payload["autofix"] = self.autofix(j.run_id, **over)
            await conn.execute(
                "update hub.jobs set payload = $2::jsonb where id = $1", j.id, json.dumps(payload)
            )
            note = {"v": 1, "job_id": j.id, "provider_key": spec.provider}
            await conn.execute("select pg_notify('job_enqueued', $1)", json.dumps(note))
        job = Job(j.id, j.run_id, j.step_id, j.tenant_id, j.conversation_id, j.agent_id, payload)
        self.ctx.jobs.append(job)
        return job

    def patch(self, text: str) -> dict[str, Any]:
        """`base_patch` (`JobAttachment`, text/plain) phục vụ qua mock GET attachments."""
        f: Served = self.mock.add("fix-r1.diff.txt", text.encode(), mime="text/plain")
        return f.item()

    def runtime(self, **env: str) -> Runtime:
        base = {
            "AGENT_RT_HUB_URL": self.mock.url,
            "RUNTIME_SANDBOX": "fake",
            "RUNTIME_ENV": "test",
            "RUNTIME_SOURCE_CACHE_DIR": str(self.cache),
            "HUB_SOURCE_LOCAL_ROOTS": str(self.repo.parent),
        }
        return self.ctx.runtime("qc-af", **{**base, **env})

    def logs(self) -> str:
        return runtime_logs(self.ctx)


@asynccontextmanager
async def af_env(ctx: Ctx, big_bytes: int = 0) -> AsyncGenerator[AfEnv]:
    vconn = await pg_connect(owner_db_url())

    async def verify(job_id: str, digest: bytes) -> bool:
        row = await vconn.fetchval(
            """select 1 from hub.jobs where id = $1::uuid and token_hash = $2
                 and status = 'running' and type = 'agent.cli'""",
            job_id,
            digest,
        )
        return row is not None

    mock = AfHub(verify)
    await mock.start()
    repo = make_repo(ctx.box.root / "roots", big_bytes)
    try:
        yield AfEnv(ctx, mock, repo, ctx.box.root / "src-cache")
    finally:
        await mock.close()
        await vconn.close()


def fail_checks(body: dict[str, Any]) -> list[str]:
    return [str(f["check"]) for f in body["failures"]]


def assert_failed_report(body: dict[str, Any], check: str) -> dict[str, Any]:
    """`check_failed` ⇒ không lưu diff (PC-R08), nhóm trượt đầu = `check`; trả failure đầu."""
    assert body["status"] == "check_failed", body
    assert body["diff"] is None and body["diff_stats"] is None, body
    assert fail_checks(body)[0] == check, body["failures"]
    assert SHA_RE.match(body["base_sha"]) and SHA_RE.match(body["head_sha"]), body
    return body["failures"][0]
