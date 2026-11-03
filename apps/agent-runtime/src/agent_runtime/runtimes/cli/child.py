"""WRK-FR-04 · WRK-BR-02 · Job host: `python -m agent_runtime.runtimes.cli.child --job-id=<id>`
(plan-runtime §1.2). Process group riêng, env tường minh, cwd `work/<job_id>`.

Đọc một dòng `ChildRequest` (stdin) → chạy provider từ registry → mỗi sự kiện một dòng stdout.
Không import `config`/`db`/`events` (import-linter): con không cầm secret.
"""

from __future__ import annotations

import asyncio
import os
import sys
import tempfile
from collections.abc import Sequence

from pydantic import ValidationError

from agent_runtime.log import configure_logging
from agent_runtime.providers.base import Fatal, ProviderEvent
from agent_runtime.providers.registry import get_provider
from agent_runtime.runtimes.cli.protocol import (
    WARM_ENV_KEYS,
    WARM_FLAG,
    WARM_READY,
    ChildRequest,
    encode_event,
)

EXIT_OK = 0
EXIT_BAD_REQUEST = 2


async def _emit(event: ProviderEvent) -> None:
    sys.stdout.buffer.write(encode_event(event))
    sys.stdout.buffer.flush()


def job_id_arg(argv: Sequence[str]) -> str | None:
    for a in argv:
        if a.startswith("--job-id="):
            return a.removeprefix("--job-id=") or None
    return None


async def run(req: ChildRequest) -> None:
    provider = get_provider(req.payload.provider_key, os.environ.get("APP_ENV"))
    if provider is None:
        await _emit(
            Fatal(
                code="UPSTREAM_ERROR", msg="provider not available", reason="provider_unavailable"
            )
        )
        return
    try:
        await provider.run(req, _emit)
    except Exception as err:  # provider lỗi bất ngờ → fatal, không lộ chi tiết
        await _emit(Fatal(code="INTERNAL_ERROR", msg=f"provider error: {type(err).__name__}"))


def bind_warm(req: ChildRequest) -> bool:
    """CR-114: host `--warm` nhận job — cwd `work_dir` (orphans.py đối chiếu cwd), stderr → log
    job, env job (chỉ `WARM_ENV_KEYS`). Thiếu `warm` / env lạ → False (không chạy)."""
    bind = req.warm
    if bind is None or not set(bind.env) <= WARM_ENV_KEYS:
        return False
    os.chdir(req.work_dir)
    os.environ.update(bind.env)
    # `tempfile` cache thư mục tạm ở lần gọi đầu (có thể trước bind, khi TMPDIR còn là `work/.warm`
    # dùng chung) ⇒ xoá cache để lần sau đọc lại TMPDIR của job (không chung file tạm giữa job).
    tempfile.tempdir = None
    fd = os.open(bind.stderr_path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    try:
        os.dup2(fd, 2)
    finally:
        os.close(fd)
    return True


def _check(req: ChildRequest, argv: Sequence[str]) -> str | None:
    if WARM_FLAG in argv:
        return None if bind_warm(req) else "invalid warm bind"
    if req.warm is not None or job_id_arg(argv) != req.job_id:
        return "job id mismatch"
    return None


def main(argv: Sequence[str]) -> int:
    # stdout là kênh giao thức: log của con (vd hook sandbox) đi stderr.
    configure_logging("info", "child", sys.stderr)
    if WARM_FLAG in argv:  # module đã import xong (registry ⇒ SDK) — báo cha host sẵn sàng
        sys.stdout.buffer.write(WARM_READY)
        sys.stdout.buffer.flush()
    line = sys.stdin.buffer.readline()  # host `--warm`: chờ ở đây (đã import xong provider/SDK)
    if not line and WARM_FLAG in argv:  # stdin đóng, không có job (bể drain / cha chết)
        return EXIT_OK
    try:
        req = ChildRequest.model_validate_json(line)
    except ValidationError:
        asyncio.run(_emit(Fatal(code="INTERNAL_ERROR", msg="invalid child request")))
        return EXIT_BAD_REQUEST
    if (bad := _check(req, argv)) is not None:
        asyncio.run(_emit(Fatal(code="INTERNAL_ERROR", msg=bad)))
        return EXIT_BAD_REQUEST
    asyncio.run(run(req))
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
