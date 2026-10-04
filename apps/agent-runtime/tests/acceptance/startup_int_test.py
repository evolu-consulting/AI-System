"""WRK-NFR-04 · WRK-FR-23 · H1-R26 · spec §7 · P40–P43: khởi động (registry, `WORK_DIR`), log,
cleanup.

plan-runtime §1.4–1.5 (exit 2 khi cấu hình sai), §7 (`fake-cli` chỉ development|test), §9 (log,
cleanup).
"""

from __future__ import annotations

import json
import os
import stat
import time
from datetime import UTC, datetime

import pytest

from tests.acceptance._rt import BETA, wait_until
from tests.acceptance.conftest import Ctx

pytestmark = pytest.mark.int


async def test_spec_7_production_with_fake_cli_exits_2(ctx: Ctx) -> None:
    """§7 · `APP_ENV=production` + `AGENT_RT_PROVIDERS` có `fake-cli` → exit 2 (≤ 10 s)."""
    rt = ctx.runtime(APP_ENV="production", AGENT_RT_PROVIDERS="claude-sub,fake-cli")
    assert await rt.wait_exit(10) == 2


async def test_spec_7_fake_cli_not_listed_not_registered(ctx: Ctx) -> None:
    """§7 · `fake-cli` không có trong `AGENT_RT_PROVIDERS` → không đăng ký: job `fake-cli` không bị
    claim (mốc sẵn sàng = manifest `agent_types`)."""
    job = await ctx.job(tenant=BETA)
    ctx.runtime(AGENT_RT_PROVIDERS="claude-sub")

    async def ready() -> bool:
        return bool(await ctx.conn.fetchval("select count(*) from hub.agent_types"))

    await wait_until(ready, 10, "manifest agent_types", ctx.alive)
    row = await ctx.until_status(job, ["queued"], 1)
    assert row["attempts"] == 0 and row["worker_id"] is None


@pytest.mark.parametrize("work_dir", ["/mnt/c/work", "relative/work"])
async def test_wrk_nfr_06_bad_work_dir_exits_2(ctx: Ctx, work_dir: str) -> None:
    """§1.4 · `AGENT_RT_WORK_DIR` dưới `/mnt/` hoặc tương đối → exit 2."""
    rt = ctx.runtime(AGENT_RT_WORK_DIR=work_dir)
    assert await rt.wait_exit(10) == 2


async def test_wrk_nfr_04_json_log_ids_and_file_0600(ctx: Ctx) -> None:
    """NFR-04 · stdout JSON có dòng mang `job_id, run_id, tenant_id` của job; không chứa
    prompt/canary;
    file log job (`LOG_DIR/<ngày>/<job_id>.*`) quyền 0600."""
    mark = "PROMPT-LOG-MARK-55"
    job = await ctx.job(tenant=BETA, prompt=f"{mark} #fake:usage=1,1")
    rt = ctx.runtime()
    await ctx.until_status(job, ["succeeded"], 15)
    lines = [json.loads(x) for x in rt.stdout().splitlines() if x.startswith("{")]
    mine = [x for x in lines if x.get("job_id") == job.id]
    assert mine and all((x.get("run_id"), x.get("tenant_id")) == (job.run_id, BETA) for x in mine)
    assert mark not in rt.stdout()
    files = list(ctx.box.logs.rglob(f"{job.id}.*"))
    assert files
    assert {stat.S_IMODE(os.stat(f).st_mode) for f in files} == {0o600}


def make_old(path: os.PathLike[str], age_s: float) -> None:
    t = time.time() - age_s
    os.utime(path, (t, t))


async def test_wrk_fr_23_cleanup_old_logs_and_work(ctx: Ctx) -> None:
    """FR-23 · `AGENT_RT_CLEANUP_S=1`: thư mục log ngày > 7 ngày và `work/<job>` > 24 h bị xoá;
    bản mới giữ nguyên (Q-T7)."""
    old_log = ctx.box.logs / "2000-01-01"
    new_log = ctx.box.logs / datetime.now(UTC).strftime("%Y-%m-%d")
    old_work = ctx.box.work / "c3000000-0000-4000-8000-0000000000b1"
    new_work = ctx.box.work / "c3000000-0000-4000-8000-0000000000b2"
    for d in (old_log, new_log, old_work, new_work):
        d.mkdir(parents=True, exist_ok=True)
        (d / "f.log").write_text("x")
    for d in (old_log, old_log / "f.log"):
        make_old(d, 8 * 86_400)
    for d in (old_work, old_work / "f.log"):
        make_old(d, 25 * 3_600)
    ctx.runtime(AGENT_RT_CLEANUP_S="1")

    async def cleaned() -> bool:
        return not old_log.exists() and not old_work.exists()

    await wait_until(cleaned, 10, "cleanup log > 7 ngày và work > 24 h", ctx.alive)
    assert new_log.exists() and new_work.exists()
