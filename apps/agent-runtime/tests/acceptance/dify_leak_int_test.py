"""HUB-H2a-AC-04 · H2a-R17 · RT1 · P23: app-key Dify (`LEAK_KEY_…`) và token claim không lọt ra
ngoài bộ nhớ Runtime (`plan-runtime` §3.3 bước 2–4; `-dify` §3.7 "message là câu tĩnh").

Quét dạng thô / base64 / base64url / hex trong: `hub.jobs` (mọi cột), `hub.usage_logs`, Redis
`run:<id>`, stdout/stderr Runtime (log JSON), file log job (`AGENT_RT_LOG_DIR`). Lỗi `401` có key
trong thân (`LEAK_KEY_ECHO…`) → log đã che (`mask`).
Trước PY-03: đỏ ở `ModuleNotFoundError` (`DifyEnv.runtime` → `need_router`).
"""

from __future__ import annotations

import json

import pytest

from tests.acceptance._dify import (
    LEAK,
    LEAK_ECHO,
    DifyEnv,
    bearer,
    dify_env,
    files_text,
    leak_forms,
)
from tests.acceptance._proc import Runtime
from tests.acceptance._rt import Job, events
from tests.acceptance.conftest import Ctx
from tests.support.dify_mock import CredentialSpec

pytestmark = pytest.mark.int


async def surfaces(d: DifyEnv, job: Job, rt: Runtime) -> dict[str, str]:
    """Mọi bề mặt quan sát được ngoài Runtime (hộp đen P)."""
    conn = d.ctx.conn
    jobs = await conn.fetch("select to_jsonb(j)::text as t from hub.jobs j where id = $1", job.id)
    usage = await conn.fetch(
        "select to_jsonb(u)::text as t from hub.usage_logs u where job_id = $1", job.id
    )
    stream = await events(d.ctx.rd, job.run_id)
    return {
        "jobs": "\n".join(str(r["t"]) for r in jobs),
        "usage_logs": "\n".join(str(r["t"]) for r in usage),
        "redis": json.dumps(stream, ensure_ascii=False),
        "runtime_log": rt.stdout() + rt.err.read_text(errors="replace"),
        "job_logs": files_text(d.ctx.box.logs),
    }


def hits(where: dict[str, str], secret: str) -> list[tuple[str, str]]:
    return [(k, f) for k, text in where.items() for f in leak_forms(secret) if f in text]


async def test_hub_h2a_ac_04_p23_key_and_token_not_leaked(ctx: Ctx) -> None:
    """P23 · AC-04 · job chạy xong với app-key `LEAK_KEY_…` → key (mọi dạng) và token claim không
    có trong `jobs`, `usage_logs`, Redis, log JSON Runtime, file log job."""
    async with dify_env(ctx) as d:
        job = await d.job(cred=CredentialSpec(api_key=LEAK))
        rt = d.runtime()
        await ctx.until_status(job, ["succeeded"], 15)
        [run] = d.runs()
        assert run.auth == f"Bearer {LEAK}"  # key đúng là đã tới Dify (đối chứng)
        token = bearer(d.creds(job)[0])
        assert len(token) == 43
        where = await surfaces(d, job, rt)
        assert hits(where, LEAK) == []
        assert hits(where, token) == []


async def test_hub_h2a_ac_04_p23_error_body_masked(ctx: Ctx) -> None:
    """P23 · AC-04 · Dify trả 401 với thân chứa key (thô/base64/hex) → `NOT_CONFIGURED`/`upstream`;
    key không có ở mọi bề mặt (log thân lỗi ≤ 300 ký tự đã `mask`)."""
    async with dify_env(ctx) as d:
        job = await d.job(cred=CredentialSpec(api_key=LEAK_ECHO))
        rt = d.runtime()
        row = await ctx.until_status(job, ["failed"], 15)
        assert (row["error_code"], row["error_reason"]) == ("NOT_CONFIGURED", "upstream")
        assert len(d.runs()) == 1
        assert hits(await surfaces(d, job, rt), LEAK_ECHO) == []
