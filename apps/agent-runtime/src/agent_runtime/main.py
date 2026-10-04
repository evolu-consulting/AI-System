"""WRK-NFR-04 · WRK-BR-02 · Điểm vào `python -m agent_runtime` — vòng đời process cha
(plan-runtime §1.5). PY-03: config (sai → exit 2), log, chờ SIGTERM/SIGINT → exit 0; dịch vụ chết
→ exit 1 (systemd chạy lại). Chưa claim job.
"""

import asyncio
import signal
import socket
from collections.abc import Callable, Coroutine, Sequence
from typing import Any

from pydantic import ValidationError

from agent_runtime.config import Settings, load_settings
from agent_runtime.log import configure_logging, get_logger

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


def build_services(settings: Settings) -> list[Service]:
    # TODO(WRK-FR-01): PY-04+ — pool asyncpg + LISTEN, Redis ping, registry provider, manifest,
    # dọn job sót (§2.4), claimer/heartbeat/sweeper/cleanup (`settings.cleanup_s`).
    _ = settings
    return []


async def run(settings: Settings) -> int:
    log = get_logger()
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, stop.set)
    log.info("runtime.start", **settings.safe_summary())
    code = await serve(stop, build_services(settings))
    # TODO(WRK-FR-04): PY-04+ — ngừng claim, huỷ job đang chạy (§2.3) trước khi thoát (≤ 10 s).
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
    return asyncio.run(run(settings))
