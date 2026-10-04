"""WRK-BR-07 · WRK-FR-12 · AC-W11 · Hook `PreToolUse` chặn đường dẫn + tool (plan-runtime §5.2).

Không phụ thuộc SDK: nhận/trả dict đúng hình `HookCallback` của Claude Agent SDK, nên provider
`claude-sub` (PY-08) gắn qua `HookMatcher` và `fake-cli` (PY-09) gọi trực tiếp.
Đã xác minh ở spike PY-02 (`spike-py02.md` #1, #3): `Read {file_path}` (CLI đổi sang tuyệt đối),
`Grep {pattern, path?, glob?}`, `Glob {pattern, path?}` (`path` giữ tương đối), không có `LS`;
Glob **có** mở rộng brace và lớp ký tự. Vẫn kiểm mọi giá trị chuỗi của khoá chứa `path`; khoá
chứa `glob` (và `pattern`, trừ `Grep` — ở đó là regex nội dung) **fail-closed**: chứa `..` ở bất
kỳ đâu hoặc `{` (brace `{..}/{..}/x`, `{..,a}/**` — review H1 #3), `[` (`[.][.]`), backslash,
đoạn `.` + `?`/`*` hoặc đoạn khớp `..` khi wildcard ăn cả `.` (`?.`, `*.*`; trừ `*`/`**`) → deny
(review H1 v2 N3; đánh đổi: chặn cả mẫu vô hại như `.*rc`, `*.*`, lớp ký tự); tuyệt đối / `~` →
kiểm như đường dẫn. `StructuredOutput` (tool CLI thêm khi có `output_format`, S2) chỉ được phép khi
`policy.structured_output` (job agent), không có trường đường dẫn. H2a §4.3: tool MCP Hub
`mcp__hub__<k>` ∈ `policy.mcp_tools` → allow (= `{}`, không `permissionDecision:"allow"` — spike
S5: `dontAsk` + `allowed_tools` vẫn là hàng rào sau hook), không kiểm path; `mcp__*` khác → deny.
Deny trả lý do cố định, không lặp lại đường dẫn; log chỉ `tool_name`, nhãn, `job_id`.
Lỗi bất ngờ → deny (fail-closed).
"""

from collections.abc import Awaitable, Callable, Iterator, Mapping
from dataclasses import dataclass
from fnmatch import fnmatchcase
from pathlib import Path
from typing import Literal

from agent_runtime.log import get_logger
from agent_runtime.sandbox.paths import is_path_allowed

HookReason = Literal["path_not_allowed", "tool_not_allowed"]
HookOutput = dict[str, object]
PathGuard = Callable[[Mapping[str, object], str | None, object], Awaitable[HookOutput]]

ALWAYS_DENIED = frozenset({"Bash", "Agent", "Task"})
_DENIED_PREFIXES = ("mcp__",)
_PATTERN_FREE_TOOLS = frozenset({"Grep"})
STRUCTURED_OUTPUT_TOOL = "StructuredOutput"


@dataclass(frozen=True)
class SandboxPolicy:
    job_id: str
    work_dir: Path
    forbidden_roots: tuple[Path, ...]
    tools: frozenset[str]
    structured_output: bool = False  # job có `output_format` (agent) ⇒ cho `StructuredOutput`
    # H2a §4.3: tên đầy đủ `mcp__hub__<k>` của `payload.mcp.tools` (job có MCP); rỗng = H1.
    mcp_tools: frozenset[str] = frozenset()


@dataclass(frozen=True)
class HookDecision:
    allowed: bool
    reason: HookReason | None = None
    label: str | None = None


_ALLOW = HookDecision(allowed=True)


def _tool_denied(policy: SandboxPolicy, tool_name: str) -> bool:
    if tool_name in ALWAYS_DENIED or tool_name.startswith(_DENIED_PREFIXES):
        return True
    return tool_name not in policy.tools


_INVALID = HookDecision(allowed=False, reason="path_not_allowed", label="invalid")
_UNSAFE_PATTERN = HookDecision(allowed=False, reason="path_not_allowed", label="pattern")


_UNSAFE_PARTS = ("..", "{", "[", "\\")  # `[.][.]`, `\.\.` cũng ra `..` (review H1 v2 N3)
_STAR_SEGMENTS = frozenset({"*", "**"})  # globber không trả `..` cho `*`/`**`


def _segment_unsafe(seg: str) -> bool:
    """Đoạn có thể khớp `..`: `.` + `?`/`*` (`.?`, `.*`), hoặc khớp `..` khi `?`/`*` ăn cả `.`."""
    if seg[:1] == "." and seg[1:2] in ("?", "*"):
        return True
    return seg not in _STAR_SEGMENTS and fnmatchcase("..", seg)


def _pattern_unsafe(value: str) -> bool:
    if any(p in value for p in _UNSAFE_PARTS):
        return True
    return any(_segment_unsafe(seg) for seg in value.split("/"))


def _pattern_is_path(value: str) -> bool:
    return value.startswith(("/", "~"))


def _strings(value: object) -> Iterator[str | None]:
    """Chuỗi cần kiểm trong một giá trị; `None` = kiểu lạ (fail-closed)."""
    if isinstance(value, str):
        yield value
    elif isinstance(value, list | tuple):
        for item in value:  # pyright: ignore[reportUnknownVariableType]
            yield item if isinstance(item, str) else None
    elif value is not None:
        yield None


def _candidates(tool_name: str, tool_input: Mapping[str, object]) -> Iterator[str | HookDecision]:
    """Đường dẫn cần `is_path_allowed`, hoặc quyết định deny sẵn (kiểu lạ, mẫu không an toàn)."""
    for key, value in tool_input.items():
        low = key.lower()
        if "path" in low:
            yield from (_INVALID if item is None else item for item in _strings(value))
        elif "glob" in low or ("pattern" in low and tool_name not in _PATTERN_FREE_TOOLS):
            for item in _strings(value):
                if item is None:
                    yield _INVALID
                elif _pattern_unsafe(item):
                    yield _UNSAFE_PATTERN
                elif _pattern_is_path(item):
                    yield item


def decide(policy: SandboxPolicy, tool_name: str, tool_input: Mapping[str, object]) -> HookDecision:
    """Quyết định thuần cho một lần gọi tool."""
    if tool_name == STRUCTURED_OUTPUT_TOOL and policy.structured_output:
        return _ALLOW  # dữ liệu trả lời theo schema, không phải đường dẫn (S2)
    if tool_name in policy.mcp_tools:
        return _ALLOW  # đối số đi tới Hub/Dify, không chạm FS Worker — không kiểm path (§4.3)
    if _tool_denied(policy, tool_name):
        return HookDecision(allowed=False, reason="tool_not_allowed", label="tool")
    for raw in _candidates(tool_name, tool_input):
        if isinstance(raw, HookDecision):
            return raw
        got = is_path_allowed(raw, policy.work_dir, policy.forbidden_roots)
        if not got.allowed:
            return HookDecision(allowed=False, reason="path_not_allowed", label=got.reason)
    return _ALLOW


def deny_output(reason: HookReason) -> HookOutput:
    return {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }


def _decide_input(policy: SandboxPolicy, input_data: Mapping[str, object]) -> HookDecision:
    tool_name = input_data.get("tool_name")
    tool_input = input_data.get("tool_input", {})
    if not isinstance(tool_name, str) or not isinstance(tool_input, Mapping):
        return HookDecision(allowed=False, reason="tool_not_allowed", label="invalid")
    return decide(policy, tool_name, tool_input)  # pyright: ignore[reportUnknownArgumentType]


def make_path_guard(policy: SandboxPolicy) -> PathGuard:
    """Hook `PreToolUse` của một job: allow → `{}` (để luồng quyền bình thường), deny → dict
    `hookSpecificOutput` với lý do cố định."""

    async def path_guard(
        input_data: Mapping[str, object], _tool_use_id: str | None, _context: object
    ) -> HookOutput:
        try:
            got = _decide_input(policy, input_data)
        except Exception:  # noqa: BLE001 — fail-closed
            got = HookDecision(allowed=False, reason="path_not_allowed", label="error")
        if got.allowed:
            return {}
        reason: HookReason = got.reason or "path_not_allowed"
        tool = input_data.get("tool_name")
        get_logger().warning(
            "sandbox_deny",
            tool_name=tool if isinstance(tool, str) else "?",
            reason=reason,
            label=got.label,
            job_id=policy.job_id,
        )
        return deny_output(reason)

    return path_guard
