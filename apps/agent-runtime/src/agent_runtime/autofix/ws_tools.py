"""WRK-FR-28 · HUB-BR-32 · HUB-BR-33 · P-c1 · Tool `ws` của agent tự-sửa (plan-runtime §5.5).

Bốn thao tác trên workspace, MỌI lệnh chạy bằng `exec` vào container `aif-<job>` của job (không
chạm FS host từ tiến trình con, trừ `du` đo trần): `ws_exec{cmd, timeout_s}` ·
`ws_read{path, offset, limit}` · `ws_write{path, content}` (nội dung qua stdin
`sh -c 'cat > "$1"' _ <path>`) · `ws_edit{path, old_string, new_string, replace_all}` (đọc → thay
trong Python → ghi lại; không khớp / khớp nhiều ⇒ lỗi như Edit). Mọi `path` qua `rules.ws_rel_ok`.
Sau mỗi `ws_exec`: workspace > trần ⇒ trả lỗi cho agent (cha kiểm lại `size` ở PC-R08).

Chạy trong job host (process con): `WsTarget` đi qua `ChildRequest.ws`; không phụ thuộc SDK —
`providers/claude/ws.py` bọc thành MCP trong tiến trình (`create_sdk_mcp_server`, tên
`mcp__ws__*`), `fake-cli` gọi thẳng (`#fake:ws_*`). Mỗi thao tác ghi một dòng JSON vào `log_path`
(ngoài workspace) ⇒ cha dựng `commands[]` của báo cáo. Không log nội dung file/lệnh/output.
"""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from agent_runtime.autofix.oci import ExecReq, ExecResult, Oci, OciCli
from agent_runtime.autofix.rules import CMD_MAX, ws_rel_ok
from agent_runtime.autofix.workspace import dir_bytes

WS_SERVER = "ws"
WS_TOOLS = ("ws_exec", "ws_read", "ws_write", "ws_edit")
EXEC_CMD_MAX = 4000
EXEC_TIMEOUT_MAX_S = 600
READ_LINES_MAX = 2000
READ_BYTES_MAX = 256 * 1024
WRITE_BYTES_MAX = 1024 * 1024
OUT_TAIL_BYTES = 32 * 1024
FILE_TIMEOUT_S = 60.0
_WRITE_CMD = 'mkdir -p -- "$(dirname -- "$1")" && cat > "$1"'
_READ_CMD = 'head -c "$2" -- "$1"'

Tool = Literal["exec", "read", "write", "edit"]


class WsTarget(BaseModel):
    """Đích `ws` của một job — cha điền (`AutofixHost`), con dùng."""

    model_config = ConfigDict(extra="forbid")

    engine: Literal["docker", "podman", "fake"]
    container: Annotated[str, Field(pattern=r"^aif-[0-9a-f-]{36}$")]
    ws_dir: str  # đường dẫn workspace trên FS Runtime (đo `du`; `fake` chạy lệnh tại đây)
    log_path: str  # JSON lines `{tool, arg, ms, exit_code?}` (ngoài workspace)
    exec_s: Annotated[int, Field(ge=1, le=EXEC_TIMEOUT_MAX_S)] = 120
    max_ws_bytes: Annotated[int, Field(ge=1)]
    fake_dir: str | None = None  # `fake`: HOME giả (`<work_root>/.fake-oci`)
    cli_env: dict[str, str] = Field(default_factory=dict[str, str])  # DOCKER_HOST… (không secret)


class WsError(Exception):
    """Lỗi trả cho agent (`is_error`); `code` ngắn, không chứa nội dung file."""

    def __init__(self, code: str, detail: str = "") -> None:
        super().__init__(f"{code}: {detail}" if detail else code)
        self.code = code


def ws_tool_names() -> list[str]:
    return [f"mcp__{WS_SERVER}__{t}" for t in WS_TOOLS]


def backend(t: WsTarget) -> Oci:
    if t.engine == "fake":
        from agent_runtime.autofix.fake_oci import FakeOci  # chỉ APP_ENV=test (cha đã gác)

        fake = FakeOci(Path(t.fake_dir or t.ws_dir))
        fake.attach(t.container, Path(t.ws_dir))
        return fake
    return OciCli(t.engine, env=t.cli_env)


def _text(raw: bytes) -> str:
    return raw.decode("utf-8", "replace")


def _rel(path: str) -> str:
    if not ws_rel_ok(path):
        raise WsError("bad_path", "đường dẫn phải tương đối trong workspace")
    return path


def load_commands(log_path: Path) -> list[dict[str, Any]]:
    """Cha đọc nhật ký lệnh (dòng hỏng bỏ qua)."""
    try:
        lines = log_path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return []
    out: list[dict[str, Any]] = []
    for line in lines:
        try:
            item = json.loads(line)
        except ValueError:
            continue
        if isinstance(item, dict):
            out.append(item)  # pyright: ignore[reportUnknownArgumentType]
    return out


class WsSession:
    """Một phiên `ws` (một job). `oci` tiêm được cho test."""

    def __init__(self, target: WsTarget, oci: Oci | None = None) -> None:
        self.t = target
        self.oci = oci or backend(target)

    def _log(self, tool: Tool, arg: str, ms: int, exit_code: int | None = None) -> None:
        rec: dict[str, Any] = {"tool": tool, "arg": arg[:CMD_MAX], "ms": max(0, ms)}
        if exit_code is not None:
            rec["exit_code"] = exit_code
        fd = os.open(self.t.log_path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
        with os.fdopen(fd, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(rec, ensure_ascii=False) + "\n")

    async def _run(self, req: ExecReq) -> ExecResult:
        return await self.oci.exec(self.t.container, req)

    async def exec(self, cmd: str, timeout_s: int | None = None) -> dict[str, Any]:
        if not cmd or len(cmd) > EXEC_CMD_MAX:
            raise WsError("bad_cmd", f"cmd 1..{EXEC_CMD_MAX} ký tự")
        limit = min(max(1, timeout_s or self.t.exec_s), EXEC_TIMEOUT_MAX_S)
        res = await self._run(ExecReq(cmd=cmd, timeout_s=float(limit), tail_bytes=OUT_TAIL_BYTES))
        self._log("exec", cmd, res.ms, res.exit_code)  # None = hết giờ (không ghi exit_code)
        out: dict[str, Any] = {
            "exit_code": res.exit_code,
            "stdout": _text(res.stdout),
            "stderr": _text(res.stderr),
            "truncated": res.truncated,
            "timed_out": res.timed_out,
            "ms": res.ms,
        }
        if await asyncio.to_thread(dir_bytes, Path(self.t.ws_dir)) > self.t.max_ws_bytes:
            raise WsError("size", "workspace vượt trần RUNTIME_SANDBOX_DISK_MB")
        return out

    async def _cat(self, path: str, max_bytes: int) -> bytes:
        req = ExecReq(_READ_CMD, (path, str(max_bytes + 1)), None, FILE_TIMEOUT_S, max_bytes + 2)
        res = await self._run(req)
        if res.exit_code != 0:
            raise WsError("read_failed", "không đọc được file")
        if len(res.stdout) > max_bytes:
            raise WsError("too_large", f"file > {max_bytes} byte")
        return res.stdout

    async def read(self, path: str, offset: int = 0, limit: int = READ_LINES_MAX) -> str:
        rel = _rel(path)
        t0 = asyncio.get_running_loop().time()
        raw = await self._cat(rel, READ_BYTES_MAX)
        self._log("read", rel, int((asyncio.get_running_loop().time() - t0) * 1000))
        lines = _text(raw).splitlines(keepends=True)
        start = max(0, offset)
        return "".join(lines[start : start + min(max(1, limit), READ_LINES_MAX)])

    async def _put(self, rel: str, data: bytes) -> int:
        if len(data) > WRITE_BYTES_MAX:
            raise WsError("too_large", f"content > {WRITE_BYTES_MAX} byte")
        res = await self._run(ExecReq(_WRITE_CMD, (rel,), data, FILE_TIMEOUT_S, 4096))
        if res.exit_code != 0:
            raise WsError("write_failed", "không ghi được file")
        return res.ms

    async def write(self, path: str, content: str) -> str:
        rel = _rel(path)
        ms = await self._put(rel, content.encode("utf-8"))
        self._log("write", rel, ms)
        return f"đã ghi {rel}"

    async def edit(self, path: str, old: str, new: str, replace_all: bool = False) -> str:
        rel = _rel(path)
        if not old or old == new:
            raise WsError("bad_edit", "old_string rỗng hoặc trùng new_string")
        t0 = asyncio.get_running_loop().time()
        text = _text(await self._cat(rel, WRITE_BYTES_MAX))
        count = text.count(old)
        if count == 0:
            raise WsError("no_match", "old_string không có trong file")
        if count > 1 and not replace_all:
            raise WsError("ambiguous", f"old_string khớp {count} chỗ (dùng replace_all)")
        updated = text.replace(old, new) if replace_all else text.replace(old, new, 1)
        await self._put(rel, updated.encode("utf-8"))
        self._log("edit", rel, int((asyncio.get_running_loop().time() - t0) * 1000))
        return f"đã sửa {rel} ({count if replace_all else 1} chỗ)"


# Mô tả + JSON schema cho MCP (`providers/claude/ws.py`).
TOOL_SPECS: dict[str, tuple[str, dict[str, Any]]] = {
    "ws_exec": (
        "Chạy lệnh shell trong container của workspace (cwd = gốc repo, không mạng).",
        {
            "type": "object",
            "properties": {
                "cmd": {"type": "string", "maxLength": EXEC_CMD_MAX},
                "timeout_s": {"type": "integer", "minimum": 1, "maximum": EXEC_TIMEOUT_MAX_S},
            },
            "required": ["cmd"],
        },
    ),
    "ws_read": (
        "Đọc file text trong workspace (đường dẫn tương đối gốc repo).",
        {
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "offset": {"type": "integer", "minimum": 0},
                "limit": {"type": "integer", "minimum": 1, "maximum": READ_LINES_MAX},
            },
            "required": ["path"],
        },
    ),
    "ws_write": (
        "Ghi (tạo/ghi đè) file trong workspace.",
        {
            "type": "object",
            "properties": {"path": {"type": "string"}, "content": {"type": "string"}},
            "required": ["path", "content"],
        },
    ),
    "ws_edit": (
        "Thay đúng một chỗ old_string bằng new_string trong file (replace_all để thay mọi chỗ).",
        {
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "old_string": {"type": "string"},
                "new_string": {"type": "string"},
                "replace_all": {"type": "boolean"},
            },
            "required": ["path", "old_string", "new_string"],
        },
    ),
}


async def call(session: WsSession, tool: str, args: dict[str, Any]) -> str:
    """Điều phối theo tên tool ⇒ chuỗi kết quả (exec: JSON); lỗi ⇒ `WsError`."""
    try:
        if tool == "ws_exec":
            return json.dumps(await session.exec(str(args["cmd"]), args.get("timeout_s")))
        if tool == "ws_read":
            off, lim = int(args.get("offset") or 0), int(args.get("limit") or READ_LINES_MAX)
            return await session.read(str(args["path"]), off, lim)
        if tool == "ws_write":
            return await session.write(str(args["path"]), str(args["content"]))
        if tool == "ws_edit":
            old, new = str(args["old_string"]), str(args["new_string"])
            replace_all = bool(args.get("replace_all", False))
            return await session.edit(str(args["path"]), old, new, replace_all)
    except (KeyError, TypeError, ValueError) as err:
        raise WsError("bad_args", type(err).__name__) from err
    raise WsError("unknown_tool", tool)
