"""HUB-FR-129 · WRK-FR-29 · HUB-BR-30 · HUB-BR-34 · PC2-R04 · R05 · R06 · R08 · R11 · R12 · P-c2 ·
`ApplyHost` — job `source.apply` (plan §1, plan-runtime §5.2).

Claim riêng (`db/apply_sql.py`, provider_key NULL; slot sandbox chung tự-sửa, C22/C38) → khoá nguồn
qua kênh nội bộ (chỉ trong bộ nhớ, PC2-R11) → `ensure_mirror_fresh` (mirror riêng khi có khoá,
PC2-R12) → `target` = HEAD của `config.branch` → clone work repo + checkout `target` → tải `patch`
→ `git apply --3way --index --binary` → commit `ai-autofix`. Xung đột ⇒ `conflict{files}`.
`target ≠ pin` ⇒ rebase ⇒ kiểm PC-R08 lại + test container MỚI (bản xuất đã lọc PB-R07 của cây sau
áp); trượt ⇒ `check_failed`; không sandbox ⇒ job lỗi `container` (không báo cáo, C46). Push CHỈ
refspec `ai/` (ref từ xa đã = HEAD ⇒ bỏ). Báo cáo TRƯỚC khi kết thúc; Hub nhận (201/409 tồn tại) ⇒
job `succeeded` kể cả conflict/failed/check_failed (C37). `finally`: xoá container + `work/<job>/`.
"""

from __future__ import annotations

import asyncio
from contextlib import suppress
from dataclasses import dataclass, field
from pathlib import Path

import httpx2
from pydantic import ValidationError

from agent_runtime.apply import gitwork, report
from agent_runtime.apply.report import ApplyReport, HubTarget
from agent_runtime.autofix.check import run_checks
from agent_runtime.autofix.oci import Oci, OciError
from agent_runtime.autofix.prep import AutofixCfg, Box, EarlyReport, install, run_test, sandbox_spec
from agent_runtime.autofix.report import TestRun
from agent_runtime.autofix.rules import Failure, container_name
from agent_runtime.autofix.workspace import (
    Workspace,
    WorkspaceError,
    copy_workspace,
    hand_over,
    init_git,
    prepare,
)
from agent_runtime.contracts.hub import Source2, SourceApplyJob
from agent_runtime.db import apply_sql
from agent_runtime.db.pool import Pool
from agent_runtime.log import bind_job, get_logger
from agent_runtime.runtimes.cli.files.fetch import job_url
from agent_runtime.runtimes.hub_http import (
    SourceCredentialError,
    make_hub_client,
    source_credential,
)
from agent_runtime.sources import git_driver, snapshot
from agent_runtime.sources.config import SourceConfig
from agent_runtime.sources.errors import SourceError
from agent_runtime.sources.git_driver import GitAuth

_PATCH_TIMEOUT = httpx2.Timeout(60.0)
_HTTP_OK = 200
_PHASES = ("prep", "test")


@dataclass(frozen=True)
class ApplyCfg:
    """Cấu hình `ApplyHost` (plan-runtime §5.2); `main` dựng từ `Settings` + `SourceConfig`."""

    source_cfg: SourceConfig
    af: AutofixCfg
    work_root: Path
    worker_id: str
    sandbox_max: int
    hub_url: str | None
    transport: httpx2.AsyncBaseTransport | None = None


@dataclass(frozen=True)
class _Retest:
    """Kết quả kiểm lại sau rebase: `failures` rỗng + test exit 0 ⇒ đạt (push); ngược lại
    `check_failed`."""

    failures: list[Failure] = field(default_factory=list[Failure])
    test: TestRun | None = None


class _Reported(Exception):  # noqa: N818 — kết cục báo cáo, không phải lỗi lập trình
    def __init__(self, r: ApplyReport) -> None:
        super().__init__(r.status)
        self.report = r


class _ContainerFail(Exception):  # noqa: N818 — không sandbox ⇒ job failed/container, không báo cáo
    pass


def _test_failures(test: TestRun) -> list[Failure]:
    if test.exit_code == 0:
        return []
    if test.exit_code is None:
        return [Failure("tests", rule="timeout", detail="test_cmd hết giờ")]
    return [Failure("tests", rule="exit_code", detail=f"test_cmd exit {test.exit_code}")]


class ApplyHost:
    """Vòng claim + chạy job `source.apply` (như `ResolveHost`: HTTP + DB trong process cha)."""

    def __init__(self, pool: Pool, cfg: ApplyCfg, oci: Oci | None) -> None:
        self._pool = pool
        self._cfg = cfg
        self._oci = oci

    async def run_loop(self, poll_s: float) -> None:
        log = get_logger()
        while True:
            try:
                while await self.claim_and_run():
                    pass
            except Exception as err:  # noqa: BLE001 — một job lỗi không kéo sập vòng
                log.error("apply.loop_error", error=type(err).__name__)
            await asyncio.sleep(poll_s)

    async def claim_and_run(self) -> bool:
        async with self._pool.acquire() as conn:
            job = await apply_sql.claim_apply(conn, self._cfg.worker_id, self._cfg.sandbox_max)
        if job is None:
            return False
        await self._process(job)
        return True

    # ---------- vòng đời một job ----------

    async def _process(self, job: apply_sql.ApplyJob) -> None:
        try:
            payload = SourceApplyJob.model_validate(job.payload)
        except ValidationError:
            await self._finish(job, "failed", "INTERNAL_ERROR", "invalid_payload")
            return
        job_dir = self._cfg.work_root / job.id
        with bind_job(job.id, str(payload.process_run_id), str(payload.tenant_id)):
            try:
                rep = await self._execute(job, payload, job_dir)
            finally:
                await self._cleanup(job, job_dir)
            await self._settle(job, rep)

    async def _settle(self, job: apply_sql.ApplyJob, rep: ApplyReport | None) -> None:
        if rep is None:  # không sandbox ⇒ không báo cáo (C46)
            await self._finish(job, "failed", "INTERNAL_ERROR", "container")
            return
        delivered = await self._post(job, rep)
        if delivered:
            await self._finish(job, "succeeded")
        else:
            await self._finish(job, "failed", "UPSTREAM_ERROR", "upstream")

    async def _execute(
        self, job: apply_sql.ApplyJob, payload: SourceApplyJob, job_dir: Path
    ) -> ApplyReport | None:
        try:
            return await self._run_apply(job, payload, job_dir)
        except _Reported as r:
            return r.report
        except _ContainerFail:
            return None
        except Exception as err:  # noqa: BLE001 — job không được kẹt `running`
            get_logger().error("apply.host_failed", error=type(err).__name__)
            return ApplyReport("failed", target_sha=None, code="network")

    # ---------- các bước (PC2-R04..R08) ----------

    async def _run_apply(
        self, job: apply_sql.ApplyJob, payload: SourceApplyJob, job_dir: Path
    ) -> ApplyReport:
        cfg, source = self._cfg.source_cfg, payload.source
        auth = await self._auth(job, source)
        mirror, target = await self._target(source, auth)
        rebased = target != payload.pin_sha
        repo = job_dir / "repo"
        await asyncio.to_thread(_fresh_repo, repo)
        try:
            await asyncio.to_thread(
                gitwork.clone_checkout, cfg, mirror, repo, target, payload.branch
            )
        except gitwork.GitWorkError as err:
            raise _Reported(_failed(target, "network", str(err))) from err
        patch = await self._fetch_patch(job, payload, job_dir)
        applied = await asyncio.to_thread(gitwork.apply_patch, cfg, repo, patch)
        if not applied.ok:
            raise _Reported(ApplyReport("conflict", target, rebased=rebased,
                                        conflict_files=applied.conflict_files))  # fmt: skip
        head = await asyncio.to_thread(gitwork.commit, cfg, repo, payload.branch)
        test = await self._maybe_retest(job, payload, job_dir, repo, target, head, rebased)
        return await self._push(payload, repo, auth, target, head, rebased, test)

    async def _auth(self, job: apply_sql.ApplyJob, source: Source2) -> GitAuth | None:
        if not source.has_credential:
            return None
        if not self._cfg.hub_url:
            raise _Reported(_failed(None, "no_credential", "không có hub_url"))
        try:
            username, token = await source_credential(
                self._cfg.hub_url, job.id, job.token, str(source.source_id), self._cfg.transport
            )
        except SourceCredentialError as err:
            raise _Reported(_failed(None, "no_credential", "không lấy được khoá nguồn")) from err
        return GitAuth(username=username, token=token)

    async def _target(self, source: Source2, auth: GitAuth | None) -> tuple[Path, str]:
        cfg = self._cfg.source_cfg
        try:
            mirror = await asyncio.to_thread(
                git_driver.ensure_mirror_fresh,
                cfg, source.url, str(source.source_id), source.has_credential, auth,
            )  # fmt: skip
            target = await asyncio.to_thread(git_driver.resolve_sha, cfg, mirror, source.branch)
        except SourceError as err:
            raise _Reported(_failed(None, "network", "fetch nguồn thất bại")) from err
        return mirror, target

    async def _fetch_patch(
        self, job: apply_sql.ApplyJob, payload: SourceApplyJob, job_dir: Path
    ) -> Path:
        if not self._cfg.hub_url:
            raise _Reported(_failed(None, "network", "không có hub_url"))
        dest = job_dir / "apply-in"
        await asyncio.to_thread(dest.mkdir, 0o700, True, True)
        out = dest / "patch.diff"
        url = job_url(self._cfg.hub_url, job.id, f"attachments/{payload.patch.id}")
        headers = {"Authorization": f"Bearer {job.token}"}
        try:
            async with make_hub_client(self._cfg.transport) as client:
                resp = await client.get(url, headers=headers, timeout=_PATCH_TIMEOUT)
        except httpx2.HTTPError as err:
            raise _Reported(_failed(None, "network", "tải bản vá thất bại")) from err
        if resp.status_code != _HTTP_OK:
            raise _Reported(_failed(None, "network", "bản vá không khả dụng"))
        await asyncio.to_thread(out.write_bytes, resp.content)
        return out

    async def _push(  # noqa: PLR0913
        self,
        payload: SourceApplyJob,
        repo: Path,
        auth: GitAuth | None,
        target: str,
        head: str,
        rebased: bool,
        test: TestRun | None,
    ) -> ApplyReport:
        cfg, url, branch = self._cfg.source_cfg, payload.source.url, payload.branch
        remote = await asyncio.to_thread(gitwork.ls_remote, cfg, repo, url, branch, auth)
        if remote != head:  # PC2-R06/R07: ref từ xa đã = HEAD ⇒ bỏ qua push (idempotent)
            try:
                res = await asyncio.to_thread(gitwork.push, cfg, repo, url, branch, auth)
            except ValueError as err:  # nhánh ngoài không gian ai/ (phòng thủ, pydantic đã chặn)
                raise _Reported(
                    _failed(target, "push_rejected", "nhánh ngoài ai/", rebased)
                ) from err
            if not res.ok:
                code = res.code
                if code == "auth" and not payload.source.has_credential:
                    code = "no_credential"  # C34
                raise _Reported(_failed(target, code or "network", res.detail, rebased))
        return ApplyReport("pushed", target, head_sha=head, rebased=rebased, test=test)

    async def _maybe_retest(  # noqa: PLR0913  (rebase: kiểm lại trong container, PC2-R05)
        self,
        job: apply_sql.ApplyJob,
        payload: SourceApplyJob,
        job_dir: Path,
        repo: Path,
        target: str,
        head: str,
        rebased: bool,
    ) -> TestRun | None:
        if not rebased:
            return None  # target = pin ⇒ P-c1 đã kiểm
        rt = await self._retest(job, payload, job_dir, repo, target, head)
        if rt is None:
            raise _ContainerFail
        if rt.failures:
            raise _Reported(ApplyReport("check_failed", target, rebased=True,
                                        failures=rt.failures, test=rt.test))  # fmt: skip
        return rt.test

    async def _retest(  # noqa: PLR0913
        self,
        job: apply_sql.ApplyJob,
        payload: SourceApplyJob,
        job_dir: Path,
        repo: Path,
        target: str,
        head: str,
    ) -> _Retest | None:
        """`None` ⇒ không sandbox (job failed/container). Workspace = cây `target` đã lọc PB-R07 +
        bản vá `target..HEAD` (⇒ nội dung = cây sau áp); check diff + test container MỚI."""
        if self._oci is None:
            return None
        af, cfg = self._cfg.af, self._cfg.source_cfg
        stage_key = payload.branch.split("/")[2]
        fix = job_dir / "retest-fix.diff"
        await asyncio.to_thread(gitwork.diff_patch, cfg, repo, target, head, fix)
        src = job_dir / "retest-src"
        try:
            ws = await self._build_ws(job, payload, job_dir, src, repo, target, stage_key, fix)
        except (WorkspaceError, EarlyReport) as err:
            return _Retest(failures=[err.failure])
        except OciError:
            return None
        allow = [a.root for a in payload.write_allowlist]
        check = await asyncio.to_thread(run_checks, ws, allow, af.limits)
        if check.failures:
            return _Retest(failures=check.failures)
        return await self._run_test(job, payload, ws)

    async def _build_ws(  # noqa: PLR0913
        self,
        job: apply_sql.ApplyJob,
        payload: SourceApplyJob,
        job_dir: Path,
        src: Path,
        repo: Path,
        target: str,
        stage_key: str,
        fix: Path,
    ) -> Workspace:
        af, cfg = self._cfg.af, self._cfg.source_cfg
        await asyncio.to_thread(_build_target_snapshot, cfg, src, repo, target)
        if payload.install_cmd is None:
            return await asyncio.to_thread(
                prepare, job_dir, src, stage_key, fix, branch=payload.branch, caps=af.caps
            )
        ws_dir = await asyncio.to_thread(copy_workspace, job_dir, src, stage_key, af.caps)
        box = self._box(job, ws_dir)
        await asyncio.to_thread(hand_over, ws_dir)
        await install(box, ws_dir, payload.install_cmd.root)
        return await asyncio.to_thread(init_git, job_dir, ws_dir, payload.branch, fix)

    async def _run_test(
        self, job: apply_sql.ApplyJob, payload: SourceApplyJob, ws: Workspace
    ) -> _Retest | None:
        box = self._box(job, ws.ws_dir)
        try:
            await asyncio.to_thread(hand_over, ws.ws_dir)
            test = await run_test(box, payload.test_cmd)
        except OciError:
            return None
        return _Retest(failures=_test_failures(test), test=test)

    def _box(self, job: apply_sql.ApplyJob, ws_dir: Path) -> Box:
        af = self._cfg.af
        assert self._oci is not None
        spec = sandbox_spec(af, job.id, ws_dir, self._cfg.work_root)
        return Box(self._oci, af, spec)

    # ---------- Hub + dọn ----------

    async def _post(self, job: apply_sql.ApplyJob, rep: ApplyReport) -> bool:
        if not self._cfg.hub_url:
            get_logger().error("apply.no_hub_url")
            return False
        target = HubTarget(self._cfg.hub_url, job.id, job.token)
        ok = await report.post_result(target, rep.body(), self._cfg.transport)
        get_logger().info("apply.report", status=rep.status, delivered=ok)
        return ok

    async def _finish(
        self,
        job: apply_sql.ApplyJob,
        status: str,
        error_code: str | None = None,
        reason: str | None = None,
    ) -> None:
        async with self._pool.acquire() as conn:
            await apply_sql.finish_apply(
                conn, job.id, self._cfg.worker_id, status, error_code, reason
            )

    async def _cleanup(self, job: apply_sql.ApplyJob, job_dir: Path) -> None:
        if self._oci is not None:
            for phase in _PHASES:
                with suppress(Exception):
                    await self._oci.rm(container_name(job.id, phase))  # type: ignore[arg-type]
        with suppress(OSError):
            await asyncio.to_thread(snapshot.rmtree_ro, job_dir)


def _failed(
    target: str | None, code: report.ApplyCode, detail: str | None = None, rebased: bool = False
) -> ApplyReport:
    return ApplyReport("failed", target, rebased=rebased, code=code, detail=detail)


def _fresh_repo(repo: Path) -> None:
    if repo.exists():
        snapshot.rmtree_ro(repo)
    repo.parent.mkdir(parents=True, mode=0o700, exist_ok=True)


def _build_target_snapshot(cfg: SourceConfig, dest: Path, repo: Path, target: str) -> None:
    """Bản xuất cây `target` (git archive từ work repo) đã lọc PB-R07 (secret + `.git`), trần
    `caps=autofix`; là `base` của workspace retest."""
    dest.mkdir(parents=True, mode=0o700, exist_ok=True)
    snapshot.build_git(cfg, dest, repo, target, ["**"], snapshot.ceiling_for(cfg, "autofix"))
