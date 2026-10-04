"""WRK-FR-01 · WRK-FR-05 · WRK-BR-07 · hạ tầng test nhóm P (test-plan H1 §1–2, §6). Không chứa test.

Hộp đen: chỉ `hub.jobs` (+ bảng Runtime plan-db §3.3), NOTIFY, Redis `run:<id>`, `/proc`, file log.
DB: `AGENT_RT_TEST_DATABASE_URL` (role `agent_runtime`, DB `ai_system_h1_test`);
thiếu → suy từ host compose. Owner (`ai`) dựng schema (migration SQL của `packages/db`, cùng
thứ tự `runMigrations` + `runHubMigrations` `appEnv=test`) và dữ liệu tối thiểu (tenant, provider,
hội thoại, run, job). Không chạy song song `test:int` TS.
"""

from __future__ import annotations

import asyncio
import json
import os
import socket
import time
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import asyncpg  # pyright: ignore[reportMissingTypeStubs]
import redis.asyncio as aioredis

REPO = Path(__file__).resolve().parents[4]
APP = REPO / "apps" / "agent-runtime"
DB_NAME = "ai_system_h1_test"
_PG: Any = asyncpg  # asyncpg không kèm kiểu đầy đủ: bọc một chỗ
_REDIS: Any = aioredis.Redis


async def pg_connect(url: str) -> Any:
    return await _PG.connect(url)


def redis_client() -> Any:
    return _REDIS.from_url(redis_url(), decode_responses=True)


# ---------- URL ----------


def _default_host() -> str:
    """Container compose (`scripts/run.ts`): host = tên service; WSL/Linux: localhost."""
    try:
        socket.gethostbyname("postgres")
        return "postgres"
    except OSError:
        return "localhost"


def _with(url: str, user: str, password: str, db: str | None = None) -> str:
    u = urlsplit(url)
    host = u.hostname or "localhost"
    netloc = f"{user}:{password}@{host}:{u.port or 5432}"
    return urlunsplit((u.scheme, netloc, f"/{db}" if db else u.path, u.query, u.fragment))


def rt_db_url() -> str:
    """Role `agent_runtime` trên DB test H1 (mật khẩu dev ở `migrations-hub-dev`)."""
    env = os.environ.get("AGENT_RT_TEST_DATABASE_URL")
    if env:
        return env
    host = _default_host()
    return f"postgres://agent_runtime:agent_runtime_dev_pw@{host}:5432/{DB_NAME}"


def owner_db_url() -> str:
    env = os.environ.get("HUB_TEST_DATABASE_URL")
    return env or _with(rt_db_url(), "ai", "ai_dev_pw")


def redis_url() -> str:
    env = os.environ.get("AGENT_RT_TEST_REDIS_URL")
    return env or f"redis://{'redis' if _default_host() == 'postgres' else 'localhost'}:6379/15"


# ---------- schema ----------

_MIGRATION_DIRS = ("migrations", "migrations-dev", "migrations-hub", "migrations-hub-dev")


def _statements(folder: Path) -> list[str]:
    journal = json.loads((folder / "meta" / "_journal.json").read_text(encoding="utf-8"))
    out: list[str] = []
    for entry in journal["entries"]:
        text = (folder / f"{entry['tag']}.sql").read_text(encoding="utf-8")
        out += [s for s in text.split("--> statement-breakpoint") if s.strip()]
    return out


async def ensure_schema() -> None:
    """Tạo DB nếu thiếu; chưa có `hub.jobs` → chạy SQL migration như `appEnv=test`.

    Không ghi bảng drizzle: `resetTestDb` (TS) xoá cả schema `drizzle`, lần TS sau migrate sạch.
    """
    owner = owner_db_url()
    name = urlsplit(owner).path.lstrip("/")
    admin = await pg_connect(_with(owner, "ai", "ai_dev_pw", "postgres"))
    try:
        if not await admin.fetchval("select 1 from pg_database where datname = $1", name):
            await admin.execute(f'CREATE DATABASE "{name}"')
    finally:
        await admin.close()
    conn = await pg_connect(owner)
    try:
        if await conn.fetchval("select to_regclass('hub.jobs') is not null"):
            return
        for d in _MIGRATION_DIRS:
            for stmt in _statements(REPO / "packages" / "db" / d):
                await conn.execute(stmt)
    finally:
        await conn.close()


# ---------- dữ liệu ----------

ACME = "b2000000-0000-4000-8000-000000000001"
BETA = "b2000000-0000-4000-8000-000000000002"
USER = "b2000000-0000-4000-8000-000000000011"
AGENT_A = "b2000000-0000-4000-8000-000000000021"
AGENT_B = "b2000000-0000-4000-8000-000000000022"
ORCH = "b2000000-0000-4000-8000-000000000020"
FAKE = "fake-cli"
CLEAN_SQL = (
    "delete from hub.jobs",
    "delete from hub.cli_sessions",
    "delete from hub.provider_state",
    "delete from hub.usage_logs where job_id is not null",
    "delete from hub.agent_types",
    "delete from hub.conversations where tenant_id in ($1::uuid, $2::uuid)",
)


async def reset_data(conn: Any, acme_limit: int | None = 1, fake_slots: int = 2) -> None:
    for q in CLEAN_SQL:
        await (conn.execute(q, ACME, BETA) if "$1" in q else conn.execute(q))
    await conn.execute(
        """insert into admin.tenants (id, key, name, active, max_concurrent_sub) values
           ($1, 'qc-acme', 'QC Acme', true, $3), ($2, 'qc-beta', 'QC Beta', true, null)
           on conflict (id) do update
             set max_concurrent_sub = excluded.max_concurrent_sub, active = true""",
        ACME,
        BETA,
        acme_limit,
    )
    await set_provider(conn, FAKE, fake_slots)


async def set_provider(conn: Any, key: str, slots: int) -> None:
    vendor = "fake" if key == FAKE else "anthropic"
    await conn.execute(
        """insert into hub.providers (key, kind, vendor, max_concurrency, enabled, dev_only)
           values ($1, 'subscription', $2, $3, true, $4)
           on conflict (key) do update
             set kind = 'subscription', max_concurrency = $3, enabled = true""",
        key,
        vendor,
        slots,
        key == FAKE,
    )


@dataclass(frozen=True)
class Job:
    id: str
    run_id: str
    step_id: str
    tenant_id: str
    conversation_id: str
    agent_id: str
    payload: dict[str, Any]


async def new_conversation(conn: Any, tenant: str) -> tuple[str, str]:
    conv = str(uuid.uuid4())
    await conn.execute(
        """insert into hub.conversations (id, tenant_id, user_id, title, title_norm)
           values ($1, $2, $3, 'qc', 'qc')""",
        conv,
        tenant,
        USER,
    )
    return conv, await new_flow(conn, tenant, conv)


async def new_flow(conn: Any, tenant: str, conv: str) -> str:
    """Mỗi job một flow: `runs_flow_running_uq` cho phép 1 run `running` / flow."""
    flow = str(uuid.uuid4())
    await conn.execute(
        """insert into hub.flows (id, tenant_id, user_id, conversation_id, title, message_count)
           values ($1, $2, $3, $4, 'qc', 0)""",
        flow,
        tenant,
        USER,
        conv,
    )
    return flow


@dataclass
class JobSpec:
    prompt: str = "xin chào"
    tenant: str = ACME
    output: str = "agent_result"
    agent_id: str = AGENT_A
    conv: tuple[str, str] | None = None
    use_session: bool = False
    timeout_s: int = 600
    allowed_tools: list[str] = field(default_factory=lambda: ["Read", "Grep", "Glob"])
    history: list[dict[str, str]] = field(default_factory=list[dict[str, str]])
    provider: str = FAKE
    notify: bool = True
    cancel: bool = False


def build_payload(spec: JobSpec, ids: dict[str, str]) -> dict[str, Any]:
    """`JobPayload` hợp contract (`packages/contracts/src/hub/job.ts` `AgentCliJobSchema`)."""
    orch = spec.output == "text"
    return {
        "v": 1,
        "type": "agent.cli",
        "runtime": "agentic-cli",
        **ids,
        "tenant_id": spec.tenant,
        "user_id": USER,
        "feature_id": None,
        "agent_type_key": None,
        "mcp": None,
        "agent": {
            "id": spec.agent_id,
            "key": "orchestrator" if orch else "assistant",
            "role": "orchestrator" if orch else "agent",
        },
        "provider_key": spec.provider,
        "model": None,
        "step_index": 0,
        "max_turns": 3 if orch else 30,
        "profile_steps": [{"provider_key": spec.provider, "model": None, "on": []}],
        "system_prompt": "",
        "prompt": spec.prompt,
        "history": spec.history,
        "use_session": spec.use_session,
        "allowed_tools": [] if orch else spec.allowed_tools,
        "output": spec.output,
        "timeout_s": spec.timeout_s,
    }


async def add_job(conn: Any, spec: JobSpec) -> Job:
    """Như Hub (plan §5.3): INSERT `runs` + `jobs`, NOTIFY `job_enqueued` cùng transaction."""
    if spec.conv:
        conv, flow = spec.conv[0], await new_flow(conn, spec.tenant, spec.conv[0])
    else:
        conv, flow = await new_conversation(conn, spec.tenant)
    ids = {
        "job_id": str(uuid.uuid4()),
        "run_id": str(uuid.uuid4()),
        "step_id": str(uuid.uuid4()),
        "conversation_id": conv,
        "flow_id": flow,
    }
    payload = build_payload(spec, ids)
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
                 agent_id, type, provider_key, payload, cancel_requested_at)
               values ($1, $2, $3, $4, $5, $6, $7, 'agent.cli', $8, $9::jsonb,
                 case when $10 then now() end)""",
            ids["job_id"],
            spec.tenant,
            USER,
            ids["run_id"],
            ids["step_id"],
            conv,
            spec.agent_id,
            spec.provider,
            json.dumps(payload),
            spec.cancel,
        )
        if spec.notify:
            note = {"v": 1, "job_id": ids["job_id"], "provider_key": spec.provider}
            await conn.execute("select pg_notify('job_enqueued', $1)", json.dumps(note))
    return Job(
        ids["job_id"], ids["run_id"], ids["step_id"], spec.tenant, conv, spec.agent_id, payload
    )


async def cancel_job(conn: Any, job: Job, notify: bool = True) -> None:
    """Như Hub E15 (plan §2.5): cờ `cancel_requested_at` + NOTIFY `job_cancel`."""
    async with conn.transaction():
        await conn.execute("update hub.jobs set cancel_requested_at = now() where id = $1", job.id)
        if notify:
            note = {"v": 1, "job_id": job.id, "run_id": job.run_id}
            await conn.execute("select pg_notify('job_cancel', $1)", json.dumps(note))


async def job_row(conn: Any, job: Job) -> dict[str, Any]:
    row = await conn.fetchrow("select * from hub.jobs where id = $1", job.id)
    assert row is not None, f"mất job {job.id}"
    return dict(row)


# ---------- Redis ----------


async def events(rd: Any, run_id: str) -> list[dict[str, Any]]:
    """`XRANGE run:<run_id>` field `e` → `RunEvent` (JSON)."""
    items = await rd.xrange(f"run:{run_id}")
    return [json.loads(fields["e"]) for _id, fields in items]


def terminal(evs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [e for e in evs if e.get("type") in ("job.result", "job.failed")]


# ---------- /proc ----------


def _stat(pid: int) -> tuple[str, int] | None:
    try:
        raw = Path(f"/proc/{pid}/stat").read_text()
    except OSError:
        return None
    rest = raw[raw.rfind(")") + 2 :].split()
    return rest[0], int(rest[2])


def group_pids(pgid: int) -> list[int]:
    """Pid còn sống (không tính zombie) có `pgrp == pgid` (plan-runtime §2.3 bước 6)."""
    out: list[int] = []
    for p in Path("/proc").iterdir():
        if p.name.isdigit():
            st = _stat(int(p.name))
            if st and st[1] == pgid and st[0] != "Z":
                out.append(int(p.name))
    return out


def cmdline(pid: int) -> str:
    try:
        return Path(f"/proc/{pid}/cmdline").read_bytes().replace(b"\0", b" ").decode()
    except OSError:
        return ""


def proc_environ(pid: int) -> dict[str, str]:
    raw = Path(f"/proc/{pid}/environ").read_bytes().decode(errors="replace")
    pairs = [kv.split("=", 1) for kv in raw.split("\0") if "=" in kv]
    return {k: v for k, v in pairs}


# ---------- chờ theo điều kiện ----------


class RuntimeDied(AssertionError):
    pass


async def wait_until[T](
    cond: Callable[[], Awaitable[T | None]],
    limit_s: float,
    what: str,
    alive: Callable[[], str | None] | None = None,
) -> T:
    """Lặp 50 ms tới khi `cond` trả giá trị truthy; hết giờ → AssertionError (đỏ ở `expect`)."""
    deadline = time.monotonic() + limit_s
    while True:
        got = await cond()
        if got:
            return got
        if alive is not None and (dead := alive()):
            raise RuntimeDied(f"chờ {what}: {dead}")
        if time.monotonic() > deadline:
            raise AssertionError(f"quá {limit_s} s chưa thấy: {what}")
        await asyncio.sleep(0.05)


def result_of(row: dict[str, Any]) -> dict[str, Any]:
    """`jobs.result` = `JobOutput` (`{kind:"agent_result",result}` / `{kind:"text",text}`)."""
    res = row["result"]
    assert res is not None, f"job {row['id']} chưa có result"
    return json.loads(res) if isinstance(res, str) else res


def agent_text(row: dict[str, Any]) -> str:
    out = result_of(row)
    assert out["kind"] == "agent_result", out
    return str(out["result"].get("text", ""))
