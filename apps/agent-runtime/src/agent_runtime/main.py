"""WRK-NFR-04 · WRK-BR-02 · Điểm vào `python -m agent_runtime` — vòng đời process cha
(plan-runtime §1.5). PY-03: config (sai → exit 2), log, chờ SIGTERM/SIGINT → exit 0; dịch vụ chết
→ exit 1 (systemd chạy lại). PY-04: khởi động hàng đợi (pool + LISTEN, manifest, dọn job sót),
dịch vụ claimer/listener/heartbeat/sweeper; SIGTERM → ngừng claim, job đang chạy → `orphaned`.
PY-06: Redis PING + XADD (`RunEvents`), job host process con (`CliJobHost`).
H2a PY-03: `JobRouter` theo `payload.type` — `agent.cli` → `CliJobHost`, `workflow.async` →
`DifyJobHost` (chỉ khi `dify` ∈ `AGENT_RT_PROVIDERS`, RT6).
H3a PY-04: `ProbeHostCfg` từ `Settings` → vòng probe (`queue/probe_loop.py`) khi `PROBE_S>0`.
"""

import asyncio
import signal
import socket
import sys
from collections.abc import Callable, Coroutine, Sequence
from dataclasses import replace
from typing import Any

from pydantic import ValidationError

from agent_runtime.apply.host import ApplyCfg
from agent_runtime.autofix.host import AutofixHost
from agent_runtime.autofix.oci import SandboxCfg, open_sandbox
from agent_runtime.autofix.prep import AutofixCfg
from agent_runtime.autofix.rules import Limits
from agent_runtime.autofix.workspace import CopyCaps
from agent_runtime.config import Settings, load_settings
from agent_runtime.db.pool import Pool
from agent_runtime.events.job_events import RunEvents
from agent_runtime.log import configure_logging, get_logger
from agent_runtime.queue import runtime as queue_runtime
from agent_runtime.queue.runtime import QueueRuntime, UnknownProviders, registry_providers
from agent_runtime.runtimes.cli.probe import ProbeHostCfg
from agent_runtime.runtimes.cli.runner import CliJobHost, HostConfig
from agent_runtime.runtimes.dify.host import DifyConfig, DifyJobHost
from agent_runtime.runtimes.dispatch import JobRouter, TypedHost
from agent_runtime.runtimes.dlc.client import TokenSource
from agent_runtime.runtimes.dlc.host import PROVIDER_KEY as DLC_KEY
from agent_runtime.runtimes.dlc.host import DlcConfig, DlcJobHost
from agent_runtime.sandbox.process import disable_dumpable, enable_subreaper
from agent_runtime.sources import config as source_config

Service = Callable[[], Coroutine[Any, Any, None]]

EXIT_OK = 0
EXIT_TASK_FAILED = 1
EXIT_CONFIG = 2


class _Stopped(Exception):
    """Tín hiệu dừng sạch bên trong TaskGroup."""


def config_errors(err: ValidationError) -> list[str]:
    """Chỉ vị trí + loại lỗi — không kèm giá trị nhập (có thể là secret)."""
    return [".".join(str(p) for p in e["loc"]) + f": {e['type']}" for e in err.errors()]


async def serve(stop: asyncio.Event, services: Sequence[Service]) -> int:
    """Chạy các dịch vụ tới khi `stop` được đặt (→ 0) hoặc một dịch vụ lỗi (→ 1)."""
    log = get_logger()
    code = EXIT_OK

    async def wait_stop() -> None:
        await stop.wait()
        raise _Stopped

    try:
        async with asyncio.TaskGroup() as tg:
            for svc in services:
                tg.create_task(svc())
            tg.create_task(wait_stop())
    except* _Stopped:
        pass
    except* Exception as eg:
        log.error("runtime.task_failed", errors=[repr(e) for e in eg.exceptions])
        code = EXIT_TASK_FAILED
    return code


def build_services(rt: QueueRuntime) -> list[Service]:
    return rt.services()


def host_config(settings: Settings, stopping: asyncio.Event) -> HostConfig:
    s = settings
    return HostConfig(
        s.worker_id,
        s.work_dir,
        s.log_dir,
        s.home,
        s.app_env,
        s.kill_grace_s,
        stopping=stopping,
        delta_flush_ms=s.delta_flush_ms,
        delta_flush_chars=s.delta_flush_chars,
        hub_url=s.hub_url,
        cooldown_default_s=s.cooldown_default_s,
        source_cfg=source_config.load(),
    )


def sandbox_cfg(settings: Settings) -> SandboxCfg:
    """P-c1 plan-runtime §5.2: cấu hình tự kiểm sandbox lúc khởi động."""
    s = settings
    fake_dir = s.work_dir / ".fake-oci"
    return SandboxCfg(s.sandbox, s.sandbox_image, s.sandbox_memory_mb, s.app_env, fake_dir)


def autofix_cfg(settings: Settings) -> AutofixCfg:
    """P-c1 spec §7: env sandbox → `AutofixHost` (trần PC-R04, DISK_MB, thời hạn lệnh)."""
    s, mib = settings, 1024 * 1024
    return AutofixCfg(
        image=s.sandbox_image,
        host_workdir=s.sandbox_host_workdir,
        cpus=s.sandbox_cpus,
        memory_mb=s.sandbox_memory_mb,
        pids=s.sandbox_pids,
        tmp_mb=s.sandbox_tmp_mb,
        exec_s=s.sandbox_exec_s,
        install_s=s.sandbox_install_s,
        test_s=s.sandbox_test_s,
        limits=Limits(max_ws_bytes=s.sandbox_disk_mb * mib),
        caps=CopyCaps(max_files=s.autofix_max_files, max_bytes=s.autofix_max_mb * mib),
        fake_dir=s.work_dir / ".fake-oci",
    )


def apply_cfg(settings: Settings) -> ApplyCfg | None:
    """P-c2: job `source.apply` (plan-runtime §5.2). None ⇒ tính năng nguồn tắt (như resolve)."""
    src_cfg = source_config.load()
    if src_cfg is None:
        return None
    return ApplyCfg(
        source_cfg=src_cfg,
        af=autofix_cfg(settings),
        work_root=settings.work_dir,
        worker_id=settings.worker_id,
        sandbox_max=settings.sandbox_max,
        hub_url=settings.hub_url,
    )


def probe_host_config(settings: Settings) -> ProbeHostCfg:
    """H3a `rt §6` (PY-03e): cấu hình probe phía cha từ `Settings`."""
    s = settings
    return ProbeHostCfg(
        python=sys.executable,
        home=s.home,
        work_dir=s.work_dir,
        app_env=s.app_env,
        cli_path=str(s.cli_path) if s.cli_path is not None else None,
        kill_grace_s=s.kill_grace_s,
        timeout_s=float(s.probe_timeout_s),
        fake_file=s.fake_probe_file,
    )


def dify_config(settings: Settings) -> DifyConfig | None:
    """None khi `dify` ∉ `AGENT_RT_PROVIDERS` (không claim job `dify`, RT6)."""
    s = settings
    if "dify" not in s.providers or not s.hub_url:
        return None
    return DifyConfig(
        s.worker_id, s.hub_url, s.dify_backoff_s, s.dify_read_timeout_s, s.dify_stop_timeout_s
    )


def dlc_config(settings: Settings) -> DlcConfig | None:
    """None khi `dlc` ∉ `AGENT_RT_PROVIDERS` (DLC-R01)."""
    s = settings
    if DLC_KEY not in s.providers or not s.dlc_url:
        return None
    tokens = None
    if s.dlc_token_url and s.dlc_client_id and s.dlc_client_secret:
        ca = str(s.dlc_ca_file) if s.dlc_ca_file else None
        secret = s.dlc_client_secret.get_secret_value()
        tokens = TokenSource(s.dlc_token_url, s.dlc_client_id, secret, ca)
    return DlcConfig(s.worker_id, s.dlc_url, s.hub_url, tokens, s.dlc_poll_s, s.dlc_human_mode)


def make_router(
    pool: Pool,
    events: RunEvents,
    cfg: HostConfig,
    extra: tuple[DifyConfig | None, DlcConfig | None] = (None, None),
    autofix: AutofixCfg | None = None,
) -> JobRouter:
    dify, dlc = extra
    cli = CliJobHost(pool, events, cfg)
    hosts: dict[str, TypedHost] = {"agent.cli": cli}
    if dify is not None:
        hosts["workflow.async"] = DifyJobHost(pool, events, dify)
    by_provider: dict[str, TypedHost] = {}
    if dlc is not None:
        by_provider[DLC_KEY] = DlcJobHost(pool, events, dlc)
    fix = AutofixHost(cli, cfg.sandbox, autofix or AutofixCfg())  # P-c1: luôn có (off ⇒ container)
    return JobRouter(hosts, default=cli, autofix=fix, by_provider=by_provider)


async def start_queue(settings: Settings, stopping: asyncio.Event) -> QueueRuntime:
    """Bước 3–8 §1.5; job host thật + XADD `run:<id>`; subreaper (dự phòng §13, plan §2.3);
    không dumpable (review H1 #11). `stopping` = sự kiện SIGTERM (job host biết cha đang dừng)."""
    enable_subreaper()
    disable_dumpable()
    cfg = host_config(settings, stopping)
    cfg = replace(cfg, sandbox=await open_sandbox(sandbox_cfg(settings)))
    extra = (dify_config(settings), dlc_config(settings))

    def make_host(pool: Pool, events: RunEvents) -> JobRouter:
        return make_router(pool, events, cfg, extra, autofix_cfg(settings))

    probe = probe_host_config(settings)
    return await queue_runtime.start(settings, make_host, probe, cfg.sandbox, apply_cfg(settings))


async def _start_unless_stopped(settings: Settings, stop: asyncio.Event) -> QueueRuntime | None:
    """Khởi động (bước 3–8 §1.5); SIGTERM lúc đang khởi động → None (thoát 0)."""
    starting = asyncio.create_task(start_queue(settings, stop))
    stopping = asyncio.create_task(stop.wait())
    await asyncio.wait({starting, stopping}, return_when=asyncio.FIRST_COMPLETED)
    stopping.cancel()
    if starting.done():
        return starting.result()
    starting.cancel()
    await asyncio.gather(starting, return_exceptions=True)
    return None


async def run(settings: Settings) -> int:
    log = get_logger()
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        # Cờ đặt ngay trong handler: job host chết cùng lúc (systemd) đọc được trước `shutdown`.
        loop.add_signal_handler(sig, stop.set)
    log.info("runtime.start", **settings.safe_summary())
    try:
        rt = await _start_unless_stopped(settings, stop)
    except Exception as err:  # DB không tới/sai quyền → exit 1, systemd chạy lại
        log.error("runtime.startup_failed", error=type(err).__name__)
        return EXIT_TASK_FAILED
    code = EXIT_OK
    if rt is not None:
        try:
            code = await serve(stop, build_services(rt))
        finally:
            await rt.shutdown()
    log.info("runtime.stop", exit_code=code)
    return code


def main() -> int:
    try:
        settings = load_settings()
    except ValidationError as err:
        configure_logging("info", worker_id=socket.gethostname())
        get_logger().error("runtime.config_invalid", errors=config_errors(err))
        return EXIT_CONFIG
    configure_logging(settings.log_level, worker_id=settings.worker_id)
    try:
        registry_providers(settings)
    except UnknownProviders as err:  # khoá do người vận hành đặt, không phải secret
        get_logger().error("runtime.config_invalid", errors=[f"AGENT_RT_PROVIDERS: {err.keys}"])
        return EXIT_CONFIG
    return asyncio.run(run(settings))
