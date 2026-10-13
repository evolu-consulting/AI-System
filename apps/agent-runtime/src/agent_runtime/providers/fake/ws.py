"""WRK-FR-28 · P-c1 · `fake-cli` gọi tool `ws` (plan-runtime §5.6) — QC dùng ở
`tests/acceptance/pc/autofix_int_test.py`.

`#fake:ws_write=<path>|<base64>` · `#fake:ws_edit=<path>|<old>|<new>` · `#fake:ws_exec=<cmd>` ·
`#fake:ws_secret=<path>` (ghi một dòng khớp mẫu AWS `AKIA[0-9A-Z]{16}` — thử PC-R08(3)). Giá trị
là `\\S+` (cú pháp `#fake:` sẵn có). Mỗi chỉ thị = một lời gọi `WsSession` thật (exec vào container
của job, ghi `commands`) + `tool_use{mcp__ws__<tool>}`. Thân trả lời chỉ tóm tắt (không output
lệnh, không nội dung file).
"""

from __future__ import annotations

import base64
import binascii

from agent_runtime.autofix.ws_tools import WS_SERVER, WsError, WsSession
from agent_runtime.providers.base import Emit, ProviderJob, ToolUse

WS_DIRECTIVES = ("ws_write", "ws_edit", "ws_exec", "ws_secret")
# Chuỗi giả khớp `AKIA[0-9A-Z]{16}` (không phải khoá thật); ghép lúc chạy để mã nguồn không chứa
# nguyên mẫu.
FAKE_AWS_KEY = "AKIA" + "FAKE" * 4
SECRET_LINE = 'export const awsKey = "{}";\n'


def _tool(directive: str) -> str:
    return "ws_write" if directive == "ws_secret" else directive


async def _one(s: WsSession, directive: str, value: str) -> str:
    if directive == "ws_write":
        path, _, b64 = value.partition("|")
        try:
            text = base64.b64decode(b64, validate=True).decode("utf-8")
        except (binascii.Error, UnicodeDecodeError) as err:
            raise WsError("bad_args", "base64") from err
        return await s.write(path, text)
    if directive == "ws_edit":
        parts = value.split("|", 2)
        if len(parts) != 3:  # noqa: PLR2004 — path|old|new
            raise WsError("bad_args", "path|old|new")
        return await s.edit(parts[0], parts[1], parts[2])
    if directive == "ws_exec":
        got = await s.exec(value)
        return f"exec exit {got['exit_code']}"
    return await s.write(value, SECRET_LINE.format(FAKE_AWS_KEY))


async def run_ws(job: ProviderJob, found: dict[str, str], emit: Emit) -> str | None:
    """None = không có chỉ thị `ws_*`; job không phải tự-sửa ⇒ `ws_unavailable`."""
    keys = [k for k in WS_DIRECTIVES if k in found]
    if not keys:
        return None
    if job.ws is None:
        return "ws_unavailable"
    session = WsSession(job.ws)
    out: list[str] = []
    for key in keys:
        await emit(ToolUse(name=f"mcp__{WS_SERVER}__{_tool(key)}"))
        try:
            out.append(await _one(session, key, found[key]))
        except WsError as err:
            out.append(f"{_tool(key)} lỗi {err.code}")
    return "; ".join(out)
