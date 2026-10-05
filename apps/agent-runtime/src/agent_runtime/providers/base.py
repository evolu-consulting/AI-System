"""WRK-FR-04 · WRK-BR-02 · Interface `Provider` chạy trong job host (plan-runtime §1.2, §3).

Provider nhận `ProviderJob` (payload contract + thư mục làm việc + `forbidden_roots`) và phát
`ProviderEvent` qua `emit`; job host ghi mỗi sự kiện thành một dòng JSON stdout (`ChildEvent`,
`runtimes/cli/protocol.py`). Kiểu sự kiện đặt ở đây (lớp `providers` nằm dưới `runtimes`).
Không import `config`/`db`/`events` (process con không cầm secret).
"""

from __future__ import annotations

import json
from collections.abc import Awaitable, Callable, Mapping, Sequence
from itertools import islice
from typing import Annotated, Any, Literal, Protocol, cast

from pydantic import BaseModel, ConfigDict, Field

from agent_runtime.contracts.hub import JobPayload1

CONFIRMATION_REQUIRED = "CONFIRMATION_REQUIRED"
CONFIRM_QUESTION_MAX = 2000


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


RAW_SHAPE_MAX_KEYS = 30
RAW_SHAPE_MAX_KEY = 60


def raw_shape(raw: Mapping[str, object] | None) -> dict[str, str] | None:
    """H3a-R04: khung `rate_limit_info.raw` — ≤ 30 khoá đầu (cắt 60 ký tự) → tên kiểu giá trị;
    **không** chép giá trị. None/không phải Mapping ⇒ None."""
    if not isinstance(raw, Mapping):
        return None
    items = islice(raw.items(), RAW_SHAPE_MAX_KEYS)
    return {str(k)[:RAW_SHAPE_MAX_KEY]: type(v).__name__ for k, v in items}


class RateLimit(_Ev):
    """H3a `rt §2`: `status` ∈ `allowed`/`allowed_warning`/`rejected`/`logged_out`; trường mới tuỳ
    chọn (dòng sự kiện cũ vẫn parse). Cha làm sạch `rate_limit_type`/`utilization` (`clean_*`)."""

    type: Literal["rate_limit"] = "rate_limit"
    status: str
    resets_at: int | None = None
    rate_limit_type: Annotated[str, Field(max_length=40)] | None = None
    utilization: float | None = None
    raw_shape: Annotated[dict[str, str], Field(max_length=RAW_SHAPE_MAX_KEYS)] | None = None


class UsageEv(_Ev):
    type: Literal["usage"] = "usage"
    input: int = Field(default=0, ge=0, alias="in")
    output: int = Field(default=0, ge=0, alias="out")
    cache_read: int = Field(default=0, ge=0)
    cache_write: int = Field(default=0, ge=0)
    model: str | None = None


class Delta(_Ev):
    """H2b WRK-FR-03 · R19 · mảnh chữ đã giải mã của `text` trong JSON kết quả (`StreamScanner`),
    chỉ khi `payload.stream` ∧ không phải lần thử lại; cha gom + XADD `job.delta` (PY-03)."""

    type: Literal["delta"] = "delta"
    kind: Literal["answer", "done", "partial"]
    text: Annotated[str, Field(min_length=1)]


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
    stop_reason: str | None = None  # TC-8 F4: Anthropic `stop_reason` (`"refusal"` = từ chối)


class Fatal(_Ev):
    type: Literal["fatal"] = "fatal"
    code: str
    msg: Annotated[str, Field(max_length=500)]
    reason: str | None = None


class Confirm(_Ev):
    """HUB-FR-95 · R21 · Hub từ chối tool `side_effect` chưa xác nhận (`plan-runtime` §5): cha
    ghi `seen.confirm` (giữ cái đầu) → `build_output` ép `need_input`, không thử lại."""

    type: Literal["confirm"] = "confirm"
    question: Annotated[str, Field(min_length=1, max_length=CONFIRM_QUESTION_MAX)]
    choices: tuple[str, str]


def _first_text(content: str | Sequence[Mapping[str, Any]]) -> str | None:
    """Khối text đầu tiên; `content` str (CLI `is_error`, spike S2: khối nối bằng xuống dòng) →
    phần trước dấu xuống dòng đầu tiên (`content[0]` là `JSON.stringify` một dòng)."""
    if isinstance(content, str):
        return content.split("\n", 1)[0]
    for block in content:
        if block.get("type") == "text":
            text = block.get("text")
            return text if isinstance(text, str) else None
    return None


def parse_confirmation(content: str | Sequence[Mapping[str, Any]]) -> Confirm | None:
    """§5 #2 · khối text đầu là JSON `{code: "CONFIRMATION_REQUIRED", question, choices}`
    (`question` str 1–2 000, `choices` đúng 2 str) → `Confirm`; khác → None. Câu chỉ dẫn và
    `structuredContent` bỏ qua."""
    text = _first_text(content)
    if not text:
        return None
    try:
        obj: object = json.loads(text)
    except ValueError:
        return None
    if not isinstance(obj, dict):
        return None
    data = cast(dict[str, object], obj)
    question, choices = data.get("question"), data.get("choices")
    if data.get("code") != CONFIRMATION_REQUIRED or not isinstance(question, str):
        return None
    if not 1 <= len(question) <= CONFIRM_QUESTION_MAX or not isinstance(choices, list):
        return None
    items = cast(list[object], choices)
    if len(items) != 2 or not all(isinstance(c, str) for c in items):
        return None
    return Confirm(question=question, choices=(str(items[0]), str(items[1])))


ProviderEvent = Progress | ToolUse | Session | RateLimit | UsageEv | Final | Fatal | Confirm | Delta
Emit = Callable[[ProviderEvent], Awaitable[None]]


class ProviderJob(BaseModel):
    """Đầu vào provider (con không đọc env cha): payload + `work_dir` + `forbidden_roots`."""

    model_config = ConfigDict(extra="forbid")

    payload: JobPayload1
    work_dir: str
    forbidden_roots: list[str]
    # PY-08: `claude-sub` đọc; runner điền — `resume_session_id` (PY-11, §6), `cli_path`
    # (`Settings.cli_path` = `AGENT_RT_CLI_PATH`, dự phòng §13; None = CLI đóng gói trong SDK).
    resume_session_id: str | None = None
    cli_path: str | None = None
    # PY-10: lần thử lại khi JSON agent hỏng — thay `payload.prompt`, `tools=[]` (WRK-BR-04).
    retry_prompt: str | None = None
    # H2a PY-04 (`plan-runtime` §4.2): file cấu hình MCP 0600 (`.mcp/<job_id>.json`, có token
    # claim) cha ghi khi agent có `payload.mcp` (không ở lần thử lại); None = không MCP.
    mcp_config_path: str | None = None
    # Review H2c v1 #6: (`st_dev`, `st_ino`) của `out/` lúc cha `prepare_job_dirs` (job agent);
    # hook `Write` so lại (`SandboxPolicy.out_id`). None = không `out/` / không so.
    out_dir_id: tuple[int, int] | None = None


class Provider(Protocol):
    key: str

    async def run(self, job: ProviderJob, emit: Emit) -> None: ...
