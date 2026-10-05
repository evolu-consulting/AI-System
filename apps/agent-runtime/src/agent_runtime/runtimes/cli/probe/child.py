"""WRK-FR-22 · WRK-BR-02 · Điểm vào process con probe (plan-runtime H3a §4.2):
`python -m agent_runtime.runtimes.cli.probe.child --provider=<key>`.

Đọc một dòng `ProbeRequest` (stdin) → `provider.probe(req, emit)` → mỗi sự kiện một dòng stdout
(giao thức như job host, `protocol.py`). stderr của con = `DEVNULL` ở cha (PL9). Không import
`config`/`db`/`events` (import-linter): con không cầm secret.
"""

from __future__ import annotations

import asyncio
import os
import sys
from collections.abc import Sequence

from pydantic import ValidationError

from agent_runtime.log import configure_logging
from agent_runtime.providers.base import Fatal, ProbeRequest, ProviderEvent
from agent_runtime.providers.registry import get_provider
from agent_runtime.runtimes.cli.protocol import encode_event

EXIT_OK = 0
EXIT_BAD_REQUEST = 2


async def _emit(event: ProviderEvent) -> None:
    sys.stdout.buffer.write(encode_event(event))
    sys.stdout.buffer.flush()


def provider_arg(argv: Sequence[str]) -> str | None:
    for a in argv:
        if a.startswith("--provider="):
            return a.removeprefix("--provider=") or None
    return None


async def run(req: ProbeRequest) -> None:
    provider = get_provider(req.provider_key, os.environ.get("APP_ENV"))
    if provider is None:
        await _emit(
            Fatal(
                code="UPSTREAM_ERROR", msg="provider not available", reason="provider_unavailable"
            )
        )
        return
    try:
        await provider.probe(req, _emit)
    except Exception as err:  # provider lỗi bất ngờ → fatal, không lộ chi tiết
        await _emit(Fatal(code="INTERNAL_ERROR", msg=f"provider error: {type(err).__name__}"))


def main(argv: Sequence[str]) -> int:
    configure_logging("info", "probe", sys.stderr)  # stdout là kênh giao thức
    key = provider_arg(argv)
    try:
        req = ProbeRequest.model_validate_json(sys.stdin.buffer.readline())
    except ValidationError:
        asyncio.run(_emit(Fatal(code="INTERNAL_ERROR", msg="invalid probe request")))
        return EXIT_BAD_REQUEST
    if key != req.provider_key:
        asyncio.run(_emit(Fatal(code="INTERNAL_ERROR", msg="provider mismatch")))
        return EXIT_BAD_REQUEST
    asyncio.run(run(req))
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
