"""WRK-FR-13 · HUB-FR-50 · H2a-R18, R19 · MCP Hub cho agent CLI (`plan-runtime` §4.2; spike
`spike-mcp.md` #1, #10, S3–S5).

Token claim (RT1) **không** đi qua argv: dict `mcp_servers` bị SDK chuyển thành `--mcp-config
<json>` ⇒ lộ ở `/proc/<pid>/cmdline`. Cha (`HostProcess`) ghi `{"mcpServers": {"hub": …}}` vào
`AGENT_RT_WORK_DIR/.mcp/<job_id>.json` (0600, ngoài `work/<job_id>/` ⇒ hook deny đọc, nhãn
`other_job`), con nhận đường dẫn qua `ProviderJob.mcp_config_path` và truyền `mcp_servers=<path>`.
Không phụ thuộc SDK (cha import được). Không log nội dung file (có token).
"""

from __future__ import annotations

import json
import os
import stat
from contextlib import suppress
from pathlib import Path

from agent_runtime.contracts.hub import JobPayload1
from agent_runtime.providers.base import ProviderJob

MCP_SERVER = "hub"
TOOL_PREFIX = f"mcp__{MCP_SERVER}__"
MCP_DIR = ".mcp"
# S3: CLI báo "timed out" + `notifications/cancelled` thay vì treo. Timeout tool Hub `/mcp` =
# `min(agents.timeout_s, HUB_DIFY_TIMEOUT_MAX_S)`; Runtime không đọc env Hub ⇒ trần = mặc định 300.
HUB_TOOL_TIMEOUT_MAX_S = 300
TOOL_TIMEOUT_MARGIN_S = 5
MCP_BLOCK = (
    "\n\n# Công cụ Hub\nTool trả lỗi có `code: CONFIRMATION_REQUIRED` → dừng, không gọi lại tool, "
    'trả {"status":"need_input"} với đúng `question` và `choices` trong lỗi.'
)


def tool_name(key: str) -> str:
    return f"{TOOL_PREFIX}{key}"


def mcp_enabled(payload: JobPayload1, *, retry: bool) -> bool:
    """§4.2: chỉ agent (`agent_result`) có `payload.mcp`, không phải lần thử lại định dạng
    (lần đó `tools=[]`, không gọi lại tool `side_effect` — WRK-BR-04)."""
    return payload.output == "agent_result" and payload.mcp is not None and not retry


def mcp_tool_names(payload: JobPayload1) -> list[str]:
    if payload.mcp is None:
        return []
    return [tool_name(t.root) for t in payload.mcp.tools]


def job_mcp_tools(job: ProviderJob) -> list[str]:
    """Tên `mcp__hub__<k>` của job con khi cha đã ghi file cấu hình (agent, không phải lần thử
    lại); `claude-sub` và `fake-cli` dùng chung (hook `SandboxPolicy.mcp_tools`)."""
    if job.mcp_config_path is None:
        return []
    if not mcp_enabled(job.payload, retry=job.retry_prompt is not None):
        return []
    return mcp_tool_names(job.payload)


def tool_timeout_ms(timeout_s: int) -> int:
    return (min(timeout_s, HUB_TOOL_TIMEOUT_MAX_S) + TOOL_TIMEOUT_MARGIN_S) * 1000


def config_path(work_root: Path, job_id: str) -> Path:
    return work_root / MCP_DIR / f"{job_id}.json"


def server_config(url: str, token: str) -> dict[str, object]:
    """`McpHttpServerConfig` của SDK, bọc trong `mcpServers` như file `--mcp-config`."""
    hub = {"type": "http", "url": url, "headers": {"Authorization": f"Bearer {token}"}}
    return {"mcpServers": {MCP_SERVER: hub}}


class UnsafeMcpDir(OSError):
    """`.mcp` không phải thư mục thật của uid này (symlink / file / chủ khác) → không ghi token."""


def ensure_dir(path: Path) -> None:
    """Review 1 C4: `.mcp` phải là thư mục thật (`lstat`, không symlink) thuộc uid process; quyền
    rộng hơn 0700 (vd tạo sẵn bởi `mkdir` với umask, hoặc bị nới) → `chmod 0o700`."""
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    st = path.lstat()
    if not stat.S_ISDIR(st.st_mode):
        raise UnsafeMcpDir(f"{MCP_DIR} không phải thư mục thật")
    if st.st_uid != os.getuid():
        raise UnsafeMcpDir(f"{MCP_DIR} không thuộc uid của Runtime")
    if stat.S_IMODE(st.st_mode) != 0o700:
        os.chmod(path, 0o700, follow_symlinks=False)


def write_config(work_root: Path, job_id: str, url: str, token: str) -> Path:
    """Ghi file 0600 (thư mục 0700, `ensure_dir`); tạo mới bằng `O_EXCL` sau khi xoá bản cũ (không
    theo symlink). Lỗi giữa chừng (review 1 C11) → xoá file dở (không để token sót trên đĩa)."""
    path = config_path(work_root, job_id)
    ensure_dir(path.parent)
    remove_config(path)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            os.fchmod(f.fileno(), 0o600)
            json.dump(server_config(url, token), f)
    except BaseException:
        remove_config(path)
        raise
    return path


def remove_config(path: Path) -> None:
    with suppress(FileNotFoundError):
        path.unlink()


def read_bearer(path: str | Path) -> str | None:
    """Header `Authorization` trong file cấu hình (`fake-cli` dùng như CLI thật)."""
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        auth = data["mcpServers"][MCP_SERVER]["headers"]["Authorization"]
    except (OSError, ValueError, KeyError, TypeError):
        return None
    return auth if isinstance(auth, str) else None
