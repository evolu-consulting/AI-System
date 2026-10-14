"""HUB-FR-129 · WRK-FR-29 · HUB-BR-30 · HUB-BR-34 · P-c2 · hạ tầng Runtime đầu-cuối job
`source.apply`
(test-plan P-c2 §2, §6 G6). Không chứa test.

Runtime thật (`_proc.Runtime`) + DB/Redis test (fixture `ctx`) + `RUNTIME_SANDBOX=fake` + repo git
**bare cục bộ** (nguồn `https://github.com/pc2-test/<repo>.git` ánh xạ bằng `GIT_CONFIG_*` insteadOf
→ `file://`, C6 P-b, `RUNTIME_ENV=test`) + mock Hub nội bộ:

- `GET /internal/jobs/:job/attachments/:id` — kế thừa `HubFilesMock` (tải bản vá `patch`).
- `POST /internal/jobs/:job/source-credential` — Bearer xác thực bằng DB (`token_hash` ∧ `running`
  ∧ `source.apply`); `cred="ok"` ⇒ 200 `{username, token}`; `cred="missing"` ⇒ 409 NOT_CONFIGURED.
- `POST /internal/jobs/:job/apply-result` — 201 `{id}` (ghi lại thân để kiểm).

Chữ ký giả định (plan §5.2; test-plan G6): `agent_runtime.apply.host.ApplyHost`; dispatch job
`source.apply` (provider_key NULL, claim riêng như `source.resolve`); báo cáo trước khi kết thúc
job.
"""

from __future__ import annotations

import importlib
import json
import os
import re
import subprocess
import uuid
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from http import HTTPStatus
from pathlib import Path
from typing import Any

from tests.acceptance._hub_files import HubCall, HubFilesMock
from tests.acceptance._proc import Runtime
from tests.acceptance._rt import ACME, USER, Job, owner_db_url, pg_connect
from tests.acceptance._stream import runtime_logs
from tests.acceptance.conftest import Ctx

TOKEN = "qc-pc2-tok-rt-Zx9Pq7Lm"
OWNER = "pc2-test"
REPO = "app-repo"
URL = f"https://github.com/{OWNER}/{REPO}.git"
SRC_ID = "c2c20000-0000-4000-8000-0000000000b1"
SHA_RE = re.compile(r"^[0-9a-f]{40}$")
SUM_BUG = "export function sum(a, b) {\n  return a-b;\n}\n"
SUM_FIX = "export function sum(a, b) {\n  return a+b;\n}\n"
TEST_SH = (
    "#!/bin/sh\n"
    "if grep -q 'return a+b;' src/sum.js; then echo '1 pass'; exit 0; fi\n"
    "echo '1 fail: sum'; exit 1\n"
)
_CRED = re.compile(r"^/internal/jobs/([^/]+)/source-credential$")
_APPLY = re.compile(r"^/internal/jobs/([^/]+)/apply-result$")
GIT_ENV = {
    "GIT_AUTHOR_NAME": "qc",
    "GIT_AUTHOR_EMAIL": "qc@local",
    "GIT_COMMITTER_NAME": "qc",
    "GIT_COMMITTER_EMAIL": "qc@local",
    "GIT_CONFIG_NOSYSTEM": "1",
    "GIT_TERMINAL_PROMPT": "0",
}


def need_r2() -> None:
    """Đỏ đúng lý do tới R2: thiếu `ApplyHost` (plan §5.2)."""
    host = importlib.import_module("agent_runtime.apply.host")
    assert hasattr(host, "ApplyHost"), "qc: agent_runtime.apply.host.ApplyHost chưa có (R2)"


def git(cwd: Path, *args: str) -> str:
    env = {**os.environ, **GIT_ENV}
    for k in [k for k in env if k.startswith("GIT_CONFIG_") and k != "GIT_CONFIG_NOSYSTEM"]:
        env.pop(k)
    r = subprocess.run(["git", *args], cwd=cwd, env=env, capture_output=True, text=True, check=True)
    return r.stdout.strip()


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


class ApplyHub(HubFilesMock):
    """Mock Hub file (kế thừa) + `source-credential` + `apply-result`."""

    cred: str = "ok"

    def creds(self, job: Job | None = None) -> list[HubCall]:
        return [
            c
            for c in self.calls("/internal/jobs/")
            if c.method == "POST" and _CRED.match(c.path) and (job is None or job.id in c.path)
        ]

    def reports(self, job: Job | None = None) -> list[HubCall]:
        return [
            c
            for c in self.calls("/internal/jobs/")
            if c.method == "POST" and _APPLY.match(c.path) and (job is None or job.id in c.path)
        ]

    def report(self, job: Job) -> dict[str, Any]:
        """Đúng MỘT báo cáo 201 cho job; trả thân JSON."""
        got = [c for c in self.reports(job) if c.status == HTTPStatus.CREATED]
        assert len(got) == 1, [(c.path, c.status) for c in self.reports(job)]
        body: dict[str, Any] = json.loads(got[0].body)
        return body

    async def _route(self, call: HubCall, w: Any) -> None:
        m = _CRED.match(call.path) or _APPLY.match(call.path)
        if call.method != "POST" or m is None:
            return await super()._route(call, w)
        if not await self._authorized(m.group(1), call):
            return await self._send(w, call, 401, _error(401, "UNAUTHORIZED"))
        if _CRED.match(call.path):
            if self.cred == "missing":
                return await self._send(w, call, 409, _error(409, "NOT_CONFIGURED"))
            body = {"username": "x-access-token", "token": TOKEN}
            return await self._send(w, call, 200, _resp(200, body))
        call.out_id = str(uuid.uuid4())
        await self._send(w, call, 201, _resp(201, {"id": call.out_id}))


@dataclass
class Origin:
    """Repo nguồn: `seed` (cây làm việc) + `bare/<repo>.git` (remote)."""

    seed: Path
    bare_root: Path

    @property
    def bare(self) -> Path:
        return self.bare_root / f"{REPO}.git"

    def head(self, ref: str = "main") -> str | None:
        r = subprocess.run(
            [
                "git",
                "--git-dir",
                str(self.bare),
                "rev-parse",
                "--verify",
                "-q",
                f"refs/heads/{ref}",
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        return r.stdout.strip() or None

    def refs(self) -> list[str]:
        out = git(self.bare, "for-each-ref", "--format=%(refname)")
        return [x for x in out.splitlines() if x]

    def commit(self, files: dict[str, str], msg: str) -> str:
        for p, text in files.items():
            (self.seed / p).parent.mkdir(parents=True, exist_ok=True)
            (self.seed / p).write_text(text, encoding="utf-8", newline="\n")
        git(self.seed, "add", "-A")
        git(self.seed, "commit", "-q", "-m", msg)
        git(self.seed, "push", "-q", str(self.bare), "HEAD:refs/heads/main")
        return git(self.seed, "rev-parse", "HEAD")

    def patch(self, files: dict[str, str], base: str) -> str:
        """Bản vá `git diff --full-index --binary` từ `base` (như diff tự-sửa P-c1); cây trả về."""
        git(self.seed, "checkout", "-q", base)
        for p, text in files.items():
            (self.seed / p).write_text(text, encoding="utf-8", newline="\n")
        out = subprocess.run(
            ["git", "diff", "--full-index", "--binary"],
            cwd=self.seed,
            capture_output=True,
            text=True,
            check=True,
        ).stdout
        git(self.seed, "checkout", "-q", "--", ".")
        git(self.seed, "checkout", "-q", "main")
        return out

    def install_hook(self, script: str) -> None:
        hook = self.bare / "hooks" / "pre-receive"
        hook.write_text(script, encoding="utf-8", newline="\n")
        hook.chmod(0o755)


def make_origin(root: Path) -> Origin:
    seed = root / "seed"
    seed.mkdir(parents=True)
    git(seed, "init", "-q", "-b", "main")
    o = Origin(seed, root / "bare")
    o.bare_root.mkdir(parents=True)
    for p, text in {
        "src/sum.js": SUM_BUG,
        "test.sh": TEST_SH,
        "README.md": "# app\n",
    }.items():
        (seed / p).parent.mkdir(parents=True, exist_ok=True)
        (seed / p).write_text(text, encoding="utf-8", newline="\n")
    git(seed, "add", "-A")
    git(seed, "commit", "-q", "-m", "c1")
    git(root, "clone", "-q", "--bare", str(seed), str(o.bare))
    return o


@dataclass
class ApplyEnv:
    ctx: Ctx
    mock: ApplyHub
    origin: Origin
    cache: Path
    jobs: list[Job] = field(default_factory=list[Job])

    def runtime(self, **env: str) -> Runtime:
        base = {
            "AGENT_RT_HUB_URL": self.mock.url,
            "RUNTIME_SANDBOX": "fake",
            "RUNTIME_ENV": "test",
            "RUNTIME_SOURCE_CACHE_DIR": str(self.cache),
            "GIT_CONFIG_COUNT": "2",
            "GIT_CONFIG_KEY_0": f"url.{self.origin.bare_root.as_uri()}/.insteadOf",
            "GIT_CONFIG_VALUE_0": f"https://github.com/{OWNER}/",
            "GIT_CONFIG_KEY_1": "protocol.file.allow",
            "GIT_CONFIG_VALUE_1": "always",
        }
        return self.ctx.runtime("qc-apply", **{**base, **env})

    def payload(
        self, job_id: str, run_id: str, pin: str, patch: str, **over: Any
    ) -> dict[str, Any]:
        f = self.mock.add("fix-r1.diff.txt", patch.encode(), mime="text/plain")
        p: dict[str, Any] = {
            "v": 1,
            "type": "source.apply",
            "job_id": job_id,
            "tenant_id": ACME,
            "process_run_id": run_id,
            "source": {
                "source_id": SRC_ID,
                "key": REPO,
                "url": URL,
                "branch": "main",
                "has_credential": True,
            },
            "pin_sha": pin,
            "branch": f"ai/{run_id}/fix",
            "apply_mode": "pr",
            "push_only": False,
            "patch": f.item(),
            "install_cmd": None,
            "test_cmd": "sh test.sh",
            "write_allowlist": ["src/**"],
            "timeout_s": 120,
        }
        p.update(over)
        return p

    async def job(self, pin: str, patch: str, run_id: str | None = None, **over: Any) -> Job:
        """Job `source.apply` như Hub (plan §6.2): INSERT + NOTIFY (provider_key NULL, không
        agent)."""
        jid, rid = str(uuid.uuid4()), run_id or str(uuid.uuid4())
        payload = self.payload(jid, rid, pin, patch, **over)
        conn = self.ctx.conn
        async with conn.transaction():
            await conn.execute(
                """insert into hub.jobs (id, tenant_id, user_id, type, payload)
                   values ($1, $2, $3, 'source.apply', $4::jsonb)""",
                jid,
                ACME,
                USER,
                json.dumps(payload),
            )
            note = {"v": 1, "job_id": jid, "provider_key": None}
            await conn.execute("select pg_notify('job_enqueued', $1)", json.dumps(note))
        job = Job(jid, rid, "", ACME, "", "", payload)
        self.ctx.jobs.append(job)
        return job

    def logs(self) -> str:
        return runtime_logs(self.ctx)

    def leaks(self) -> list[str]:
        """Nơi chứa TOKEN: file dưới sandbox (work/cache/home/logs), repo bare, log Runtime, thân
        gửi Hub."""
        hits: list[str] = []
        for root in (self.ctx.box.root, self.origin.bare_root):
            for p in root.rglob("*"):
                if p.is_file() and TOKEN.encode() in p.read_bytes():
                    hits.append(str(p))
        if TOKEN in self.logs():
            hits.append("runtime log")
        for c in self.mock.reports():
            if TOKEN.encode() in c.body:
                hits.append(f"report {c.path}")
        return hits


@asynccontextmanager
async def apply_env(ctx: Ctx) -> AsyncGenerator[ApplyEnv]:
    vconn = await pg_connect(owner_db_url())

    async def verify(job_id: str, digest: bytes) -> bool:
        row = await vconn.fetchval(
            """select 1 from hub.jobs where id = $1::uuid and token_hash = $2
                 and status = 'running' and type = 'source.apply'""",
            job_id,
            digest,
        )
        return row is not None

    mock = ApplyHub(verify)
    await mock.start()
    origin = make_origin(ctx.box.root / "git")
    try:
        yield ApplyEnv(ctx, mock, origin, ctx.box.root / "src-cache")
    finally:
        await mock.close()
        await vconn.close()
