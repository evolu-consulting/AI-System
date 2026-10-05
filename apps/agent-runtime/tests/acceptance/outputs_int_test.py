"""WRK-FR-18 · WRK-BR-07 · HUB-FR-12 · HUB-H2c-AC-10 (vế Runtime) · HUB-H2c-AC-12 · H2c-R24, R25 ·
PL9 · P38, P40–P51 (test-plan-py §2.2): job agent ghi `work/<job_id>/out/` → Runtime gửi từng
file `POST /internal/jobs/:id/outputs` (mock `_hub_files.py`) **trước** `FinishTx` (job còn
`running`), id trả về vào `job.result.outputs` (khoá chỉ khi ≠ ∅); bỏ symlink/rỗng/quá cỡ/quá 5;
415/409 bỏ, 401 ngừng, 503 thử lại; không gửi khi `need_input`/lỗi/huỷ/Orchestrator; thiếu
`AGENT_RT_HUB_URL` ⇒ `warn`. Hook `Write` thật chỉ cho ghi trực tiếp trong `out/` (PL9,
`#fake:write`). `workflow.async` có input file ⇒ Runtime gửi nguyên `inputs`, không tự upload
(F12).

Nguồn: `plan-runtime` H2c §4–§6, §9 F7–F12, F16; `#fake:out*`/`#fake:write` (PY-04), `send_outputs`
trong `_close` + hook `Write` (PY-03).
"""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Any

import pytest

from tests.acceptance._dify import DifySpec, dify_env, log_events
from tests.acceptance._hub_files import FilesEnv, digest, files_env, listing, mode_of, token_hash
from tests.acceptance._rt import ORCH, Job, agent_text, cancel_job, terminal, wait_until
from tests.acceptance._stream import finished, orch_prompt
from tests.acceptance.conftest import Ctx

pytestmark = pytest.mark.int

ATTACH_MAX = 20_971_520
WRITE_TOOLS = ["Read", "Write"]


def result_event(evs: list[dict[str, Any]]) -> dict[str, Any]:
    ends = terminal(evs)
    assert [e["type"] for e in ends] == ["job.result"], ends
    return ends[0]


def sent_ids(e: FilesEnv, job: Job) -> list[str]:
    return [c.out_id for c in e.mock.posts(job) if c.out_id]


async def run_agent(
    e: FilesEnv, prompt: str, *, hub: bool = True, **kw: Any
) -> tuple[Job, dict[str, Any], list[dict[str, Any]]]:
    job = await e.job(prompt, **kw)
    e.runtime(hub=hub)
    row, evs = await finished(e.ctx, job, 40)
    return job, row, evs


def absent(p: Path) -> bool:
    return not p.is_symlink() and not p.exists()


def skipped_whys(e: FilesEnv) -> list[str]:
    return [str(x.get("why")) for x in log_events(e.logs(), "job.output_skipped")]


# ---------- P38 · workflow.async có input file ----------


async def test_hub_h2c_ac_10_p38_async_file_inputs_passthrough(ctx: Ctx) -> None:
    """P38 · AC-10 (Runtime) · F12 · `inputs.file = {type:"document", transfer_method:"local_file",
    upload_file_id:"u1"}` → `/v1/workflows/run` nhận `inputs` nguyên văn; 0 `/v1/files/upload`."""
    file_in = {"type": "document", "transfer_method": "local_file", "upload_file_id": "u1"}
    inputs: dict[str, Any] = {"file": file_in, "note": "kiểm tra"}
    async with dify_env(ctx) as d:
        job = await d.job(DifySpec(inputs=inputs))
        d.runtime()
        row = await ctx.until_status(job, ["succeeded"], 30)
        assert row["status"] == "succeeded"
        [run] = d.runs()
        assert run.body["inputs"] == inputs
        assert d.mock.calls("/v1/files/upload") == []


# ---------- P40–P42 · gửi một file ----------


async def test_wrk_fr_18_p40_out_file_posted(ctx: Ctx) -> None:
    """P40 · R25 · F8 · `#fake:out=report.md` → 1 POST: `X-Filename: report.md`, `Content-Type:
    application/octet-stream`, `Content-Length: 22`, thân `fake output report.md\\n`, Bearer token
    job; `job.result.outputs == [id mock]`."""
    async with files_env(ctx) as e:
        job, row, evs = await run_agent(e, "#fake:out=report.md viết báo cáo")
        assert row["status"] == "succeeded"
        posts = e.mock.posts(job)
        assert len(posts) == 1, f"POST /outputs: {len(posts)}"
        p = posts[0]
        assert p.headers.get("x-filename") == "report.md"
        assert p.headers.get("content-type") == "application/octet-stream"
        assert p.headers.get("content-length") == "22"
        assert p.body == b"fake output report.md\n"
        assert digest(p.bearer) == await token_hash(ctx, job)
        assert result_event(evs).get("outputs") == [p.out_id]


async def test_wrk_fr_18_p41_outputs_before_finish(ctx: Ctx) -> None:
    """P41 · F9 · `hold-800-r.md` (mock giữ 800 ms) → trong lúc giữ `jobs.status='running'` và
    `run:<id>` chưa có `job.result`; sau đó `job.result.outputs` có id."""
    async with files_env(ctx) as e:
        job = await e.job("#fake:out=hold-800-r.md")
        e.runtime()

        async def posted() -> bool:
            return bool(e.mock.posts(job))

        await wait_until(posted, 30, f"POST /outputs của {job.id}", ctx.alive)
        row = await ctx.conn.fetchrow("select status from hub.jobs where id = $1", job.id)
        assert row["status"] == "running"
        assert terminal(await ctx.evs(job)) == []
        row2, evs = await finished(ctx, job)
        assert row2["status"] == "succeeded"
        assert result_event(evs).get("outputs") == sent_ids(e, job)


async def test_wrk_fr_18_p42_non_ascii_name_pct(ctx: Ctx) -> None:
    """P42 · `Báo-cáo.md` → `X-Filename` = `filename_header` (pct UTF-8 `B%C3%A1o-c%C3%A1o.md`).
    (Tên có khoảng trắng không truyền được qua chỉ thị `#fake:out` — `\\S+`.)"""
    async with files_env(ctx) as e:
        job, _, _ = await run_agent(e, "#fake:out=Báo-cáo.md")
        assert [c.headers.get("x-filename") for c in e.mock.posts(job)] == ["B%C3%A1o-c%C3%A1o.md"]


# ---------- P43–P46 · chọn file, phản hồi Hub ----------


async def test_hub_h2c_ac_12_p43_six_files_five_sent(ctx: Ctx) -> None:
    """P43 · AC-12 · 6 tên `a.md…f.md` → 5 POST (`a…e`), `outputs` 5 id, `over_limit` × 1."""
    async with files_env(ctx) as e:
        job, row, evs = await run_agent(e, "#fake:out=a.md,b.md,c.md,d.md,e.md,f.md")
        assert row["status"] == "succeeded"
        assert [c.filename for c in e.mock.posts(job)] == ["a.md", "b.md", "c.md", "d.md", "e.md"]
        assert result_event(evs).get("outputs") == sent_ids(e, job)
        assert len(sent_ids(e, job)) == 5
        assert skipped_whys(e).count("over_limit") == 1


async def test_hub_h2c_ac_12_p44_symlink_skipped(ctx: Ctx) -> None:
    """P44 · AC-12 · `#fake:out-link=x.md` + `#fake:out=y.md` → chỉ `y.md` gửi; `symlink` bị bỏ."""
    async with files_env(ctx) as e:
        job, row, evs = await run_agent(e, "#fake:out-link=x.md #fake:out=y.md")
        assert row["status"] == "succeeded"
        assert [c.filename for c in e.mock.posts(job)] == ["y.md"]
        assert result_event(evs).get("outputs") == sent_ids(e, job)
        assert "symlink" in skipped_whys(e)


@pytest.mark.parametrize(
    ("names", "statuses", "kept"),
    [
        ("x.exe,quota-1.md,ok.md", [201, 409, 415], ["ok.md"]),
        ("a.md,deny-1.md,z.md", [201, 401], ["a.md"]),
        ("flaky-1.md", [503, 201], ["flaky-1.md"]),
    ],
    ids=["415-409-skip", "401-stop", "503-retry"],
)
async def test_hub_h2c_ac_12_p45_hub_status_handling(
    ctx: Ctx, names: str, statuses: list[int], kept: list[str]
) -> None:
    """P45 · AC-12 · 415/409 → bỏ file; 401 → ngừng gửi phần còn lại; 503 một lần → gửi lại; job
    luôn `succeeded`, `outputs` chỉ file 201."""
    async with files_env(ctx) as e:
        job, row, evs = await run_agent(e, f"#fake:out={names}")
        assert row["status"] == "succeeded"
        posts = e.mock.posts(job)
        assert [c.status for c in posts] == statuses
        assert [c.filename for c in posts if c.status == 201] == kept
        assert result_event(evs).get("outputs") == sent_ids(e, job)


@pytest.mark.parametrize(
    ("size", "why"),
    [(0, "empty"), (ATTACH_MAX + 1, "too_large"), (ATTACH_MAX, None)],
    ids=["empty", "too-large", "max"],
)
async def test_hub_h2c_ac_12_p46_size_limits(ctx: Ctx, size: int, why: str | None) -> None:
    """P46 · `out-size=0` → `empty`, không POST, không khoá `outputs`; `20971521` → `too_large`;
    đúng `20971520` → POST (`Content-Length` = 20971520)."""
    async with files_env(ctx) as e:
        job, row, evs = await run_agent(e, f"#fake:out=e.md #fake:out-size={size}")
        assert row["status"] == "succeeded"
        posts = e.mock.posts(job)
        if why is None:
            assert [(c.headers.get("content-length"), len(c.body)) for c in posts] == [
                (str(ATTACH_MAX), ATTACH_MAX)
            ]
            assert result_event(evs).get("outputs") == sent_ids(e, job)
        else:
            assert posts == []
            assert "outputs" not in result_event(evs)
            assert skipped_whys(e) == [why]


# ---------- P47–P50 · khi nào gửi ----------


async def test_wrk_fr_18_p47_orchestrator_no_out_dir(ctx: Ctx) -> None:
    """P47 · R24 · job Orchestrator → không tạo `out/`, không POST."""
    async with files_env(ctx) as e:
        job, row, _ = await run_agent(e, orch_prompt("xin chào P47"), output="text", agent_id=ORCH)
        assert row["status"] == "succeeded"
        assert not (e.work(job) / "out").exists()
        assert e.mock.calls() == []


async def test_wrk_fr_18_p47_agent_out_dir_before_cli(ctx: Ctx) -> None:
    """P47 · R24 · job agent → `out/` 0700 có trước khi CLI chạy xong (đang `#fake:sleep`)."""
    async with files_env(ctx) as e:
        job = await e.job("#fake:sleep=3")
        e.runtime()
        await ctx.until_running(job)
        out = e.work(job) / "out"

        async def ready() -> bool:
            return out.is_dir()

        await wait_until(ready, 5, "out/ tồn tại", ctx.alive)
        assert mode_of(out) == 0o700
        row, _ = await finished(ctx, job)
        assert row["status"] == "succeeded"


@pytest.mark.parametrize(
    ("prompt", "status"),
    [
        ("#fake:need_input #fake:out=a.md", "succeeded"),
        ("#fake:badjson=3 #fake:out=a.md", "failed"),
        ("#fake:out=a.md #fake:sleep=20", "cancelled"),
    ],
    ids=["need-input", "failed", "cancelled"],
)
async def test_wrk_fr_18_p48_no_send_unless_done(ctx: Ctx, prompt: str, status: str) -> None:
    """P48 · R25 (`wants_outputs`) · `need_input` / job `failed` / huỷ khi đang chạy → 0 POST."""
    async with files_env(ctx) as e:
        job = await e.job(prompt)
        e.runtime()
        if status == "cancelled":
            await ctx.until_running(job)
            await cancel_job(ctx.conn, job)
        row, _ = await finished(ctx, job, 40)
        assert row["status"] == status
        assert e.mock.posts() == []


async def test_wrk_fr_18_p49_no_hub_url_warn(ctx: Ctx) -> None:
    """P49 · F13 · thiếu `AGENT_RT_HUB_URL` + file `out/` → `warn job.outputs_skipped{reason:
    "no_hub_url"}`, job `succeeded`, không khoá `outputs`."""
    async with files_env(ctx) as e:
        job, row, evs = await run_agent(e, "#fake:out=a.md", hub=False)
        assert row["status"] == "succeeded"
        assert "outputs" not in result_event(evs)
        warns = log_events(e.logs(), "job.outputs_skipped")
        assert [(w.get("reason"), w.get("level")) for w in warns] == [("no_hub_url", "warning")]
        assert (e.work(job) / "out" / "a.md").exists()


async def test_wrk_fr_18_p50_no_out_files_like_h2b(ctx: Ctx) -> None:
    """P50 · F10 · không file `out/` → `job.result` **không** khoá `outputs` (như H2b), 0 POST."""
    async with files_env(ctx) as e:
        job, row, evs = await run_agent(e, "không ghi gì")
        assert row["status"] == "succeeded"
        assert "outputs" not in result_event(evs)
        assert e.mock.calls() == []
        assert listing(e.work(job) / "out") == []


async def test_wrk_fr_18_p50_outputs_log_without_names(ctx: Ctx) -> None:
    """P50 · log `job.outputs{sent, skipped, ms}` có, không dòng log nào chứa tên file `out/`."""
    async with files_env(ctx) as e:
        secret = "bi-mat-p50.md"
        job, row, _ = await run_agent(e, f"#fake:out={secret},{secret}.exe")
        assert row["status"] == "succeeded"
        assert len(e.mock.posts(job)) == 2
        logs = log_events(e.logs(), "job.outputs")
        assert [x.get("sent") for x in logs] == [1]
        assert secret not in e.logs()


# ---------- P51 · hook `Write` (PL9) ----------


async def test_wrk_br_07_p51_write_in_out_allowed_then_sent(ctx: Ctx) -> None:
    """P51 · PL9 · `allowed_tools=[Read, Write]` + `#fake:write=out/a.md` → `written`, rồi `a.md`
    được POST (`outputs` 1 id)."""
    async with files_env(ctx) as e:
        job, row, evs = await run_agent(e, "#fake:write=out/a.md", allowed_tools=WRITE_TOOLS)
        assert agent_text(row) == "written"
        assert (e.work(job) / "out" / "a.md").read_text() == "fake write\n"
        assert [c.filename for c in e.mock.posts(job)] == ["a.md"]
        assert result_event(evs).get("outputs") == sent_ids(e, job)


TMP_TARGET = f"/tmp/qc-p51-{uuid.uuid4().hex}.md"


@pytest.mark.parametrize(
    "target",
    ["attachments/x.md", "a.md", "out/sub/a.md", "../x.md", TMP_TARGET],
    ids=["attachments", "work-root", "out-sub", "dotdot", "abs-tmp"],
)
async def test_wrk_br_07_p51_write_outside_out_denied(ctx: Ctx, target: str) -> None:
    """P51 · PL9 · `Write` ngoài `out/` trực tiếp (`attachments/`, gốc `work/<job_id>`, `out/sub/`,
    `../`, tuyệt đối) → `denied:path_not_allowed`, không file nào được tạo, 0 POST."""
    async with files_env(ctx) as e:
        job, row, _ = await run_agent(e, f"#fake:write={target}", allowed_tools=WRITE_TOOLS)
        assert agent_text(row) == "denied:path_not_allowed"
        assert absent(Path(e.work(job), target))
        assert e.mock.posts(job) == []


async def test_wrk_br_07_p51_write_through_symlink_denied(ctx: Ctx) -> None:
    """P51 · PL9 · `out/l.md` là symlink → `<tmp>/victim` (đặt trong lúc `#fake:sleep`) +
    `#fake:write=out/l.md` → `denied:path_not_allowed` (realpath ngoài), `victim` nguyên."""
    async with files_env(ctx) as e:
        victim = ctx.box.root / "victim"
        victim.write_text("nạn nhân")
        job = await e.job("#fake:sleep=3 #fake:write=out/l.md", allowed_tools=WRITE_TOOLS)
        e.runtime()
        await ctx.until_running(job)
        out = e.work(job) / "out"

        async def ready() -> bool:
            return out.is_dir()

        await wait_until(ready, 5, "out/ tồn tại", ctx.alive)
        (out / "l.md").symlink_to(victim)
        row, _ = await finished(ctx, job)
        assert agent_text(row) == "denied:path_not_allowed"
        assert victim.read_text() == "nạn nhân"
        assert e.mock.posts(job) == []


async def test_wrk_br_07_p51_write_tool_not_allowed(ctx: Ctx) -> None:
    """P51 · `allowed_tools=[Read, Grep]` + `#fake:write=out/a.md` → `denied:tool_not_allowed`."""
    async with files_env(ctx) as e:
        job, row, _ = await run_agent(e, "#fake:write=out/a.md", allowed_tools=["Read", "Grep"])
        assert agent_text(row) == "denied:tool_not_allowed"
        assert not (e.work(job) / "out" / "a.md").exists()
        assert e.mock.posts(job) == []
