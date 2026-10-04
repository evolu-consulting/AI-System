"""WRK-FR-02 · WRK-FR-23 · WRK-BR-04 · plan-runtime §1.5 — review H1 #2: systemd dừng cả cgroup
(`KillMode=control-group` cũ: SIGTERM tới cha **và** mọi job host cùng lúc). Job host chết trước khi
`Supervisor.shutdown` kịp `request_stop` → trước đây `crash` + đếm lỗi provider → `error` → fail cả
job `queued`. Kỳ vọng: job đang chạy `orphaned`, provider không `error`, job `queued` vẫn `queued`.
"""

from __future__ import annotations

import os
import signal

import pytest

from tests.acceptance._rt import BETA, FAKE, set_provider
from tests.acceptance.conftest import Ctx

pytestmark = pytest.mark.int
RUNNING = 3
START_S = 20.0


def _sigterm_group(pgid: int) -> None:
    try:
        os.killpg(pgid, signal.SIGTERM)
    except ProcessLookupError:
        pass


async def test_wrk_fr_23_cgroup_sigterm_orphans_without_provider_error(ctx: Ctx) -> None:
    await set_provider(ctx.conn, FAKE, RUNNING)
    jobs = [await ctx.job(tenant=BETA, prompt="#fake:sleep=60") for _ in range(RUNNING)]
    rt = ctx.runtime("qc-cgroup")
    # Khởi động lạnh (chạy đầu phiên pytest, không .pyc) có thể > CLAIM_S mặc định.
    pgids = [int((await ctx.until_running(j, START_S))["pgid"]) for j in jobs]
    queued = await ctx.job(tenant=BETA, prompt="chờ slot")
    rt.signal(signal.SIGTERM)  # như systemd: cha rồi ngay lập tức mọi process trong cgroup
    for g in pgids:
        _sigterm_group(g)
    assert await rt.wait_exit(10) == 0
    for j in jobs:
        row = await ctx.until_status(j, ["failed"], 2, watch=False)
        assert (row["error_code"], row["error_reason"]) == ("INTERNAL_ERROR", "orphaned")
    st = await ctx.conn.fetchrow(
        "select status, consecutive_errors from hub.provider_state where provider_key = $1", FAKE
    )
    assert st is None or (st["status"] != "error" and st["consecutive_errors"] == 0)
    q = await ctx.conn.fetchrow("select status from hub.jobs where id = $1", queued.id)
    assert q is not None and q["status"] == "queued"
