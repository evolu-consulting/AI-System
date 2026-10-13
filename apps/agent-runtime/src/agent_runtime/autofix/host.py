"""WRK-FR-28 · WRK-FR-29 · WRK-BR-08 · HUB-BR-32 · HUB-BR-33 · PC-R04..R12 · P-c1 · `AutofixHost`
(plan §1 bước 4–7, plan-runtime §5.1, §5.8; test-plan §9 "R2b").

Job `agent.cli` có `payload.autofix` (`runtimes/dispatch.py`). Bọc vòng đời `CliJobHost`/`JobRun`:
snapshot `caps=autofix` → chép workspace → pha cài (`prep`, có mạng) → `init_git` + `base_patch`
(tải bằng token job) → container agent `--network none` → agent (CLI cũ + tool `ws`) → xoá
container agent → `check.run_checks` → test (container MỚI, chỉ khi các nhóm trước qua) →
`report.build_report` + `post_result` (job còn `running`) → kết thúc job như cũ → dọn container
và `work/<job_id>/`.
Kết cục: sandbox `None` (off / tự kiểm hỏng) ⇒ vẫn claim, `failed/container`; trượt trước agent ⇒
POST `check_failed` (test/diff null) rồi `failed/sandbox`; gửi báo cáo hết lượt ⇒
`failed/upstream`; `ok`/`no_changes`/`check_failed` sau agent ⇒ kết cục agent (`succeeded`).
Agent lỗi/hết giờ/huỷ ⇒ không báo cáo (Hub: thiếu báo cáo ⇒ `autofix_check_failed`).
"""

from __future__ import annotations

import asyncio
from contextlib import suppress
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from agent_runtime.autofix.check import run_checks
from agent_runtime.autofix.fake_oci import FakeOci
from agent_runtime.autofix.oci import Oci, OciCli, OciError
from agent_runtime.autofix.prep import (
    AutofixCfg,
    Box,
    EarlyFail,
    EarlyReport,
    install,
    load_snapshot,
    run_test,
    sandbox_spec,
)
from agent_runtime.autofix.report import Command, HubTarget, ReportMeta, build_report, post_result
from agent_runtime.autofix.rules import Failure, SandboxSpec
from agent_runtime.autofix.workspace import Workspace, WorkspaceError, copy_workspace, init_git
from agent_runtime.autofix.ws_tools import WsTarget, load_commands
from agent_runtime.contracts.hub import JobAttachment, JobPayload1
from agent_runtime.db.jobs_sql import ClaimedJob
from agent_runtime.events.job_events import Failure as JobFailure
from agent_runtime.log import bind_job, get_logger
from agent_runtime.runtimes.cli.files.fetch import (
    FetchFailed,
    FetchOk,
    FetchTimedOut,
    FilesCall,
    fetch_attachments,
)
from agent_runtime.runtimes.cli.job_run import JobRun, StopControl
from agent_runtime.runtimes.cli.outcome import CRASHED, TIMED_OUT, Verdict
from agent_runtime.runtimes.cli.runner import CliJobHost, FinishWriteFailed
from agent_runtime.runtimes.hub_http import make_hub_client
from agent_runtime.sources.snapshot import rmtree_ro

CONTAINER = JobFailure("failed", "INTERNAL_ERROR", "container", "autofix sandbox unavailable")
UPSTREAM = JobFailure("failed", "UPSTREAM_ERROR", "upstream", "autofix report undeliverable")
CHECK_EARLY = JobFailure("failed", "INTERNAL_ERROR", "sandbox", "autofix check failed before agent")
PATCH_SUBDIR = "autofix-in"  # `base_patch` tải về (ngoài workspace)
META_SUBDIR = "autofix-meta"  # nhật ký lệnh `ws` (ngoài workspace)
COMMANDS_FILE = "commands.jsonl"
_TOOLS = frozenset({"exec", "read", "write", "edit"})


class _Ended(Exception):  # noqa: N818 — job đã kết thúc/dừng trong pha chuẩn bị
    pass


def to_command(raw: dict[str, Any]) -> Command | None:
    tool, code = raw.get("tool"), raw.get("exit_code")
    if tool not in _TOOLS:
        return None
    exit_code = code if isinstance(code, int) and not isinstance(code, bool) else None
    ms = raw.get("ms")
    return Command(tool, str(raw.get("arg", "")), ms if isinstance(ms, int) else 0, exit_code)


class AutofixHost:
    """`TypedHost` cho job tự-sửa; job không có `autofix` ⇒ chuyển nguyên cho `CliJobHost`."""

    def __init__(self, cli: CliJobHost, oci: Oci | None, cfg: AutofixCfg) -> None:
        self.cli, self.oci, self.cfg = cli, oci, cfg

    async def run(self, job: ClaimedJob, control: StopControl) -> None:
        try:
            payload = JobPayload1.model_validate(job.payload)
        except ValidationError:
            payload = None
        if payload is None or payload.autofix is None:
            await self.cli.run(job, control)  # payload sai ⇒ `invalid_payload` như H1
            return
        with bind_job(job.id, job.run_id, str(payload.tenant_id)):
            if self.oci is None:
                get_logger().warning("autofix.sandbox_unavailable")
                await self.cli.finish_failed(job, CONTAINER)
                return
            run = AutofixJobRun(self, self.oci, job, payload, control)
            try:
                await run.execute()
            except FinishWriteFailed:
                raise
            except Exception as err:  # không để job `running` mãi (heartbeat)
                get_logger().error("job.host_failed", error=type(err).__name__)
                await self.cli.finish_failed(job, CRASHED)
            finally:
                await run.cleanup()


class AutofixJobRun(JobRun):
    """`JobRun` + pha chuẩn bị (`_prepare_files`) + kiểm/báo cáo trước "Kết thúc" (`_close`)."""

    def __init__(  # noqa: PLR0913
        self,
        af: AutofixHost,
        oci: Oci,
        job: ClaimedJob,
        payload: JobPayload1,
        control: StopControl,
    ) -> None:
        super().__init__(af.cli, job, payload, control)
        assert payload.autofix is not None
        self.af_cfg, self.oci, self.spec_af = af.cfg, oci, payload.autofix
        self.ws: Workspace | None = None
        self.sandbox: SandboxSpec | None = None
        self.agent_ctr: str | None = None
        self.reported = False

    # ---------- trước agent ----------

    async def _prepare_files(self) -> bool:
        if not await super()._prepare_files():
            return False
        log = get_logger()
        try:
            await self._prepare_autofix()
            return True
        except WorkspaceError as err:
            await self._report_early(EarlyReport(err.failure, err.base_sha))
        except EarlyReport as early:
            await self._report_early(early)
        except EarlyFail as fail:
            log.warning("autofix.prepare_failed", reason=fail.failure.message)
            await self.host.finish_failed(self.job, fail.failure)
        except OciError as err:
            log.warning("autofix.container_failed", reason=err.reason)
            await self.host.finish_failed(self.job, CONTAINER)
        except _Ended:
            pass
        return False

    async def _prepare_autofix(self) -> None:
        af, p = self.spec_af, self.payload
        snap = await load_snapshot(self.cfg.source_cfg, str(p.tenant_id), str(p.run_id), af.source)
        ws_dir = await asyncio.to_thread(
            copy_workspace, self.work, snap, af.source.key, self.af_cfg.caps
        )
        self.sandbox = sandbox_spec(self.af_cfg, self.job.id, ws_dir, self.cfg.work_root)
        if af.install_cmd is not None:
            await install(self._box(), ws_dir, af.install_cmd.root)
        patch = await self._fetch_patch(af.base_patch) if af.base_patch is not None else None
        self.ws = await asyncio.to_thread(init_git, self.work, ws_dir, af.branch, patch)
        self.agent_ctr = await self.oci.run(self.sandbox, "agent")
        self.ws_target = self._target(ws_dir, self.agent_ctr)

    def _box(self) -> Box:
        assert self.sandbox is not None
        return Box(self.oci, self.af_cfg, self.sandbox)

    def _target(self, ws_dir: Path, container: str) -> WsTarget:
        meta = self.work / META_SUBDIR
        meta.mkdir(mode=0o700, exist_ok=True)
        cfg, oci = self.af_cfg, self.oci
        fake = isinstance(oci, FakeOci)
        cli = oci if isinstance(oci, OciCli) else None
        return WsTarget(
            engine="fake" if fake or cli is None else cli.engine,
            container=container,
            ws_dir=str(ws_dir),
            log_path=str(meta / COMMANDS_FILE),
            exec_s=cfg.exec_s,
            max_ws_bytes=cfg.limits.max_ws_bytes,
            fake_dir=str(cfg.fake_dir) if fake and cfg.fake_dir is not None else None,
            cli_env=cli.cli_env() if cli is not None else {},
        )

    async def _fetch_patch(self, item: JobAttachment) -> Path:
        """PC-R11: tải `base_patch` bằng token job (như file đính kèm H2c)."""
        dest = self.work / PATCH_SUBDIR
        if dest.exists():
            await asyncio.to_thread(rmtree_ro, dest)
        dest.mkdir(mode=0o700)
        async with make_hub_client(self.cfg.hub_transport) as client:
            stop = self.control.stopped
            call = FilesCall(client, self.cfg.hub_url, self.job, self.deadline, stop)
            res = await fetch_attachments(call, [item], dest)
        if isinstance(res, FetchOk):
            return dest / item.name
        if isinstance(res, FetchFailed) and not self.stopping():
            detail = f"không tải được base_patch ({res.why})"
            raise EarlyReport(Failure("apply_patch", rule="fetch", detail=detail))
        if isinstance(res, FetchTimedOut):
            await self._close(Verdict(TIMED_OUT))
        else:
            await self._apply("stopped")
        raise _Ended

    async def _post(self, body: dict[str, Any]) -> bool:
        if not self.cfg.hub_url:
            get_logger().error("autofix.no_hub_url")
            return False
        target = HubTarget(self.cfg.hub_url, self.job.id, self.job.token)
        ok = await post_result(target, body, self.cfg.hub_transport)
        get_logger().info("autofix.report", status=body["status"], delivered=ok)
        return ok

    async def _report_early(self, early: EarlyReport) -> None:
        """Trượt trước agent: báo cáo `check_failed` (không diff, không test) rồi `failed`."""
        meta = ReportMeta(self.spec_af.branch, early.base_sha, (early.failure,))
        delivered = await self._post(build_report(meta, None))
        await self.host.finish_failed(self.job, CHECK_EARLY if delivered else UPSTREAM)

    # ---------- sau agent ----------

    async def _close(self, v: Verdict) -> None:
        if v.failure is None and self.ws is not None and not self.reported:
            self.reported = True
            v = await self._finish_round(v)
        await super()._close(v)

    async def _rm_agent(self) -> None:
        if self.agent_ctr is not None:
            name, self.agent_ctr = self.agent_ctr, None
            await self.oci.rm(name)

    async def _finish_round(self, v: Verdict) -> Verdict:
        """PC-R08 (1)–(4) + báo cáo TRƯỚC "Kết thúc" (plan §1 bước 6–7)."""
        assert self.ws is not None and self.sandbox is not None
        await self._rm_agent()
        af = self.spec_af
        allow = [a.root for a in af.write_allowlist]
        check = await asyncio.to_thread(run_checks, self.ws, allow, self.af_cfg.limits)
        test = None
        if not check.failures:
            try:
                test = await run_test(self._box(), af.test_cmd)
            except OciError as err:
                get_logger().warning("autofix.container_failed", reason=err.reason)
                return Verdict(CONTAINER)
        raw = await asyncio.to_thread(load_commands, self.work / META_SUBDIR / COMMANDS_FILE)
        cmds = [c for c in map(to_command, raw) if c is not None]
        body = build_report(ReportMeta(af.branch, self.ws.base_sha), check, test, cmds)
        return v if await self._post(body) else Verdict(UPSTREAM)

    async def cleanup(self) -> None:
        """Dọn container còn lại + `work/<job_id>/` (bản sao, git, patch, nhật ký)."""
        with suppress(Exception):
            await self._rm_agent()
        with suppress(OSError):
            await asyncio.to_thread(rmtree_ro, self.work)
