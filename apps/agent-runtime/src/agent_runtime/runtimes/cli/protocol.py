"""WRK-FR-04 · WRK-BR-02 · Giao thức cha ↔ job host (plan-runtime §1.2).

stdin = một dòng JSON `ChildRequest`; stdout = JSON lines `ChildEvent`; stderr → file log job.
Cha validate từng dòng bằng pydantic; dòng hỏng → coi như `fatal`.
"""

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, ValidationError

from agent_runtime.providers.base import (
    Confirm,
    Delta,
    Fatal,
    Final,
    Models,
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


WARM_FLAG = "--warm"
# Host `--warm` ghi đúng dòng này khi đã import xong (trước khi chờ stdin); `warm_host.spawn_warm`
# đọc nuốt nó — `HostProcess` không bao giờ thấy (không phải `ChildEvent`).
WARM_READY = b'{"warm":"ready"}\n'
# CR-114: biến env phụ thuộc job mà host dựng sẵn được nhận lúc gắn job (danh sách trắng).
WARM_ENV_KEYS = frozenset({"TMPDIR", "MCP_TOOL_TIMEOUT"})


class WarmBind(BaseModel):
    """CR-114: gắn host `--warm` vào job — cwd = `work_dir`, stderr → log job, env của job."""

    model_config = ConfigDict(extra="forbid")

    stderr_path: str
    env: dict[str, str]


class ChildRequest(ProviderJob):
    """`ProviderJob` + `job_id` (đối chiếu `--job-id`); `warm` chỉ khi host dựng sẵn (CR-114)."""

    job_id: str
    warm: WarmBind | None = None


ChildEvent = Annotated[
    Progress | ToolUse | Session | RateLimit | UsageEv | Final | Fatal | Confirm | Delta | Models,
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


def warm_argv(python: str) -> list[str]:
    """CR-114: host dựng sẵn chưa biết job — orphans.py nhận ra nó qua `--warm` + cwd `<job_id>`."""
    return [python, "-m", CHILD_MODULE, WARM_FLAG]
