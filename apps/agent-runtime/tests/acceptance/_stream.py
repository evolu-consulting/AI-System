"""WRK-FR-03 · WRK-FR-15 · WRK-FR-17 · hạ tầng test P H2b (QW-P, test-plan-py §2): job `agent.cli`
có `payload.stream`, đọc `job.delta` từ Redis `run:<id>`, đếm đơn vị UTF-16, đọc `usage_logs` và log
Runtime. Không chứa test.

Bọc `build_payload`/`add_job` của `_rt.py` (khoá, không sửa): chèn job **không** NOTIFY trong một
transaction ngoài, vá `payload.stream` rồi NOTIFY — Runtime chỉ thấy job đã đủ khoá.
`stream` = None ⇒ payload không có khoá `stream` (như job H1/H2a; contract C2 `.optional()`).
"""

from __future__ import annotations

import dataclasses
import json
from typing import Any

from tests.acceptance._rt import Job, JobSpec, add_job, result_of, wait_until
from tests.acceptance.conftest import Ctx

DELTA_MAX_UNITS = 4000  # `JOB_DELTA_TEXT_MAX` (C2); Runtime cắt theo UTF-16 (`split_utf16`, BC6)
TERMINAL = ("job.result", "job.failed")
ENDED = ("succeeded", "failed", "cancelled", "timed_out")


async def add_stream_job(conn: Any, spec: JobSpec, stream: bool | None) -> Job:
    """Như `add_job` + `payload.stream` (Hub B9 `streamAccept`); NOTIFY sau khi vá payload."""
    async with conn.transaction():
        job = await add_job(conn, dataclasses.replace(spec, notify=False))
        payload = dict(job.payload)
        if stream is not None:
            payload["stream"] = stream
            await conn.execute(
                "update hub.jobs set payload = $2::jsonb where id = $1", job.id, json.dumps(payload)
            )
        if spec.notify:
            note = {"v": 1, "job_id": job.id, "provider_key": spec.provider}
            await conn.execute("select pg_notify('job_enqueued', $1)", json.dumps(note))
    return dataclasses.replace(job, payload=payload)


async def stream_job(ctx: Ctx, stream: bool | None = True, **kw: Any) -> Job:
    """Job của ca (teardown dọn như `ctx.job`)."""
    job = await add_stream_job(ctx.conn, JobSpec(**kw), stream)
    ctx.jobs.append(job)
    return job


def orch_prompt(msg: str) -> str:
    """Prompt Orchestrator tối thiểu: `fake-cli` đọc khối `<message>` (chuỗi JSON như Hub)."""
    return f"<message>{json.dumps(msg, ensure_ascii=False)}</message>"


def deltas(evs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [e for e in evs if e.get("type") == "job.delta"]


def joined(evs: list[dict[str, Any]]) -> str:
    return "".join(str(e["text"]) for e in deltas(evs))


def utf16_units(text: str) -> int:
    return len(text.encode("utf-16-le")) // 2


def end_index(evs: list[dict[str, Any]]) -> int:
    """Vị trí sự kiện kết thúc đầu tiên (−1 nếu chưa có)."""
    return next((i for i, e in enumerate(evs) if e.get("type") in TERMINAL), -1)


def decision_text(row: dict[str, Any]) -> str:
    """`job.result` Orchestrator: `{kind:"text", text:<JSON quyết định>}` → `text` của `answer`."""
    out = result_of(row)
    assert out["kind"] == "text", out
    decision = json.loads(out["text"])
    assert decision["decision"] == "answer", decision
    return str(decision["text"])


async def usage_rows(ctx: Ctx, job: Job) -> list[dict[str, Any]]:
    rows = await ctx.conn.fetch("select * from hub.usage_logs where job_id = $1", job.id)
    return [dict(r) for r in rows]


def runtime_logs(ctx: Ctx) -> str:
    """Log JSON của mọi Runtime cha trong ca (stdout) + file log job (`AGENT_RT_LOG_DIR`)."""
    files = [p.read_text(errors="replace") for p in ctx.box.logs.rglob("*") if p.is_file()]
    return "\n".join([rt.stdout() for rt in ctx.runtimes] + files)


async def finished(
    ctx: Ctx, job: Job, limit_s: float = 20.0
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Job kết thúc (bất kể trạng thái — đỏ ở `assert` sau, không ở chờ) + mọi sự kiện của job tới
    sự kiện kết thúc (DB xong trước XADD)."""
    row = await ctx.until_status(job, ENDED, limit_s)

    async def ended() -> list[dict[str, Any]] | None:
        evs = await ctx.evs(job)
        return evs if end_index(evs) >= 0 else None

    return row, await wait_until(ended, 5, f"sự kiện kết thúc của {job.id}", ctx.alive)
