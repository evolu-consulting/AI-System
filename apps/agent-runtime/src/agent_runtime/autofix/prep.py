"""WRK-FR-28 · WRK-FR-29 · PC-R04 · PC-R05 · PC-R15 · P-c1 · Pha trước agent của job tự-sửa
(plan §1 bước 4, plan-runtime §5.2): snapshot `caps=autofix` → chép workspace → (có `install_cmd`)
container `prep` CÓ mạng chạy lệnh cài + `du` sau cài → `init_git` (+ `base_patch`) ở host.

Hai loại kết cục sớm: `EarlyReport` (trượt kiểm — vẫn POST báo cáo `check_failed`, không diff,
không test: `size` / `install` / `apply_patch`) và `EarlyFail` (job `failed`, không báo cáo: nguồn
không dựng được). `OciError` để host đổi thành `failed/container`. Lệnh qua `sh -c 'eval "$1"'`
(lệnh là đối số, không nội suy vào chuỗi argv), stderr gộp stdout.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from pathlib import Path

from agent_runtime.autofix.oci import ExecReq, ExecResult, Oci
from agent_runtime.autofix.report import TestRun
from agent_runtime.autofix.rules import Failure, Limits, Phase, SandboxSpec, clip_detail, redact
from agent_runtime.autofix.workspace import NULL_SHA, CopyCaps, dir_bytes
from agent_runtime.contracts.hub import Source, Source1
from agent_runtime.events.job_events import Failure as JobFailure
from agent_runtime.sources import mount, snapshot
from agent_runtime.sources.config import SourceConfig
from agent_runtime.sources.errors import SourceError

EVAL_CMD = 'eval "$1" 2>&1'
LOG_TAIL_BYTES = 256 * 1024
TOO_LARGE = "SOURCE_TOO_LARGE"
_MIB = 1024 * 1024


@dataclass(frozen=True)
class AutofixCfg:
    """Env sandbox (spec §7) — `main` dựng từ `Settings`."""

    image: str = "ai-autofix-sandbox:0.1.0"
    host_workdir: str | None = None  # `RUNTIME_SANDBOX_HOST_WORKDIR` (Runtime trong container)
    cpus: float = 2.0
    memory_mb: int = 2048
    pids: int = 512
    tmp_mb: int = 256
    exec_s: int = 120
    install_s: int = 600
    test_s: int = 900
    limits: Limits = Limits()
    caps: CopyCaps = CopyCaps()
    fake_dir: Path | None = None  # `RUNTIME_SANDBOX=fake`: HOME giả cho job host


class EarlyReport(Exception):  # noqa: N818 — kết cục, không phải lỗi lập trình
    """Trượt trước agent ⇒ báo cáo `check_failed{failure}` rồi kết thúc job."""

    def __init__(self, failure: Failure, base_sha: str = NULL_SHA) -> None:
        super().__init__(failure.check)
        self.failure = failure
        self.base_sha = base_sha


class EarlyFail(Exception):  # noqa: N818
    """Job `failed` không báo cáo (Hub: thiếu báo cáo ⇒ `autofix_check_failed`)."""

    def __init__(self, failure: JobFailure) -> None:
        super().__init__(failure.reason)
        self.failure = failure


def sandbox_spec(cfg: AutofixCfg, job_id: str, ws_dir: Path, work_root: Path) -> SandboxSpec:
    """`host_workspace` = đường dẫn engine thấy: `RUNTIME_SANDBOX_HOST_WORKDIR/<rel>` hoặc thật."""
    host_ws = str(ws_dir)
    if cfg.host_workdir:
        host_ws = str(Path(cfg.host_workdir) / ws_dir.relative_to(work_root))
    return SandboxSpec(
        job_id, cfg.image, host_ws, cpus=cfg.cpus, memory_mb=cfg.memory_mb, pids=cfg.pids,
        tmp_mb=cfg.tmp_mb,
    )  # fmt: skip


async def load_snapshot(
    src_cfg: SourceConfig | None, tenant: str, run_id: str, src: Source1
) -> Path:
    """Snapshot `caps=autofix` (PC-R04, dựng lười theo pin — PB-R16). Quá trần ⇒ `size`."""
    if src_cfg is None:
        msg = "source config missing"
        raise EarlyFail(JobFailure("failed", "INTERNAL_ERROR", "sandbox", msg))
    source = Source.model_validate(src.model_dump(mode="json"))
    try:
        snap = await asyncio.to_thread(mount.snapshot_for, src_cfg, tenant, source, "autofix")
    except SourceError as err:
        if err.code == TOO_LARGE:
            detail = clip_detail(f"snapshot vượt trần RUNTIME_AUTOFIX_MAX_MB/_FILES: {err}")
            raise EarlyReport(Failure("size", rule="autofix_snapshot", detail=detail)) from err
        failure = JobFailure("failed", "INTERNAL_ERROR", "sandbox", f"source: {err.code}")
        raise EarlyFail(failure) from err
    snapshot.add_ref(snap, run_id)
    return snap


def _tail_text(res: ExecResult) -> str:
    return (res.stdout + res.stderr).decode("utf-8", "replace")


@dataclass(frozen=True)
class Box:
    """Engine + cấu hình + `SandboxSpec` của một job (container dựng từ đây)."""

    oci: Oci
    cfg: AutofixCfg
    spec: SandboxSpec


async def run_in(box: Box, phase: Phase, cmd: str, timeout_s: int) -> ExecResult:
    """Container mới cho `phase`, chạy `cmd` (hết giờ ⇒ `exit_code=None`), luôn xoá container."""
    name = await box.oci.run(box.spec, phase)
    try:
        req = ExecReq(EVAL_CMD, (cmd,), None, float(timeout_s), LOG_TAIL_BYTES)
        return await box.oci.exec(name, req)
    finally:
        await box.oci.rm(name)


async def install(box: Box, ws_dir: Path, cmd: str) -> None:
    """PC-R15 pha cài (container `prep` có mạng); exit ≠ 0 / hết giờ ⇒ `install`; sau cài `du` >
    `RUNTIME_SANDBOX_DISK_MB` ⇒ `size` (ADR-0011 #3)."""
    cfg = box.cfg
    res = await run_in(box, "prep", cmd, cfg.install_s)
    if res.exit_code != 0:
        rule = "timeout" if res.exit_code is None else "exit_code"
        detail = clip_detail(f"install_cmd exit {res.exit_code}: {redact(_tail_text(res))[-400:]}")
        raise EarlyReport(Failure("install", rule=rule, detail=detail))
    used = await asyncio.to_thread(dir_bytes, ws_dir)
    if used > cfg.limits.max_ws_bytes:
        mb = cfg.limits.max_ws_bytes // _MIB
        detail = f"workspace sau pha cài > {mb} MiB (RUNTIME_SANDBOX_DISK_MB)"
        raise EarlyReport(Failure("size", rule="workspace_bytes", detail=detail))


async def run_test(box: Box, cmd: str) -> TestRun:
    """PC-R08(4): `test_cmd` trong container `test` MỚI (không mạng). Log thô — `report` che."""
    res = await run_in(box, "test", cmd, box.cfg.test_s)
    return TestRun(res.exit_code, res.ms, _tail_text(res))
