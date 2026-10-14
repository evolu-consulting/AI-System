"""HUB-FR-129 · WRK-FR-29 · HUB-BR-30 · HUB-BR-32 · HUB-BR-34 · E4 · PC2-R04 · R05 · R06 · R08 · R11
·
R12 · P-c2 Runtime đầu-cuối job `source.apply` (test-plan P-c2 §4 AP01–AP09, `-m int`).

Runtime thật + `RUNTIME_SANDBOX=fake` + repo bare cục bộ (insteadOf `file://`) + mock Hub
(`_pc2.py`).
Mỗi ca: một job `source.apply` (bản vá đã duyệt sửa `a-b` → `a+b`) ⇒ Runtime lấy khoá qua kênh nội
bộ, fetch, checkout HEAD mới của `main`, `git apply --3way`, commit, (rebase ⇒ test lại trong
container), push `+HEAD:refs/heads/ai/<run>/fix`, `POST …/apply-result`, dọn `work/<job>/`.
Token KHÔNG xuất hiện ở đĩa (work/cache/repo), log, báo cáo; nhánh mặc định không bao giờ bị đẩy.

Đỏ tới R2: `need_r2()` (`agent_runtime.apply.host.ApplyHost` chưa có).
"""

from __future__ import annotations

from typing import Any

import pytest

from tests.acceptance._rt import Job
from tests.acceptance._stream import ENDED
from tests.acceptance.conftest import Ctx
from tests.acceptance.pc2._pc2 import (
    SHA_RE,
    SRC_ID,
    SUM_FIX,
    TEST_SH,
    ApplyEnv,
    apply_env,
    git,
    need_r2,
)

pytestmark = pytest.mark.int

JOB_S = 60.0  # chờ theo điều kiện (claim + git + test FakeOci)


async def run(e: ApplyEnv, pin: str, patch: str, **over: Any) -> tuple[Job, dict[str, Any]]:
    job = await e.job(pin, patch, **over)
    row = await e.ctx.until_status(job, ENDED, JOB_S)
    return job, row


def fix_patch(e: ApplyEnv, pin: str) -> str:
    return e.origin.patch({"src/sum.js": SUM_FIX}, pin)


def assert_clean(e: ApplyEnv, job: Job, main_before: str | None = None) -> None:
    """HUB-BR-30 · HUB-BR-32: không rò token; `work/<job>/` đã dọn; main giữ nguyên (nếu cho)."""
    assert e.leaks() == []
    assert not (e.ctx.box.work / job.id).exists()
    if main_before is not None:
        assert e.origin.head("main") == main_before


async def test_hub_fr_129_ap01_push_branch_no_rebase(ctx: Ctx) -> None:
    """AP01 · HUB-FR-129 · PC2-R04 · R06 · R11: main = pin ⇒ áp bản vá, commit, push đúng
    `ai/<run>/fix`; báo cáo pushed (target = pin, rebased false, head = ref đã đẩy, cha = target);
    lấy khoá đúng 1 lần (Bearer token job, thân {source_id}); job succeeded; main không đổi; không
    rò
    token; work dọn."""
    need_r2()
    async with apply_env(ctx) as e:
        e.runtime()
        pin = e.origin.head("main") or ""
        job, row = await run(e, pin, fix_patch(e, pin))
        body = e.mock.report(job)
        assert body["status"] == "pushed", body
        assert [body["target_sha"], body["rebased"], body["code"]] == [pin, False, None]
        assert SHA_RE.match(body["head_sha"])
        ref = f"ai/{job.run_id}/fix"
        assert e.origin.head(ref) == body["head_sha"]
        assert git(e.origin.bare, "rev-parse", f"{body['head_sha']}^") == pin
        shown = git(e.origin.bare, "show", f"{body['head_sha']}:src/sum.js")
        assert "return a+b;" in shown
        author = git(e.origin.bare, "log", "-1", "--format=%an", body["head_sha"])
        assert author == "ai-autofix"
        creds = e.mock.creds(job)
        assert len(creds) == 1 and creds[0].status == 200
        assert creds[0].bearer and creds[0].body and SRC_ID in creds[0].body.decode()
        assert row["status"] == "succeeded", row
        assert_clean(e, job, pin)


async def test_wrk_fr_29_ap02_rebase_clean_retest(ctx: Ctx) -> None:
    """AP02 · E4 · PC2-R05: main đã có commit mới (không chạm file sửa) ⇒ áp 3-way lên HEAD mới,
    rebased true, target = HEAD mới, chạy lại test trong container (test ≠ null, exit 0), push."""
    need_r2()
    async with apply_env(ctx) as e:
        e.runtime()
        pin = e.origin.head("main") or ""
        patch = fix_patch(e, pin)
        target = e.origin.commit({"README.md": "# app\n\nĐổi sau pin.\n"}, "c2")
        job, _row = await run(e, pin, patch)
        body = e.mock.report(job)
        assert body["status"] == "pushed", body
        assert [body["target_sha"], body["rebased"]] == [target, True]
        assert body["test"] is not None and body["test"]["exit_code"] == 0
        assert git(e.origin.bare, "rev-parse", f"{body['head_sha']}^") == target
        assert e.origin.head(f"ai/{job.run_id}/fix") == body["head_sha"]
        assert_clean(e, job, target)


async def test_wrk_fr_29_ap03_rebase_conflict(ctx: Ctx) -> None:
    """AP03 · E4 · Q5 · PC2-R04: main sửa cùng dòng ⇒ conflict{src/sum.js}, head null, KHÔNG push
    nhánh ai/, main giữ nguyên."""
    need_r2()
    async with apply_env(ctx) as e:
        e.runtime()
        pin = e.origin.head("main") or ""
        patch = fix_patch(e, pin)
        target = e.origin.commit(
            {"src/sum.js": "export function sum(a, b) {\n  return a*b;\n}\n"}, "c2"
        )
        job, _row = await run(e, pin, patch)
        body = e.mock.report(job)
        assert body["status"] == "conflict", body
        assert "src/sum.js" in body["conflict_files"]
        assert [body["head_sha"], body["target_sha"], body["rebased"]] == [None, target, True]
        assert e.origin.head(f"ai/{job.run_id}/fix") is None
        assert_clean(e, job, target)


async def test_wrk_fr_29_ap04_rebase_retest_fails(ctx: Ctx) -> None:
    """AP04 · PC2-R05 · HUB-BR-33: rebase sạch nhưng test trên main mới đỏ ⇒ check_failed
    {tests}, test exit ≠ 0, KHÔNG push."""
    need_r2()
    async with apply_env(ctx) as e:
        e.runtime()
        pin = e.origin.head("main") or ""
        patch = fix_patch(e, pin)
        e.origin.commit({"test.sh": TEST_SH.replace("exit 0", "exit 3")}, "c2 test khó hơn")
        job, _row = await run(e, pin, patch)
        body = e.mock.report(job)
        assert body["status"] == "check_failed", body
        assert [f["check"] for f in body["failures"]][0] == "tests"
        assert body["test"] is not None and body["test"]["exit_code"] != 0
        assert body["head_sha"] is None
        assert e.origin.head(f"ai/{job.run_id}/fix") is None
        assert_clean(e, job)


async def test_hub_br_34_ap05_force_only_in_ai_namespace(ctx: Ctx) -> None:
    """AP05 · PC2-R06 · PC2-R07: nhánh `ai/<run>/fix` đã có (vòng trước, commit khác) ⇒ cưỡng bức
    cập nhật trong ai/ của run; chạy lại cùng job (Thêm lượt) ⇒ pushed cùng head (idempotent); ref
    khác
    (main, ai/<run khác>/fix) không đổi."""
    need_r2()
    async with apply_env(ctx) as e:
        e.runtime()
        pin = e.origin.head("main") or ""
        patch = fix_patch(e, pin)
        run_id = "c2c20000-0000-4000-8000-0000000000c5"
        other = "ai/c2c20000-0000-4000-8000-0000000000c6/fix"
        seed = e.origin.seed
        git(seed, "checkout", "-q", "-b", "side")
        (seed / "side.txt").write_text("vong truoc", encoding="utf-8")
        git(seed, "add", "-A")
        git(seed, "commit", "-q", "-m", "vòng trước")
        readme = git(seed, "rev-parse", "HEAD")
        git(seed, "checkout", "-q", "main")
        git(seed, "push", "-q", str(e.origin.bare), f"{readme}:refs/heads/ai/{run_id}/fix")
        git(seed, "push", "-q", str(e.origin.bare), f"{readme}:refs/heads/{other}")
        job1, _ = await run(e, pin, patch, run_id=run_id)
        b1 = e.mock.report(job1)
        assert b1["status"] == "pushed", b1
        assert e.origin.head(f"ai/{run_id}/fix") == b1["head_sha"]
        job2, _ = await run(e, pin, patch, run_id=run_id)
        b2 = e.mock.report(job2)
        assert b2["status"] == "pushed", b2
        assert e.origin.head(f"ai/{run_id}/fix") in (b1["head_sha"], b2["head_sha"])
        assert e.origin.head(other) == readme
        assert e.origin.head("main") == pin
        refs = e.origin.refs()
        assert all(r == "refs/heads/main" or r.startswith("refs/heads/ai/") for r in refs), refs


async def test_hub_br_34_ap06_never_push_default_branch(ctx: Ctx) -> None:
    """AP06 · HUB-BR-34 · PC2-R06: payload nhánh ngoài ai/ (`main`) ⇒ Runtime từ chối (job failed,
    không báo pushed), main + mọi ref giữ nguyên."""
    need_r2()
    async with apply_env(ctx) as e:
        e.runtime()
        pin = e.origin.head("main") or ""
        refs = e.origin.refs()
        job, row = await run(e, pin, fix_patch(e, pin), branch="main")
        assert row["status"] == "failed", row
        assert all(c.status != 201 or b'"pushed"' not in c.body for c in e.mock.reports(job))
        assert e.origin.head("main") == pin
        assert e.origin.refs() == refs


async def test_hub_br_30_ap07_no_credential_call_when_public(ctx: Ctx) -> None:
    """AP07 · PC2-R11 · PC2-R12: `has_credential=false` ⇒ không gọi `source-credential`; vẫn
    push."""
    need_r2()
    async with apply_env(ctx) as e:
        e.runtime()
        pin = e.origin.head("main") or ""
        src = {
            "source_id": SRC_ID,
            "key": "app-repo",
            "url": "https://github.com/pc2-test/app-repo.git",
            "branch": "main",
            "has_credential": False,
        }
        job, _ = await run(e, pin, fix_patch(e, pin), source=src)
        assert e.mock.creds(job) == []
        assert e.mock.report(job)["status"] == "pushed"


async def test_hub_br_30_ap08_credential_missing(ctx: Ctx) -> None:
    """AP08 · PC2-R08 · plan Edge: Hub trả 409 NOT_CONFIGURED cho khoá ⇒ báo cáo
    failed{no_credential},
    không push."""
    need_r2()
    async with apply_env(ctx) as e:
        e.mock.cred = "missing"
        e.runtime()
        pin = e.origin.head("main") or ""
        job, _ = await run(e, pin, fix_patch(e, pin))
        body = e.mock.report(job)
        assert [body["status"], body["code"], body["head_sha"]] == ["failed", "no_credential", None]
        assert e.origin.head(f"ai/{job.run_id}/fix") is None


async def test_wrk_fr_29_ap09_push_rejected(ctx: Ctx) -> None:
    """AP09 · PC2-R08: remote từ chối (pre-receive hook) ⇒ failed{push_rejected}; detail ≤ 300, đã
    che."""
    need_r2()
    async with apply_env(ctx) as e:
        e.origin.install_hook("#!/bin/sh\necho 'pre-receive hook declined: protected'\nexit 1\n")
        e.runtime()
        pin = e.origin.head("main") or ""
        job, _ = await run(e, pin, fix_patch(e, pin))
        body = e.mock.report(job)
        assert [body["status"], body["code"]] == ["failed", "push_rejected"], body
        assert len(body.get("detail") or "") <= 300
        assert e.origin.head(f"ai/{job.run_id}/fix") is None
        assert e.leaks() == []
