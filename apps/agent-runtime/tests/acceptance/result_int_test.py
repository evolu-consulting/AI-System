"""WRK-FR-03 · WRK-FR-27 · HUB-H1-AC-10 · H1-R08 · P26–P28, P38, P39: kết quả có cấu trúc + sự kiện.

Kết quả `done/partial/need_input` (`AgentResult`), JSON hỏng → retry 1 lần → `UPSTREAM_ERROR
invalid_output` (plan-runtime §4), `RunEvent` ở `run:<run_id>` (plan-db §5.4 "XADD").
"""

from __future__ import annotations

from typing import Any

import pytest

from tests.acceptance._rt import BETA, Job, events, job_row, result_of, wait_until
from tests.acceptance.conftest import Ctx

pytestmark = pytest.mark.int

BASE_KEYS = {"v", "job_id", "seq", "at", "type"}
EVENT_KEYS = {
    "job.started": BASE_KEYS | {"worker_id", "provider_key"},
    "job.progress": BASE_KEYS | {"message", "percent"},
    "job.result": BASE_KEYS | {"output", "usage", "session_resumed"},
    "job.failed": BASE_KEYS | {"status", "code", "reason", "message", "usage"},
}


async def test_hub_h1_ac_10_badjson_once_recovers(ctx: Ctx) -> None:
    """AC-10 · `#fake:badjson=1` (agent) → thử lại 1 lần trong job → `succeeded`, `attempts=1`."""
    job = await ctx.job(tenant=BETA, prompt="#fake:badjson=1")
    ctx.runtime()
    row = await ctx.until_status(job, ["succeeded"], 15)
    assert row["attempts"] == 1
    assert result_of(row)["result"]["status"] == "done"


async def test_hub_h1_ac_10_badjson_twice_invalid_output(ctx: Ctx) -> None:
    """AC-10 · `#fake:badjson=2` → `failed` `UPSTREAM_ERROR` `invalid_output`; 1 `job.failed`."""
    job = await ctx.job(tenant=BETA, prompt="#fake:badjson=2")
    ctx.runtime()
    row = await ctx.until_status(job, ["failed"], 15)
    assert (row["error_code"], row["error_reason"]) == ("UPSTREAM_ERROR", "invalid_output")
    term = [e for e in await ctx.evs(job) if e["type"] in ("job.failed", "job.result")]
    assert [(e["type"], e["code"], e["reason"]) for e in term] == [
        ("job.failed", "UPSTREAM_ERROR", "invalid_output")
    ]


async def test_wrk_text_output_verbatim(ctx: Ctx) -> None:
    """§4 · `output=text` → `{kind:"text", text}` nguyên văn `result` (không bóc JSON)."""
    job = await ctx.job(tenant=BETA, output="text", prompt='<message>chào {"a":1}</message>')
    ctx.runtime()
    out = result_of(await ctx.until_status(job, ["succeeded"], 15))
    assert out["kind"] == "text"
    assert str(out["text"]).startswith('echo: chào {"a":1} ')


@pytest.mark.parametrize(
    ("directive", "status", "fields"),
    [
        ("#fake:partial", "partial", {"text", "missing"}),
        ("#fake:need_input", "need_input", {"question", "choices"}),
    ],
)
async def test_wrk_fr_27_partial_need_input(
    ctx: Ctx, directive: str, status: str, fields: set[str]
) -> None:
    """FR-27 · `partial`/`need_input` hợp `AgentResult` (strict: đúng tập khoá, chuỗi không rỗng;
    `need_input.choices` = ["A","B"])."""
    job = await ctx.job(tenant=BETA, prompt=f"{directive} hỏi thêm")
    ctx.runtime()
    res = result_of(await ctx.until_status(job, ["succeeded"], 15))["result"]
    assert res["status"] == status
    assert set(res) == fields | {"status"}
    if status == "partial":
        assert res["text"] and res["missing"]
    else:
        assert res["question"] and res["choices"] == ["A", "B"]


async def until_terminal(ctx: Ctx, job: Job) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Đọc stream tới khi có sự kiện kết thúc; đọc DB **ngay sau** đó (DB phải xong trước XADD)."""

    async def cond() -> list[dict[str, Any]] | None:
        evs = await events(ctx.rd, job.run_id)
        return evs if any(e["type"] in ("job.result", "job.failed") for e in evs) else None

    evs = await wait_until(cond, 20, f"sự kiện kết thúc của {job.id}", ctx.alive)
    return evs, await job_row(ctx.conn, job)


def check_shape(e: dict[str, Any], job: Job) -> None:
    assert set(e) == EVENT_KEYS[e["type"]], e
    assert (e["v"], e["job_id"]) == (1, job.id)
    assert isinstance(e["at"], str) and "T" in e["at"]


async def test_wrk_fr_03_event_sequence(ctx: Ctx) -> None:
    """FR-03 · `job.started` → `job.progress` → đúng 1 kết thúc; đúng khoá `RunEvent`; `seq` 1..n
    liên
    tục; TTL `run:<id>` ~86 400 s; `jobs` đã kết thúc trước khi sự kiện kết thúc xuất hiện."""
    job = await ctx.job(tenant=BETA, prompt="#fake:sleep=2 #fake:usage=3,4")
    ctx.runtime()
    evs, row = await until_terminal(ctx, job)
    assert row["status"] == "succeeded"
    types = [e["type"] for e in evs]
    assert types[0] == "job.started" and "job.progress" in types
    assert types[-1] == "job.result" and types.count("job.result") == 1
    assert "job.failed" not in types
    assert [e["seq"] for e in evs] == list(range(1, len(evs) + 1))
    for e in evs:
        check_shape(e, job)
    assert evs[-1]["usage"] == {"input_tokens": 3, "output_tokens": 4}
    assert 86_000 <= await ctx.rd.ttl(f"run:{job.run_id}") <= 86_400


async def test_hub_h1_r08_progress_no_path_or_prompt(ctx: Ctx) -> None:
    """R8 · `progress.message` không chứa đường dẫn (`/`, `work/`) hay nội dung prompt."""
    mark = "PROMPT-MARK-91"
    job = await ctx.job(tenant=BETA, prompt=f"#fake:sleep=2 {mark}")
    ctx.runtime()
    evs, _ = await until_terminal(ctx, job)
    msgs = [str(e["message"]) for e in evs if e["type"] == "job.progress"]
    assert msgs
    for m in msgs:
        assert mark not in m and "/" not in m and str(ctx.box.work) not in m
