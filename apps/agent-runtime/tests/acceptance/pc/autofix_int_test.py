"""WRK-FR-28 · WRK-FR-29 · HUB-BR-32 · HUB-BR-33 · WRK-BR-08 · PC-R04 · PC-R05 · PC-R06 · PC-R08 ·
PC-R09 · PC-R11 · PC-R12 · PC-R15 · P-c1 Runtime đầu-cuối (task R2b, test-plan P-c §6 G11/G12, §9).

Runtime thật + `RUNTIME_SANDBOX=fake` (`FakeOci`, `APP_ENV=test`) + `fake-cli` directive
`#fake:ws_*` (plan-runtime §5.6) + mock Hub `autofix-result` (`_af.py`). Mỗi ca: một job
`agent.cli` có `payload.autofix` (nguồn `local_path` `app-repo`, `test_cmd` `sh test.sh`) ⇒ Runtime
dựng workspace, chạy agent, kiểm PC-R08, `POST /internal/jobs/:id/autofix-result` TRƯỚC khi kết
thúc job (201 chỉ khi job còn `running` + đúng token), dọn `work/<job_id>/`.

Đỏ tới R3: `need_r3()` (`agent_runtime.autofix.host.AutofixHost` / `ws_tools` chưa có).
"""

from __future__ import annotations

import json
from typing import Any

import pytest

from tests.acceptance._rt import Job, wait_until
from tests.acceptance._stream import ENDED
from tests.acceptance.conftest import Ctx
from tests.acceptance.pc._af import (
    AWS_RE,
    BAD_PATCH,
    FIX,
    GOOD_PATCH,
    SECRET,
    SHA_RE,
    SUM_BUG,
    AfEnv,
    af_env,
    assert_failed_report,
    need_r3,
    ws_write,
)

pytestmark = pytest.mark.int

JOB_S = 40.0  # chờ theo điều kiện (claim + fake agent + test trong FakeOci)


async def run_job(e: AfEnv, prompt: str, **over: Any) -> tuple[Job, dict[str, Any]]:
    job = await e.job(prompt, **over)
    row = await e.ctx.until_status(job, ENDED, JOB_S)
    return job, row


def tools(body: dict[str, Any]) -> list[str]:
    return [str(c["tool"]) for c in body["commands"]]


def assert_no_secret(e: AfEnv, job: Job, row: dict[str, Any]) -> None:
    """PC-R12 · HUB-BR-33: không giá trị bí mật / token job trong báo cáo, log Runtime, hàng job."""
    raw = "".join(c.body.decode(errors="replace") for c in e.mock.reports(job))
    logs = e.logs()
    for where, text in (("báo cáo", raw), ("log", logs), ("job", repr(row))):
        assert not AWS_RE.search(text), f"lộ khoá AWS trong {where}"
    for c in e.mock.reports(job):
        assert c.bearer and c.bearer not in logs, "token job lọt vào log"


def assert_not_container(row: dict[str, Any]) -> None:
    """Trượt kiểm ≠ lỗi container/kênh Hub (PC-R10 (b)/(c) phân biệt bằng `error_reason`)."""
    assert row["error_reason"] not in ("container", "upstream"), row


async def test_wrk_fr_29_af01_ok_diff_and_test_pass(ctx: Ctx) -> None:
    """AF01 · WRK-FR-28/29 · PC-R05 · PC-R08 · PC-R15 · HUB-BR-32: pha cài → agent sửa → test xanh ⇒
    `ok` + diff `base..HEAD` (file của pha cài KHÔNG trong diff), 1 file +1/−1, job `succeeded`,
    repo thật không đổi, `work/<job_id>/` được dọn."""
    need_r3()
    async with af_env(ctx) as e:
        e.runtime()
        job, row = await run_job(
            e,
            f"{FIX} sửa hàm sum",
            install_cmd="touch .installed",
            test_cmd="test -f .installed && sh test.sh",
        )
        body = e.mock.report(job)
        assert body["status"] == "ok", body
        assert body["branch"] == f"ai/{job.run_id}/fix"
        assert SHA_RE.match(body["base_sha"]) and SHA_RE.match(body["head_sha"])
        assert body["base_sha"] != body["head_sha"]
        diff = str(body["diff"])
        assert "src/sum.js" in diff and "+  return a+b;" in diff and "-  return a-b;" in diff
        assert ".installed" not in diff, "commit base phải SAU pha cài (PC-R05)"
        stats = body["diff_stats"]
        assert (stats["files"], stats["insertions"], stats["deletions"]) == (1, 1, 1), stats
        assert stats["bytes"] == len(diff.encode())
        assert body["failures"] == []
        assert body["test"]["exit_code"] == 0 and "1 pass" in body["test"]["log_tail"]
        assert "edit" in tools(body), body["commands"]
        assert row["status"] == "succeeded", row
        assert (e.repo / "src" / "sum.js").read_text(encoding="utf-8") == SUM_BUG
        work = ctx.box.work / job.id

        async def gone() -> bool:
            return not work.exists()

        await wait_until(gone, 10.0, f"dọn {work}")


async def test_wrk_fr_29_af02_no_changes(ctx: Ctx) -> None:
    """AF02 · PC-R09: agent chỉ chạy lệnh, không sửa ⇒ `no_changes`, diff/diff_stats null,
    failures rỗng, lệnh ghi vào `commands` (tool `exec`, exit 0)."""
    need_r3()
    async with af_env(ctx) as e:
        e.runtime()
        job, row = await run_job(e, "#fake:ws_exec=ls xem repo", test_cmd="true")
        body = e.mock.report(job)
        assert body["status"] == "no_changes", body
        assert body["diff"] is None and body["diff_stats"] is None
        assert body["failures"] == []
        execs = [c for c in body["commands"] if c["tool"] == "exec"]
        assert [(c["arg"], c.get("exit_code")) for c in execs] == [("ls", 0)], body["commands"]
        assert row["status"] == "succeeded", row


async def test_wrk_fr_29_af03_paths_outside_allowlist(ctx: Ctx) -> None:
    """AF03 · PC-R08 (1): sửa file ngoài `write_allowlist` (`src/**`) ⇒ `check_failed{paths}`
    đường dẫn `docs/note.md`, dừng ở nhóm đầu (test không chạy ⇒ `test` null)."""
    need_r3()
    async with af_env(ctx) as e:
        e.runtime()
        job, row = await run_job(e, f"{ws_write('docs/note.md', 'ghi chú\n')} ghi", test_cmd="true")
        body = e.mock.report(job)
        first = assert_failed_report(body, "paths")
        assert first["path"] == "docs/note.md", first
        assert body["test"] is None
        assert_not_container(row)


async def test_wrk_fr_29_af04_secrets_no_value(ctx: Ctx) -> None:
    """AF04 · PC-R08 (3) · PC-R12: agent ghi khoá AWS vào `src/cfg.js` ⇒ `check_failed{secrets}`
    path + line, rule ≤ 64; giá trị KHÔNG có trong báo cáo/log/hàng job; test không chạy."""
    need_r3()
    async with af_env(ctx) as e:
        e.runtime()
        job, row = await run_job(e, "#fake:ws_secret=src/cfg.js thêm cấu hình", test_cmd="true")
        body = e.mock.report(job)
        first = assert_failed_report(body, "secrets")
        assert first["path"] == "src/cfg.js" and isinstance(first.get("line"), int), first
        assert 0 < len(str(first.get("rule") or "")) <= 64, first
        assert body["test"] is None
        assert_no_secret(e, job, row)
        assert_not_container(row)


async def test_wrk_fr_29_af05_tests_fail_log_redacted(ctx: Ctx) -> None:
    """AF05 · PC-R08 (4) · PC-R12: có diff hợp lệ nhưng test exit 1 ⇒ `check_failed{tests}`,
    `test.exit_code=1`, `log_tail` giữ dòng lỗi, bí mật in ra bị che `[REDACTED]`."""
    need_r3()
    async with af_env(ctx) as e:
        e.runtime()
        job, row = await run_job(
            e,
            f"{ws_write('src/note.js', 'export const n = 1;\n')} thêm file",
            test_cmd=f"echo {SECRET}; sh test.sh",
        )
        body = e.mock.report(job)
        assert_failed_report(body, "tests")
        test = body["test"]
        assert test["exit_code"] == 1 and test["duration_ms"] >= 0, test
        assert "1 fail: sum" in test["log_tail"] and "[REDACTED]" in test["log_tail"], test
        assert_no_secret(e, job, row)
        assert_not_container(row)


async def test_wrk_fr_28_af06_install_fails(ctx: Ctx) -> None:
    """AF06 · PC-R15: `install_cmd` exit ≠ 0 ⇒ `check_failed{install}`, không diff, không test."""
    need_r3()
    async with af_env(ctx) as e:
        e.runtime()
        job, row = await run_job(e, f"{FIX} sửa", install_cmd="echo cai-loi; exit 7")
        body = e.mock.report(job)
        assert_failed_report(body, "install")
        assert body["test"] is None
        assert_not_container(row)


async def test_wrk_fr_29_af07_apply_patch_fails_then_redo_from_scratch(ctx: Ctx) -> None:
    """AF07 · PC-R11 · edge "base_patch không áp được": vòng 2 có `base_patch` lệch ⇒
    `check_failed{apply_patch}` (không diff, không test); làm lại (`base_patch=null`, vòng 3, cùng
    nhánh) ⇒ `ok`, diff chỉ phần agent sửa trên snapshot gốc."""
    need_r3()
    async with af_env(ctx) as e:
        e.runtime()
        job1, row1 = await run_job(e, f"{FIX} sửa", round=2, base_patch=e.patch(BAD_PATCH))
        assert e.mock.gets(job1), "Runtime phải tải base_patch qua token job"
        body1 = e.mock.report(job1)
        assert_failed_report(body1, "apply_patch")
        assert body1["test"] is None
        assert_not_container(row1)
        branch = body1["branch"]
        job2, row2 = await run_job(e, f"{FIX} sửa", round=3, base_patch=None, branch=branch)
        body2 = e.mock.report(job2)
        assert body2["status"] == "ok" and body2["branch"] == branch, body2
        assert body2["diff_stats"]["files"] == 1 and "src/sum.js" in str(body2["diff"])
        assert row2["status"] == "succeeded", row2


async def test_wrk_fr_29_af08_base_patch_cumulative(ctx: Ctx) -> None:
    """AF08 · PC-R11: vòng 2 có `base_patch` hợp lệ (thêm `src/extra.js`) ⇒ áp trước agent; diff
    mới CỘNG DỒN so commit ghim (cả `src/extra.js` lẫn `src/sum.js`)."""
    need_r3()
    async with af_env(ctx) as e:
        e.runtime()
        job, row = await run_job(e, f"{FIX} sửa tiếp", round=2, base_patch=e.patch(GOOD_PATCH))
        body = e.mock.report(job)
        assert body["status"] == "ok", body
        diff = str(body["diff"])
        assert "src/extra.js" in diff and "+export const extra = 1;" in diff
        assert "src/sum.js" in diff and "+  return a+b;" in diff
        assert body["diff_stats"]["files"] == 2, body["diff_stats"]
        assert row["status"] == "succeeded", row


@pytest.mark.parametrize(
    ("env", "big"),
    [({"RUNTIME_AUTOFIX_MAX_FILES": "2"}, 0), ({"RUNTIME_AUTOFIX_MAX_MB": "1"}, 1_572_864)],
    ids=["max-files", "max-mb"],
)
async def test_wrk_fr_28_af09_pc_r04_runtime_caps(ctx: Ctx, env: dict[str, str], big: int) -> None:
    """AF09 · PC-R04 · G12: snapshot/workspace vượt `RUNTIME_AUTOFIX_MAX_FILES` (repo 4 file > 2)
    hoặc `RUNTIME_AUTOFIX_MAX_MB` (file 1,5 MiB > 1 MiB) ⇒ báo cáo `check_failed{size}`, không diff,
    không test; job không lỗi `container`."""
    need_r3()
    async with af_env(ctx, big_bytes=big) as e:
        e.runtime(**env)
        job, row = await run_job(e, f"{FIX} sửa")
        body = e.mock.report(job)
        assert_failed_report(body, "size")
        assert body["test"] is None
        assert_not_container(row)


async def test_wrk_fr_29_af10_report_undeliverable_job_failed_upstream(ctx: Ctx) -> None:
    """AF10 · plan §1 bước 7: Hub trả 503 mọi lần ⇒ thử lại 3 lần (tổng 4 POST) rồi job
    `failed`, `error_reason=upstream` (không phải `container`)."""
    need_r3()
    async with af_env(ctx) as e:
        e.mock.mode = "down"
        e.runtime()
        job, row = await run_job(e, f"{FIX} sửa")
        assert [c.status for c in e.mock.reports(job)] == [503] * 4
        assert (row["status"], row["error_reason"]) == ("failed", "upstream"), row


async def test_wrk_br_08_af11_no_sandbox_job_failed_container(ctx: Ctx) -> None:
    """AF11 · PC-R06 · WRK-BR-08: `RUNTIME_SANDBOX=off` (không container) ⇒ job tự-sửa vẫn được
    nhận rồi `failed`, `error_reason=container`; không chạy agent ngoài container (repo không
    đổi, không báo cáo `ok`)."""
    need_r3()
    async with af_env(ctx) as e:
        e.runtime(RUNTIME_SANDBOX="off")
        job, row = await run_job(e, f"{FIX} sửa")
        assert (row["status"], row["error_reason"]) == ("failed", "container"), row
        statuses = [json.loads(c.body).get("status") for c in e.mock.reports(job)]
        assert "ok" not in statuses, statuses
        assert (e.repo / "src" / "sum.js").read_text(encoding="utf-8") == SUM_BUG
