"""WRK-NFR-04 · WRK-BR-02 · Điểm vào `python -m agent_runtime` — vòng đời process cha
(plan-runtime §1.5). PY-03: config (sai → exit 2), log, chờ SIGTERM/SIGINT → exit 0; dịch vụ chết
→ exit 1 (systemd chạy lại). PY-04: khởi động hàng đợi (pool + LISTEN, manifest, dọn job sót),
dịch vụ claimer/listener/heartbeat/sweeper; SIGTERM → ngừng claim, job đang chạy → `orphaned`.
PY-06: Redis PING + XADD (`RunEvents`), job host process con (`CliJobHost`).
H2a PY-03: `JobRouter` theo `payload.type` — `agent.cli` → `CliJobHost`, `workflow.async` →
`DifyJobHost` (chỉ khi `dify` ∈ `AGENT_RT_PROVIDERS`, RT6).
"""

import asyncio
import signal
import socket
from collections.abc import Callable, Coroutine, Sequence
from typing import Any

from pydantic import ValidationError

from agent_runtime.config import Settings, load_settings
from agent_runtime.db.pool import Pool
from agent_runtime.events.job_events import RunEvents
from agent_runtime.log import configure_logging, get_logger
from agent_runtime.queue import runtime as queue_runtime
from agent_runtime.queue.runtime import QueueRuntime, UnknownProviders, registry_providers
from agent_runtime.runtimes.cli.runner import CliJobHost, HostConfig
from agent_runtime.runtimes.dify.host import DifyConfig, DifyJobHost
from agent_runtime.runtimes.dispatch import JobRouter, TypedHost
from agent_runtime.sandbox.process import disable_dumpable, enable_subreaper

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
        s.worker_id, s.work_dir, s.log_dir, s.home, s.app_env, s.kill_grace_s, stopping=stopping
    )


def dify_config(settings: Settings) -> DifyConfig | None:
    """None khi `dify` ∉ `AGENT_RT_PROVIDERS` (không claim job `dify`, RT6)."""
    s = settings
    if "dify" not in s.providers or not s.hub_url:
        return None
    return DifyConfig(
        s.worker_id, s.hub_url, s.dify_backoff_s, s.dify_read_timeout_s, s.dify_stop_timeout_s
    )


def make_router(
    pool: Pool, events: RunEvents, cfg: HostConfig, dify: DifyConfig | None
) -> JobRouter:
    cli = CliJobHost(pool, events, cfg)
    hosts: dict[str, TypedHost] = {"agent.cli": cli}
    if dify is not None:
        hosts["workflow.async"] = DifyJobHost(pool, events, dify)
    return JobRouter(hosts, default=cli)


async def start_queue(settings: Settings, stopping: asyncio.Event) -> QueueRuntime:
    """Bước 3–8 §1.5; job host thật + XADD `run:<id>`; subreaper (dự phòng §13, plan §2.3);
    không dumpable (review H1 #11). `stopping` = sự kiện SIGTERM (job host biết cha đang dừng)."""
    enable_subreaper()
    disable_dumpable()
    cfg = host_config(settings, stopping)
    dify = dify_config(settings)

    def make_host(pool: Pool, events: RunEvents) -> JobRouter:
        return make_router(pool, events, cfg, dify)

    return await queue_runtime.start(settings, make_host)


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
