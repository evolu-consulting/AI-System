"""WRK-FR-11 · WRK-BR-06 · WRK-BR-07 · HUB-H2c-AC-08 · H2c-R16, R18, R19 · P20–P32
(test-plan-py §2.1): Runtime thật (`fake-cli`) tải `payload.attachments` từ mock Hub
(`_hub_files.py`) vào `work/<job_id>/attachments/` trước khi chạy provider — sha/size theo
payload, thử lại 5xx theo `backoff` (1 s, 3 s), lỗi ⇒ `failed INTERNAL_ERROR attachment` + xoá
file đã ghi, symlink đặt sẵn, requeue làm mới thư mục, hạn/huỷ/dừng, không file ⇒ như H2b.

Nguồn: `plan-runtime` H2c §2, §3 (PY-02), §6 (`#fake:files` — PY-04), §9 F1–F5, F11, F13, F15.
P25 (gọi thẳng `fetch_attachments`) nằm ở unit `test_files_rules.py` (QW-PU, L4/B9).
"""

from __future__ import annotations

import signal
import sys
import uuid
from typing import Any

import pytest

from tests.acceptance._dify import log_events
from tests.acceptance._hub_files import (
    FilesEnv,
    Served,
    digest,
    files_env,
    files_lines,
    is_real_dir,
    listing,
    mode_of,
    pdf_bytes,
    token_hash,
)
from tests.acceptance._rt import Job, agent_text, cancel_job, wait_until
from tests.acceptance._stream import finished
from tests.acceptance.conftest import Ctx

pytestmark = pytest.mark.int

MiB = 1_048_576


def failure(row: dict[str, Any]) -> tuple[Any, Any, Any]:
    return row["status"], row["error_code"], row["error_reason"]


ATTACH_FAILED = ("failed", "INTERNAL_ERROR", "attachment")


async def expect_attach_failed(e: FilesEnv, job: Job, why: set[str]) -> None:
    """`failed attachment` + `job.failed INTERNAL_ERROR` + `attachments/` rỗng + provider không chạy
    (0 `job.progress`, 0 usage) + log `job.attachment_failed{why}` không lộ tên/token/URL."""
    row, evs = await finished(e.ctx, job, 30)
    assert failure(row) == ATTACH_FAILED
    assert [(x["type"], x["code"]) for x in evs if x["type"] == "job.failed"] == [
        ("job.failed", "INTERNAL_ERROR")
    ]
    assert listing(e.work(job) / "attachments") == []
    assert [x for x in evs if x["type"] == "job.progress"] == []
    used = await e.ctx.conn.fetchval(
        "select count(*) from hub.usage_logs where job_id = $1", job.id
    )
    assert used == 0
    fails = [x for x in log_events(e.logs(), "job.attachment_failed") if x.get("why") in why]
    assert fails, f"thiếu log job.attachment_failed why∈{why}"
    items: list[dict[str, Any]] = job.payload.get("attachments") or []
    secrets = [str(n["name"]) for n in items] + [e.mock.url]
    for f in fails:
        line = str(f)
        for secret in secrets:
            assert secret not in line
        for call in e.mock.gets(job):
            assert call.bearer not in line


# ---------- P20 · tải đúng, thứ tự, auth, quyền ----------


async def test_wrk_fr_11_p20_fetch_two_files_files_directive(ctx: Ctx) -> None:
    """P20 · R16/R19 · 2 file (`a.pdf` 3 KB, `Hoá đơn.pdf`) + `#fake:files` → `done`, text =
    dòng `<tên>:<sha>` sắp theo tên; mock nhận 2 GET tuần tự theo payload, Bearer có
    `sha256(t) = jobs.token_hash`; `attachments/` 0700, file 0400."""
    async with files_env(ctx) as e:
        a = e.mock.add("a.pdf", pdf_bytes(3072, "a"))
        b = e.mock.add("Hoá đơn.pdf", pdf_bytes(5000, "hd"))
        job = await e.job("#fake:files đọc file", [a, b])
        e.runtime()
        row, _ = await finished(ctx, job)
        assert row["status"] == "succeeded"
        gets = e.mock.gets(job)
        assert [c.path.rsplit("/", 1)[1] for c in gets] == [a.id, b.id]
        assert gets[0].done <= gets[1].t, "GET phải tuần tự"
        assert {digest(c.bearer) for c in gets} == {await token_hash(ctx, job)}
        d = e.work(job) / "attachments"
        assert mode_of(d) == 0o700
        assert listing(d) == sorted([a.name, b.name])
        assert {mode_of(d / n) for n in listing(d)} == {0o400}
        assert agent_text(row) == files_lines([a, b])


# ---------- P21–P23 · toàn vẹn ----------


@pytest.mark.parametrize(
    ("mode", "why"),
    [("sha-wrong", "sha_mismatch"), ("short", "size_mismatch"), ("long", "size_mismatch")],
)
async def test_hub_h2c_ac_08_p21_p23_integrity_fails(ctx: Ctx, mode: str, why: str) -> None:
    """P21–P23 · AC-08 · file thứ hai sha sai / thiếu byte / thừa byte → `failed attachment`
    (`why`), `attachments/` rỗng (kể cả file đầu đã tải), provider không chạy."""
    async with files_env(ctx) as e:
        ok = e.mock.add("dau.pdf", pdf_bytes(2048, "ok"))
        bad = e.mock.add("hong.pdf", pdf_bytes(4096, mode), mode=mode)
        job = await e.job("#fake:files", [ok, bad])
        e.runtime()
        await expect_attach_failed(e, job, {why})
        assert len(e.mock.gets_of(ok)) == 1


# ---------- P24 · tên có `..` (F15) ----------


async def test_hub_h2c_ac_08_p24_dotdot_name_invalid_payload(ctx: Ctx) -> None:
    """P24 · AC-08 · F15 · `attachments[0].name = "../x"` (contract cấm) → `failed invalid_payload`
    (H1), 0 GET, không file nào ngoài `work/<job_id>/`."""
    async with files_env(ctx) as e:
        f = e.mock.add("x.pdf", pdf_bytes(1024))
        job = await e.job("#fake:files", [{**f.item(), "name": "../x"}])
        e.runtime()
        row, _ = await finished(ctx, job)
        assert failure(row) == ("failed", "INTERNAL_ERROR", "invalid_payload")
        assert e.mock.gets(job) == []
        assert not (ctx.box.work / "x").exists()
        assert listing(e.work(job) / "attachments") == []


# ---------- P26–P27 · thử lại / không thử lại ----------


async def test_hub_h2c_ac_08_p26_5xx_once_retries_then_done(ctx: Ctx) -> None:
    """P26 · AC-08 · 503 một lần → thử lại sau ≈ 1 s (`backoff(0)`), 2 GET, `done` + sha đúng."""
    async with files_env(ctx) as e:
        f = e.mock.add("a.pdf", pdf_bytes(4096, "flaky"), mode="5xx-once")
        job = await e.job("#fake:files", [f])
        e.runtime()
        row, _ = await finished(ctx, job)
        gets = e.mock.gets_of(f)
        assert [c.status for c in gets] == [503, 200]
        assert gets[1].t - gets[0].t >= 0.9
        assert row["status"] == "succeeded"
        assert agent_text(row) == files_lines([f])


async def test_hub_h2c_ac_08_p26_5xx_always_three_tries_then_failed(ctx: Ctx) -> None:
    """P26 · 503 mãi → 3 GET (1 + 2 thử lại, cách ≈ 1 s rồi ≈ 3 s) → `failed attachment`."""
    async with files_env(ctx) as e:
        f = e.mock.add("a.pdf", pdf_bytes(1024), mode="5xx-always")
        job = await e.job("#fake:files", [f])
        e.runtime()
        await expect_attach_failed(e, job, {"http", "network"})
        ts = [c.t for c in e.mock.gets_of(f)]
        assert len(ts) == 3
        assert ts[1] - ts[0] >= 0.9 and ts[2] - ts[1] >= 2.7


@pytest.mark.parametrize(("mode", "why"), [("401", "unauthorized"), ("404", "not_found")])
async def test_hub_h2c_ac_08_p27_401_404_no_retry(ctx: Ctx, mode: str, why: str) -> None:
    """P27 · 401 → `unauthorized`, 404 → `not_found`: đúng 1 GET (không thử lại)."""
    async with files_env(ctx) as e:
        f = e.mock.add("a.pdf", pdf_bytes(1024), mode=mode)
        job = await e.job("#fake:files", [f])
        e.runtime()
        await expect_attach_failed(e, job, {why})
        assert len(e.mock.gets_of(f)) == 1


# ---------- P28–P29 · symlink đặt sẵn, requeue ----------


async def test_hub_h2c_ac_08_p28_preplaced_symlink_dirs_replaced(ctx: Ctx) -> None:
    """P28 · L4 · `work/<job_id>/{attachments,out}` đặt sẵn là symlink → `<tmp>/outside` (có
    `keep`) → job chạy đúng, `outside/keep` nguyên, `attachments` là thư mục thật."""
    async with files_env(ctx) as e:
        f = e.mock.add("a.pdf", pdf_bytes(2048, "p28"))
        job = await e.job("#fake:files", [f])
        outside = ctx.box.root / "outside"
        outside.mkdir()
        (outside / "keep").write_text("giữ nguyên")
        w = e.work(job)
        w.mkdir(parents=True)
        (w / "attachments").symlink_to(outside, target_is_directory=True)
        (w / "out").symlink_to(outside, target_is_directory=True)
        e.runtime()
        row, _ = await finished(ctx, job)
        assert row["status"] == "succeeded"
        assert listing(outside) == ["keep"]
        assert (outside / "keep").read_text() == "giữ nguyên"
        assert is_real_dir(w / "attachments") and is_real_dir(w / "out")
        assert listing(w / "attachments") == ["a.pdf"]
        assert agent_text(row) == files_lines([f])


async def test_wrk_br_07_p29_requeue_refreshes_dirs(ctx: Ctx) -> None:
    """P29 · R18 · F11 · requeue cùng `job_id`: `attachments/old.txt`, `out/old.md` của lần claim
    trước → sau chạy lại `attachments` chỉ có file payload, `out` không còn `old.md`."""
    async with files_env(ctx) as e:
        f = e.mock.add("a.pdf", pdf_bytes(2048, "p29"))
        job = await e.job("#fake:read=attachments/a.pdf", [f])
        w = e.work(job)
        (w / "attachments").mkdir(parents=True)
        (w / "out").mkdir()
        (w / "attachments" / "old.txt").write_text("cũ")
        (w / "out" / "old.md").write_text("cũ")
        e.runtime()
        row, _ = await finished(ctx, job)
        assert row["status"] == "succeeded"
        assert listing(w / "attachments") == ["a.pdf"]
        assert "old.md" not in listing(w / "out")
        assert agent_text(row) == "read: 2048 chars"


async def test_wrk_br_07_p29_other_job_attachment_denied(ctx: Ctx) -> None:
    """P29 · R18 · AC-07 (vế Runtime) · `#fake:read=../<job khác>/attachments/a.pdf` → `denied`
    (hook `other_job`) — file job khác có thật trên đĩa (đọc của chính job: ca trên)."""
    async with files_env(ctx) as e:
        other = ctx.box.work / str(uuid.uuid4()) / "attachments"
        other.mkdir(parents=True)
        (other / "a.pdf").write_bytes(pdf_bytes(1000, "khac"))
        f = e.mock.add("a.pdf", pdf_bytes(1500, "minh"))
        steal = await e.job(f"#fake:read=../{other.parent.name}/attachments/a.pdf", [f])
        e.runtime()
        row, _ = await finished(ctx, steal)
        assert row["status"] == "succeeded"
        assert agent_text(row) == "denied"


# ---------- P30 · thiếu AGENT_RT_HUB_URL ----------


async def test_wrk_fr_11_p30_no_hub_url(ctx: Ctx) -> None:
    """P30 · F13 · Runtime không `AGENT_RT_HUB_URL` + job có file → `failed attachment`
    (`no_hub_url`), 0 GET; job không file → chạy bình thường."""
    async with files_env(ctx) as e:
        f = e.mock.add("a.pdf", pdf_bytes(1024))
        job = await e.job("#fake:files", [f])
        plain = await e.job("không file")
        e.runtime(hub=False)
        await expect_attach_failed(e, job, {"no_hub_url"})
        assert e.mock.gets() == []
        row, _ = await finished(ctx, plain)
        assert row["status"] == "succeeded"
        assert agent_text(row).startswith("echo: không file")


# ---------- P31 · hạn / huỷ / dừng khi đang tải ----------


async def first_get(e: FilesEnv, job: Job) -> None:
    async def got() -> bool:
        return bool(e.mock.gets(job))

    await wait_until(got, 15, f"GET đầu của {job.id}", e.ctx.alive)


async def test_wrk_fr_11_p31_deadline_while_fetching_timed_out(ctx: Ctx) -> None:
    """P31 · `slow=5000` × 3 file + `timeout_s=10` → `timed_out`; file đã ghi bị xoá."""
    async with files_env(ctx) as e:
        fs = [e.mock.add(f"{c}.pdf", pdf_bytes(1024, c), mode="slow=5000") for c in "abc"]
        job = await e.job("#fake:files", fs, timeout_s=10)
        e.runtime()
        row, evs = await finished(ctx, job, 30)
        assert row["status"] == "timed_out"
        assert [x["type"] for x in evs if x["type"] == "job.failed"] == ["job.failed"]
        assert listing(e.work(job) / "attachments") == []


async def test_wrk_fr_11_p31_cancel_while_fetching(ctx: Ctx) -> None:
    """P31 · huỷ run khi đang tải (`slow=8000`) → `cancelled` ≤ 5 s, `attachments/` rỗng."""
    async with files_env(ctx) as e:
        a = e.mock.add("a.pdf", pdf_bytes(1024, "a"))
        b = e.mock.add("b.pdf", pdf_bytes(1024, "b"), mode="slow=8000")
        job = await e.job("#fake:files", [a, b])
        e.runtime()
        await first_get(e, job)
        await wait_until(lambda: _has(e, b), 10, "GET file chậm", ctx.alive)
        await cancel_job(ctx.conn, job)
        row = await ctx.until_status(job, ["cancelled"], 5)
        assert row["status"] == "cancelled"
        assert listing(e.work(job) / "attachments") == []


async def _has(e: FilesEnv, f: Served) -> bool:
    return bool(e.mock.gets_of(f))


async def test_wrk_fr_11_p31_shutdown_while_fetching(ctx: Ctx) -> None:
    """P31 · SIGTERM Runtime khi đang tải → dừng không ghi kết cục `attachment` (cha ghi
    `orphaned` như H1 §1.5), exit 0, `attachments/` rỗng."""
    async with files_env(ctx) as e:
        f = e.mock.add("a.pdf", pdf_bytes(1024), mode="slow=8000")
        job = await e.job("#fake:files", [f])
        rt = e.runtime()
        await first_get(e, job)
        rt.signal(signal.SIGTERM)
        assert await rt.wait_exit(10) == 0
        row = await ctx.until_status(job, ["failed"], 2, watch=False)
        assert failure(row) == ("failed", "INTERNAL_ERROR", "orphaned")
        assert listing(e.work(job) / "attachments") == []


# ---------- P32 · không file ⇒ như H2b; perf ----------


@pytest.mark.parametrize("files", [None, []], ids=["absent", "empty"])
async def test_wrk_fr_11_p32_no_attachments_like_h2b(ctx: Ctx, files: list[Served] | None) -> None:
    """P32 · F1 · `attachments` vắng / `[]` → 0 GET, không thư mục `attachments`, kết quả như
    H2b."""
    async with files_env(ctx) as e:
        job = await e.job("xin chào P32", files)
        e.runtime()
        row, evs = await finished(ctx, job)
        assert row["status"] == "succeeded"
        assert agent_text(row).startswith("echo: xin chào P32")
        assert e.mock.calls() == []
        assert not (e.work(job) / "attachments").exists()
        assert [x["type"] for x in evs][-1] == "job.result"


async def test_wrk_fr_11_p32_perf_10_x_2mib(ctx: Ctx) -> None:
    """P32 · L10 · 10 × 2 MiB tải + kiểm sha → `succeeded`, đủ file; `ms` (log
    `job.attachments_fetched`) chỉ báo cáo (ngưỡng 2 s không chặn — Q-T3)."""
    async with files_env(ctx) as e:
        fs = [e.mock.add(f"f{i:02}.pdf", pdf_bytes(2 * MiB, str(i))) for i in range(10)]
        job = await e.job("#fake:files", fs, timeout_s=120)
        e.runtime()
        row, _ = await finished(ctx, job, 60)
        assert row["status"] == "succeeded"
        assert listing(e.work(job) / "attachments") == sorted(f.name for f in fs)
        logs = log_events(e.logs(), "job.attachments_fetched")
        assert [(x["count"], x["bytes"]) for x in logs] == [(10, 20 * MiB)]
        sys.stderr.write(f"\nP32 perf: 10 × 2 MiB tải trong {logs[0]['ms']} ms (báo cáo, 2 s)\n")
        assert agent_text(row) == files_lines(fs)
