"""WRK-FR-04 · WRK-BR-02 · Giao thức cha ↔ job host (plan-runtime §1.2).

stdin = một dòng JSON `ChildRequest`; stdout = JSON lines `ChildEvent`; stderr → file log job.
Cha validate từng dòng bằng pydantic; dòng hỏng → coi như `fatal`.
"""

from __future__ import annotations

from typing import Annotated

from pydantic import Field, TypeAdapter, ValidationError

from agent_runtime.providers.base import (
    Confirm,
    Fatal,
    Final,
    Progress,
    ProviderEvent,
    ProviderJob,
    RateLimit,
    Session,
    ToolUse,
    UsageEv,
)

CHILD_MODULE = "agent_runtime.runtimes.cli.child"
MAX_LINE_BYTES = 1 << 20  # final có thể chứa tới 64 000 ký tự (UTF-8 ≤ 4 byte)


class ChildRequest(ProviderJob):
    """`ProviderJob` + `job_id` (đối chiếu `--job-id`)."""

    job_id: str


ChildEvent = Annotated[
    Progress | ToolUse | Session | RateLimit | UsageEv | Final | Fatal | Confirm,
    Field(discriminator="type"),
]
_EVENT: TypeAdapter[ProviderEvent] = TypeAdapter(ChildEvent)
# Lỗi giao thức phía cha (review H1 #10): cùng một đối tượng để runner nhận ra bằng `is`.
INVALID_EVENT = Fatal(code="INTERNAL_ERROR", msg="invalid child event")
EVENT_TOO_LARGE = Fatal(code="INTERNAL_ERROR", msg="child event too large")


def encode_event(event: ProviderEvent) -> bytes:
    return event.model_dump_json(by_alias=True).encode() + b"\n"


def parse_event(line: bytes) -> ProviderEvent:
    """Dòng hỏng → `Fatal(INTERNAL_ERROR)` (không lặp lại nội dung dòng)."""
    try:
        return _EVENT.validate_json(line)
    except ValidationError:
        return INVALID_EVENT


def child_argv(python: str, job_id: str) -> list[str]:
    """Cmdline có cả module và `--job-id=<id>` (queue/orphans.py dựa vào để dọn group sót)."""
    return [python, "-m", CHILD_MODULE, f"--job-id={job_id}"]
