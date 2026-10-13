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
H2c PL9 (opt-in theo agent, `Write` ∈ `policy.tools`): ngoài luật trên, mọi đường dẫn của `Write`
phải sau `realpath` nằm **trực tiếp** trong `work/<job_id>/out/` (không thư mục con, không
`attachments/`, không gốc job; symlink trỏ ra ngoài bị bắt vì so `dirname(realpath(p))`) — sai ⇒
`path_not_allowed` nhãn `write_scope`; `Write` không có đường dẫn ⇒ deny. Review H2c v1 #6: `out/`
phải là thư mục thật (`S_ISDIR(lstat)`, không symlink) và — khi cha truyền `out_id` — đúng
(`st_dev`, `st_ino`) ghi lúc `prepare_job_dirs`; sai ⇒ `write_scope`.
Điều kiện an toàn (review H2c v1 #8, TOCTOU): hook kiểm đường dẫn **trước** khi CLI ghi; giữa hai
lúc đó không gì trong job được đổi `out/<tên>` thành symlink chỉ vì **không agent nào có tool tạo
symlink/đổi tên** (`Bash` luôn bị chặn; `Edit`/`NotebookEdit` không mở; `Write` chỉ tạo file
thường). Mở thêm tool có thể tạo symlink/đổi tên (hoặc chạy lệnh) phải xem lại luật này.
P-c1 §5.7 (job tự-sửa, có `work/<job>/workspace` hoặc `git/`): tool gốc có đường dẫn/mẫu mà
`realpath` nằm trong hai vùng đó (kể cả symlink trong `out/` trỏ vào) ⇒ deny nhãn `workspace`;
Grep từ thư mục cha của vùng cấm (gồm không `path` ⇒ cwd `work/<job>`) và Glob có đoạn wildcard
ngay dưới thư mục cha đó (`**/*.ts`, `*/x`) cũng deny — đọc `sources/` phải ghi rõ. Workspace
chỉ qua `mcp__ws__*` (`autofix/ws_tools.py`).
Deny trả lý do cố định, không lặp lại đường dẫn; log chỉ `tool_name`, nhãn, `job_id`.
Lỗi bất ngờ → deny (fail-closed).
"""

import os
import stat
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
WRITE_TOOL = "Write"  # H2c PL9: chỉ ghi trực tiếp trong `out/`
OUT_DIR = "out"


@dataclass(frozen=True)
class SandboxPolicy:
    job_id: str
    work_dir: Path
    forbidden_roots: tuple[Path, ...]
    tools: frozenset[str]
    structured_output: bool = False  # job có `output_format` (agent) ⇒ cho `StructuredOutput`
    # H2a §4.3: tên đầy đủ `mcp__hub__<k>` của `payload.mcp.tools` (job có MCP); rỗng = H1.
    mcp_tools: frozenset[str] = frozenset()
    # Review H2c v1 #6: (`st_dev`, `st_ino`) của `out/` lúc `prepare_job_dirs`; None = chỉ kiểm
    # `out/` là thư mục thật (không symlink).
    out_id: tuple[int, int] | None = None


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


PROTECTED_SUBDIRS = ("workspace", "git")  # P-c1 §5.7: chỉ `mcp__ws__*` chạm được
_SEARCH_TOOLS = frozenset({"Grep"})  # duyệt đệ quy từ `path`/cwd; Glob xét theo mẫu
_WILDCARDS = ("*", "?", "[", "{")
_WORKSPACE = HookDecision(allowed=False, reason="path_not_allowed", label="workspace")
_INVALID = HookDecision(allowed=False, reason="path_not_allowed", label="invalid")
_UNSAFE_PATTERN = HookDecision(allowed=False, reason="path_not_allowed", label="pattern")
_WRITE_SCOPE = HookDecision(allowed=False, reason="path_not_allowed", label="write_scope")


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


def out_dir_ok(out: Path, out_id: tuple[int, int] | None) -> bool:
    """`out/` là thư mục thật (lstat, không theo symlink) và đúng danh tính `out_id` (nếu có)."""
    try:
        st = out.lstat()
    except OSError:
        return False
    if not stat.S_ISDIR(st.st_mode):
        return False
    return out_id is None or (st.st_dev, st.st_ino) == out_id


def in_out_dir(raw: str, work_dir: Path, out_id: tuple[int, int] | None = None) -> bool:
    """PL9: `out/` hợp lệ (`out_dir_ok`) và `realpath(p)` nằm trực tiếp trong `realpath(work/out)`
    (sau `is_path_allowed`)."""
    out = work_dir / OUT_DIR
    if not out_dir_ok(out, out_id):
        return False
    joined = raw if os.path.isabs(raw) else os.path.join(work_dir, raw)
    target = os.path.realpath(joined)
    return os.path.dirname(target) == os.path.realpath(out)


def _protected_roots(work_dir: Path) -> list[str]:
    """P-c1 §5.7: `work/<job>/workspace` + `git` (chỉ khi tồn tại — job tự-sửa)."""
    dirs = (os.path.join(work_dir, d) for d in PROTECTED_SUBDIRS)
    return [os.path.realpath(d) for d in dirs if os.path.lexists(d)]


def _under(path: str, root: str) -> bool:
    return path == root or path.startswith(root.rstrip("/") + "/")


def _touches(path: str, roots: list[str]) -> bool:
    """`realpath(path)` nằm trong vùng cấm, hoặc là thư mục cha của vùng cấm (duyệt đệ quy)."""
    real = os.path.realpath(path)
    return any(_under(real, r) or _under(r, real) for r in roots)


def _pattern_touches(pattern: str, base: str, roots: list[str]) -> bool:
    """Glob: phần chữ trước đoạn wildcard đầu tiên (nối `base`) chạm vùng cấm ⇒ True."""
    full = pattern if os.path.isabs(pattern) else os.path.join(base, pattern)
    parts = full.split("/")
    for i, seg in enumerate(parts):
        if any(c in seg for c in _WILDCARDS):
            return _touches("/".join(parts[:i]) or "/", roots)
    return any(_under(os.path.realpath(full), r) for r in roots)


def _base_of(tool_input: Mapping[str, object], work_dir: Path) -> str:
    for key, value in tool_input.items():
        if "path" in key.lower() and isinstance(value, str) and value:
            return value if os.path.isabs(value) else os.path.join(work_dir, value)
    return str(work_dir)  # không `path` ⇒ cwd của CLI = work/<job>


def workspace_denied(
    policy: SandboxPolicy, tool_name: str, tool_input: Mapping[str, object]
) -> bool:
    """HUB-BR-33 · PC-R07: tool GỐC chạm `workspace/`/`git/` (so `realpath` — symlink trong `out/`
    trỏ vào cũng bị bắt); Grep từ thư mục cha vùng cấm (kể cả không `path`) / Glob wildcard ⇒ deny.
    Agent chỉ làm việc với workspace qua `mcp__ws__*` (đã cho ở `mcp_tools`, không tới đây)."""
    roots = _protected_roots(policy.work_dir)
    if not roots:
        return False
    base = _base_of(tool_input, policy.work_dir)
    if tool_name in _SEARCH_TOOLS and _touches(base, roots):
        return True
    for key, value in tool_input.items():
        low = key.lower()
        for item in _strings(value):
            if item is None:
                continue
            if "path" in low:
                joined = item if os.path.isabs(item) else os.path.join(policy.work_dir, item)
                if any(_under(os.path.realpath(joined), r) for r in roots):
                    return True
            elif (
                "glob" in low or ("pattern" in low and tool_name not in _PATTERN_FREE_TOOLS)
            ) and (_pattern_touches(item, base, roots)):
                return True
    return False


def decide(policy: SandboxPolicy, tool_name: str, tool_input: Mapping[str, object]) -> HookDecision:
    """Quyết định thuần cho một lần gọi tool."""
    if tool_name == STRUCTURED_OUTPUT_TOOL and policy.structured_output:
        return _ALLOW  # dữ liệu trả lời theo schema, không phải đường dẫn (S2)
    if tool_name in policy.mcp_tools:
        return _ALLOW  # đối số đi tới Hub/Dify, không chạm FS Worker — không kiểm path (§4.3)
    if _tool_denied(policy, tool_name):
        return HookDecision(allowed=False, reason="tool_not_allowed", label="tool")
    got = _decide_paths(policy, tool_name, tool_input)
    if got.allowed and workspace_denied(policy, tool_name, tool_input):
        return _WORKSPACE
    return got


def _decide_paths(
    policy: SandboxPolicy, tool_name: str, tool_input: Mapping[str, object]
) -> HookDecision:
    write = tool_name == WRITE_TOOL
    seen = False
    for raw in _candidates(tool_name, tool_input):
        if isinstance(raw, HookDecision):
            return raw
        got = is_path_allowed(raw, policy.work_dir, policy.forbidden_roots)
        if not got.allowed:
            return HookDecision(allowed=False, reason="path_not_allowed", label=got.reason)
        if write and not in_out_dir(raw, policy.work_dir, policy.out_id):
            return _WRITE_SCOPE
        seen = True
    return _WRITE_SCOPE if write and not seen else _ALLOW


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
