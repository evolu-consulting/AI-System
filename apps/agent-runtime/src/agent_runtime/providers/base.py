"""WRK-FR-04 · WRK-BR-02 · Interface `Provider` chạy trong job host (plan-runtime §1.2, §3).

Provider nhận `ProviderJob` (payload contract + thư mục làm việc + `forbidden_roots`) và phát
`ProviderEvent` qua `emit`; job host ghi mỗi sự kiện thành một dòng JSON stdout (`ChildEvent`,
`runtimes/cli/protocol.py`). Kiểu sự kiện đặt ở đây (lớp `providers` nằm dưới `runtimes`).
Không import `config`/`db`/`events` (process con không cầm secret).
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Annotated, Any, Literal, Protocol

from pydantic import BaseModel, ConfigDict, Field

from agent_runtime.contracts.hub import JobPayload1


class _Ev(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class Progress(_Ev):
    type: Literal["progress"] = "progress"
    label: Annotated[str, Field(min_length=1, max_length=200)]


class ToolUse(_Ev):
    type: Literal["tool_use"] = "tool_use"
    name: Annotated[str, Field(min_length=1, max_length=200)]


class Session(_Ev):
    type: Literal["session"] = "session"
    session_id: Annotated[str, Field(min_length=1, max_length=200)]


class RateLimit(_Ev):
    type: Literal["rate_limit"] = "rate_limit"
    status: str
    resets_at: int | None = None


class UsageEv(_Ev):
    type: Literal["usage"] = "usage"
    input: int = Field(default=0, ge=0, alias="in")
    output: int = Field(default=0, ge=0, alias="out")
    cache_read: int = Field(default=0, ge=0)
    cache_write: int = Field(default=0, ge=0)
    model: str | None = None


class Final(_Ev):
    """Kết quả cuối. `kind`: `agent_result` (dùng `structured`) | `text` (dùng `text`)."""

    type: Literal["final"] = "final"
    kind: Literal["agent_result", "text"]
    raw_json: str | None = None
    structured: dict[str, Any] | None = None
    text: str | None = None
    is_error: bool = False
    subtype: str | None = None
    api_error_status: int | None = None
    errors: list[str] = Field(default_factory=list[str])


class Fatal(_Ev):
    type: Literal["fatal"] = "fatal"
    code: str
    msg: Annotated[str, Field(max_length=500)]
    reason: str | None = None


ProviderEvent = Progress | ToolUse | Session | RateLimit | UsageEv | Final | Fatal
Emit = Callable[[ProviderEvent], Awaitable[None]]


class ProviderJob(BaseModel):
    """Đầu vào provider (con không đọc env cha): payload + `work_dir` + `forbidden_roots`."""

    model_config = ConfigDict(extra="forbid")

    payload: JobPayload1
    work_dir: str
    forbidden_roots: list[str]


class Provider(Protocol):
    key: str

    async def run(self, job: ProviderJob, emit: Emit) -> None: ...
