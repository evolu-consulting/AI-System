"""WRK-FR-04 · WRK-BR-02 · Job host: `python -m agent_runtime.runtimes.cli.child --job-id=<id>`
(plan-runtime §1.2). Process group riêng, env tường minh, cwd `work/<job_id>`.

Đọc một dòng `ChildRequest` (stdin) → chạy provider từ registry → mỗi sự kiện một dòng stdout.
Không import `config`/`db`/`events` (import-linter): con không cầm secret.
"""

from __future__ import annotations

import asyncio
import os
import sys
from collections.abc import Sequence

from pydantic import ValidationError

from agent_runtime.providers.base import Fatal, ProviderEvent
from agent_runtime.providers.registry import get_provider
from agent_runtime.runtimes.cli.protocol import ChildRequest, encode_event

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


def main(argv: Sequence[str]) -> int:
    job_id = job_id_arg(argv)
    try:
        req = ChildRequest.model_validate_json(sys.stdin.buffer.readline())
    except ValidationError:
        asyncio.run(_emit(Fatal(code="INTERNAL_ERROR", msg="invalid child request")))
        return EXIT_BAD_REQUEST
    if job_id != req.job_id:
        asyncio.run(_emit(Fatal(code="INTERNAL_ERROR", msg="job id mismatch")))
        return EXIT_BAD_REQUEST
    asyncio.run(run(req))
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
